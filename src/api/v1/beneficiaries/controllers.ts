/**
 * Onramp beneficiary controllers. Validate → core → sendSuccess.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import { importSwipeluxBeneficiaryKyc } from '@/core/integrations/palremitSwipeluxKycImport';
import { createOnrampBeneficiaryWithImport } from '@/core/beneficiaries/createBeneficiary';
import {
  getOnrampBeneficiary,
  listOnrampBeneficiaries,
} from '@/core/beneficiaries/getBeneficiary';
import * as userRepo from '@/db/repositories/user.repo';
import * as beneficiaryRepo from '@/db/repositories/onrampBeneficiary.repo';
import {
  createBeneficiaryBodySchema,
  getBeneficiaryParamsSchema,
  getBeneficiaryQuerySchema,
  listBeneficiariesQuerySchema,
} from '@/api/v1/beneficiaries/schemas';

const REQUEST_ID_HEADER = 'requestid';
const palremitLiquidity = createPalremitLiquidityAdapter();

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function createBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createBeneficiaryBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }

    const requestIdHeader = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
      return;
    }
    const headerRequestId = raw.trim();
    if (parsed.data.requestId !== headerRequestId) {
      next(
        new AppError('requestId in body must match requestId header', 'INVALID_REQUEST', 400)
      );
      return;
    }

    const { response, created } = await createOnrampBeneficiaryWithImport(
      {
        findUserById: userRepo.findUserById,
        findByRequestId: beneficiaryRepo.findOnrampBeneficiaryByRequestId,
        createRow: beneficiaryRepo.createOnrampBeneficiary,
        updateStatus: beneficiaryRepo.updateOnrampBeneficiaryStatus,
        importKyc: (body) => importSwipeluxBeneficiaryKyc(palremitLiquidity, body),
      },
      {
        businessUserId: parsed.data.userId,
        requestId: parsed.data.requestId,
        sumsubShareToken: parsed.data.sumsubShareToken,
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        phone: parsed.data.phone,
      }
    );

    sendSuccess(res, response, created ? 201 : 200);
  } catch (e) {
    next(e);
  }
}

export async function listBeneficiaries(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = listBeneficiariesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const items = await listOnrampBeneficiaries(parsed.data.userId);
    sendSuccess(res, { items });
  } catch (e) {
    next(e);
  }
}

export async function getBeneficiary(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const params = getBeneficiaryParamsSchema.safeParse(req.params);
    const query = getBeneficiaryQuerySchema.safeParse(req.query);
    if (!params.success) {
      const message = params.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, params.error.flatten()));
      return;
    }
    if (!query.success) {
      const message = query.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, query.error.flatten()));
      return;
    }
    const item = await getOnrampBeneficiary(query.data.userId, params.data.id);
    sendSuccess(res, item);
  } catch (e) {
    next(e);
  }
}
