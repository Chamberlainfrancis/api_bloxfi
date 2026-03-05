/**
 * File upload controller. Spec §1.4.
 * Validate → call core → return standardized response.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../../utils';
import { AppError } from '../../../types';
import { uploadFile } from '../../../core/files';
import * as fileRepo from '../../../db/repositories/file.repo';
import { storeFile, isAllowedMimeType, MAX_FILE_SIZE_BYTES } from '../../../services/storage';

export async function uploadFileHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = req.file as Express.Multer.File | undefined;
    if (!file || !file.buffer) {
      next(new AppError('No file provided. Send multipart/form-data with field "file".', 'INVALID_REQUEST', 400));
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      next(new AppError(`File size exceeds maximum of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`, 'INVALID_REQUEST', 400));
      return;
    }
    const mime = file.mimetype;
    if (!isAllowedMimeType(mime)) {
      next(
        new AppError(
          'Invalid file type. Allowed: PDF, JPEG, PNG.',
          'INVALID_REQUEST',
          400,
          { field: 'file', allowed: ['application/pdf', 'image/jpeg', 'image/png'] }
        )
      );
      return;
    }
    const result = await uploadFile(
      { storeFile },
      fileRepo,
      {
        buffer: file.buffer,
        originalFilename: file.originalname ?? 'upload',
        mimeType: mime,
        size: file.size,
      }
    );
    sendSuccess(res, result, 201);
  } catch (e) {
    next(e);
  }
}
