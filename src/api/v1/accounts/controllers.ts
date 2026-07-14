/**
 * Account controllers (offramp payout destination + onramp Sumsub share-token KYC import).
 * Validate → call core → return standardized response. No Prisma/Redis/business logic here.
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess } from "@/utils";
import { AppError } from "@/types";
import { CreateAccountConflictError } from "@/types/createAccountConflict";
import * as accountCore from "@/core/accounts";
import * as accountRepo from "@/db/repositories/account.repo";
import * as userRepo from "@/db/repositories/user.repo";
import type { CreateAccountRequest } from "@/types/account";
import { createAccountBodySchema, listAccountsQuerySchema, updateAccountBodySchema } from "@/api/v1/accounts/schemas";
import { createPalremitLiquidityAdapter } from "@/services/palremitAdapters";
import { importSwipeluxBeneficiaryKyc } from "@/core/integrations/palremitSwipeluxKycImport";

const REQUEST_ID_HEADER = "requestid";

const palremitLiquidity = createPalremitLiquidityAdapter();

const repos = {
  account: {
    createAccount: accountRepo.createAccount,
    findAccountByIdAndUser: accountRepo.findAccountByIdAndUser,
    // updateAccount (PUT) is offramp-only, unchanged by Task 7 (see docstring below) — keeps
    // relying on the offramp-specific lookup its AccountRepoUpdate interface still names.
    findOfframpAccountByIdAndUser: accountRepo.findOfframpAccountByIdAndUser,
    findByCreationRequestId: accountRepo.findAccountByCreationRequestId,
    updateKycImport: accountRepo.updateAccountKycImport,
    listAccounts: accountRepo.listAccounts,
    deleteAccount: accountRepo.deleteAccount,
    hasPendingTransactions: accountRepo.hasPendingTransactions,
    updateAccountProviderPayout: accountRepo.updateAccountProviderPayout,
  },
  user: {
    findUserById: userRepo.findUserById,
    getKybRailStatuses: userRepo.getKybRailStatuses,
  },
};

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, "INVALID_REQUEST", 400, details as Record<string, unknown>);
}

export async function createAccount(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = createAccountBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const requestId = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(requestId) ? requestId[0] : requestId;
    if (!raw || typeof raw !== "string" || raw.trim() === "") {
      next(new AppError("Missing or invalid requestId header", "BAD_REQUEST", 400));
      return;
    }
    const { userId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError("User not found", "NOT_FOUND", 404));
      return;
    }
    const result = await accountCore.createAccount(
      repos.account,
      repos.user,
      repos.user,
      userId,
      parsed.data as CreateAccountRequest,
      { palremitLiquidityRequest: palremitLiquidity, requestId: raw, importKyc: importSwipeluxBeneficiaryKyc }
    );
    sendSuccess(res, result, 200);
  } catch (e) {
    if (e instanceof CreateAccountConflictError) {
      // Mirrors CreateUserConflictError's REQUEST_ID_MISMATCH mapping in users/controllers.ts:
      // a requestId collision across different users/identities is a client-visible conflict, not a 500.
      next(new AppError(e.message, "CONFLICT", 409, { reason: e.kind }));
      return;
    }
    if (e instanceof Error && e.message === "USER_NOT_FOUND") {
      next(new AppError("User not found", "NOT_FOUND", 404));
      return;
    }
    if (e instanceof Error && e.message === "USER_NOT_KYB_VERIFIED") {
      next(new AppError("User not KYB verified for this rail", "UNPROCESSABLE_ENTITY", 422));
      return;
    }
    if (e instanceof Error && e.message.startsWith("INVALID_ACCOUNT:")) {
      next(new AppError(e.message.replace("INVALID_ACCOUNT:", "").trim(), "INVALID_REQUEST", 400));
      return;
    }
    if (e instanceof Error && e.message === "PALREMIT_CORRIDORS_UNAVAILABLE") {
      next(new AppError("Palremit payout corridors unavailable", "BAD_GATEWAY", 502));
      return;
    }
    if (e instanceof Error && e.message === "SWIPELUX_BENEFICIARY_KYC_IMPORT_DISABLED") {
      next(new AppError("Onramp beneficiary KYC import is not enabled for this user", "FORBIDDEN", 403));
      return;
    }
    if (e instanceof Error && e.message === "PALREMIT_SWIPELUX_KYC_IMPORT_TRANSIENT") {
      next(new AppError("SwipeLux KYC import temporarily unavailable, retry later", "BAD_GATEWAY", 502));
      return;
    }
    if (e instanceof Error && e.message === "PALREMIT_SWIPELUX_KYC_IMPORT_PERMANENT") {
      next(new AppError("SwipeLux KYC import rejected", "UNPROCESSABLE_ENTITY", 422));
      return;
    }
    next(e);
  }
}

export async function listAccounts(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const queryParsed = listAccountsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      const message = queryParsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      next(validationError(message, queryParsed.error.flatten()));
      return;
    }
    const { userId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError("User not found", "NOT_FOUND", 404));
      return;
    }
    const result = await accountCore.listAccounts(repos.account, userId, queryParsed.data);
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("INVALID_CURSOR:")) {
      next(new AppError(e.message.replace("INVALID_CURSOR:", "").trim(), "INVALID_REQUEST", 400));
      return;
    }
    next(e);
  }
}

export async function getAccount(req: Request<{ userId: string; accountId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, accountId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError("User not found", "NOT_FOUND", 404));
      return;
    }
    const result = await accountCore.getAccount(repos.account, userId, accountId);
    if (!result) {
      next(new AppError("Account not found", "NOT_FOUND", 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function deleteAccount(req: Request<{ userId: string; accountId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, accountId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError("User not found", "NOT_FOUND", 404));
      return;
    }
    const result = await accountCore.deleteAccount(repos.account, userId, accountId);
    if (!result) {
      next(new AppError("Account not found", "NOT_FOUND", 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message === "ACCOUNT_HAS_PENDING_TRANSACTIONS") {
      next(new AppError("Account has pending transactions", "CONFLICT", 409));
      return;
    }
    next(e);
  }
}

export async function updateAccount(
  req: Request<{ userId: string; accountId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = updateAccountBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { userId, accountId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError("User not found", "NOT_FOUND", 404));
      return;
    }
    const result = await accountCore.updateAccount(
      repos.account,
      userId,
      accountId,
      parsed.data,
      { palremitLiquidityRequest: palremitLiquidity }
    );
    if (!result) {
      next(new AppError("Account not found", "NOT_FOUND", 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("INVALID_ACCOUNT:")) {
      next(new AppError(e.message.replace("INVALID_ACCOUNT:", "").trim(), "INVALID_REQUEST", 400));
      return;
    }
    if (e instanceof Error && e.message === "PALREMIT_CORRIDORS_UNAVAILABLE") {
      next(new AppError("Palremit payout corridors unavailable", "BAD_GATEWAY", 502));
      return;
    }
    next(e);
  }
}
