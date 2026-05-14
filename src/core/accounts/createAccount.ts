/**
 * Core: create offramp payout bank account (always stored as rail offramp). Validates user and KYB for rail. Spec §3.1.
 */

import type { CreateAccountRequest, CreateAccountResponse, RegionAccountDetails, RailType } from "@/types/account";

export interface AccountRepoCreate {
  createAccount(data: {
    userId: string;
    railType: RailType;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: object;
    regionDetails: object;
  }): Promise<{
    id: string;
    userId: string;
    railType: string;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: unknown;
    regionDetails: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForAccount {
  findUserById(id: string): Promise<{ id: string; kybStatus: string } | null>;
}

export interface KybRepoForAccount {
  getKybRailStatuses(userId: string, railsFilter?: string[]): Promise<Array<{ rail: string; status: string; capabilities: string[] }>>;
}

function getRegionDetails(req: CreateAccountRequest): RegionAccountDetails | null {
  const d = req.details;
  return d && typeof d === "object" && "currency" in d ? d : null;
}

function getPaymentRail(details: RegionAccountDetails | null): string {
  if (!details) return "unknown";
  const ccy = details.currency?.trim().toUpperCase() ?? "";
  if (ccy === "USD" && details.transferDetails?.payoutRail) {
    return String(details.transferDetails.payoutRail).toLowerCase();
  }
  if (details.transferType) return String(details.transferType).toLowerCase();
  if (details.pixKey != null && String(details.pixKey).trim() !== "") return "pix";
  return "bank_transfer";
}

/** Map to currency rail for KYB (e.g. USD, BRL, COP, ARS, MXN). */
function getCurrencyRail(currency: string): string {
  const upper = currency?.trim().toUpperCase() ?? "";
  return upper || "USD";
}

export async function createAccount(
  accountRepo: AccountRepoCreate,
  userRepo: UserRepoForAccount,
  kybRepo: KybRepoForAccount,
  userId: string,
  data: CreateAccountRequest,
): Promise<CreateAccountResponse> {
  const regionDetails = getRegionDetails(data);
  if (!regionDetails?.currency) {
    throw new Error("INVALID_ACCOUNT: region details and currency are required");
  }

  const paymentRail = getPaymentRail(regionDetails);
  const currency = regionDetails.currency.trim().toLowerCase();
  const railCurrency = getCurrencyRail(regionDetails.currency);
  const accountType = data.type.trim();
  if (!accountType) {
    throw new Error("INVALID_ACCOUNT: type is required");
  }

  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  const railStatuses = await kybRepo.getKybRailStatuses(userId, [railCurrency]);
  const railApproved = railStatuses.some((r) => r.status === "approved");
  const userApproved = user.kybStatus === "approved";
  if (!userApproved && !railApproved) {
    throw new Error("USER_NOT_KYB_VERIFIED");
  }

  const account = await accountRepo.createAccount({
    userId,
    railType: data.rail,
    currency,
    paymentRail,
    accountType,
    accountHolder: data.accountHolder as object,
    regionDetails: regionDetails as object,
  });

  return {
    status: "ACTIVE",
    message: "Account created successfully",
    id: account.id,
  };
}
