/**
 * User & KYB controllers. Validate → call core → return standardized response.
 * No Prisma/Redis/business logic here.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError, CreateUserConflictError } from '@/types';
import * as kybCore from '@/core/kyb';
import * as userRepo from '@/db/repositories/user.repo';
import * as fileRepo from '@/db/repositories/file.repo';
import * as kybDocumentRepo from '@/db/repositories/kybDocument.repo';
import {
  createUserBodySchema,
  updateKybBodySchema,
  submitKybBodySchema,
  getKybStatusQuerySchema,
  attachKybDocumentsBodySchema,
} from '@/api/v1/users/schemas';

const REQUEST_ID_HEADER = 'requestid';

const repo = {
  createUser: userRepo.createUser,
  findUserById: userRepo.findUserById,
  updateUser: userRepo.updateUser,
  upsertKybInfo: userRepo.upsertKybInfo,
  createKybSubmission: userRepo.createKybSubmission,
  getKybRailStatuses: userRepo.getKybRailStatuses,
};

const kybDocRepos = {
  userRepo: { findUserById: userRepo.findUserById },
  fileRepo: { findFilesByIds: fileRepo.findFilesByIds },
  kybDocRepo: {
    createKybDocuments: kybDocumentRepo.createKybDocuments,
  },
};

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function createUser(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createUserBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const requestId = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(requestId) ? requestId[0] : requestId;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
      return;
    }
    const headerRequestId = raw.trim();
    const bodyRequestId = parsed.data.requestId;
    if (bodyRequestId !== undefined && bodyRequestId !== headerRequestId) {
      next(
        new AppError('requestId in body must match requestId header', 'INVALID_REQUEST', 400)
      );
      return;
    }
    const data = {
      type: parsed.data.type,
      requestId: headerRequestId,
      businessInfo: parsed.data.businessInfo,
      registeredAddress: parsed.data.registeredAddress,
      legalRepresentative: parsed.data.legalRepresentative,
      metadata: parsed.data.metadata,
    };
    const { response, created } = await kybCore.createBusinessUser(repo, data);
    sendSuccess(res, response, created ? 201 : 200);
  } catch (e) {
    if (e instanceof CreateUserConflictError) {
      if (e.kind === 'EMAIL_EXISTS') {
        next(new AppError(e.message, 'CONFLICT', 409, { reason: 'DUPLICATE_BUSINESS_EMAIL' }));
        return;
      }
      if (e.kind === 'REQUEST_ID_MISMATCH') {
        next(new AppError(e.message, 'CONFLICT', 409, { reason: 'REQUEST_ID_PAYLOAD_MISMATCH' }));
        return;
      }
    }
    next(e);
  }
}

export async function getUser(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId } = req.params;
    const result = await kybCore.getBusinessUser(repo, userId);
    if (!result) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function updateKyb(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = updateKybBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { userId } = req.params;
    const existing = await userRepo.findUserById(userId);
    if (!existing) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await kybCore.updateKybInformation(repo, userId, parsed.data);
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function submitKyb(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = submitKybBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { userId } = req.params;
    const existing = await userRepo.findUserById(userId);
    if (!existing) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await kybCore.submitKybApplication(repo, userId, parsed.data);
    sendSuccess(res, result, 201);
  } catch (e) {
    next(e);
  }
}

export async function getKybStatus(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const queryParsed = getKybStatusQuerySchema.safeParse(req.query);
    const railsRaw = queryParsed.success && queryParsed.data.rails
      ? queryParsed.data.rails
      : (req.query.rails as string | undefined);
    const railsFilter = typeof railsRaw === 'string'
      ? railsRaw.split(',').map((r) => r.trim()).filter(Boolean)
      : undefined;
    const { userId } = req.params;
    const result = await kybCore.getKybStatus(repo, userId, railsFilter);
    if (!result) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function attachKybDocuments(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = attachKybDocumentsBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { userId } = req.params;
    const result = await kybCore.attachDocumentsToKyb(
      kybDocRepos.userRepo,
      kybDocRepos.fileRepo,
      kybDocRepos.kybDocRepo,
      userId,
      parsed.data
    );
    if (!result) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result, 201);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('FILE_NOT_FOUND:')) {
      const missing = e.message.replace('FILE_NOT_FOUND:', '').trim();
      next(
        new AppError(`One or more fileIds not found or invalid: ${missing}`, 'INVALID_REQUEST', 400, {
          details: e.message,
        })
      );
      return;
    }
    next(e);
  }
}
