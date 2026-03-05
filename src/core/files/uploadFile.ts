/**
 * Core: upload file. Orchestrates storage + file metadata.
 * Spec §1.4. No Express/Prisma; receives storage and repo via DI.
 */

import { randomUUID } from 'crypto';
import type { UploadFileResponse } from '../../types/file';
import type { AllowedMimeType } from '../../services/storage';

export interface FileRepo {
  createFile(data: {
    id: string;
    filename: string;
    size: number;
    mimeType: string;
    storagePath: string;
  }): Promise<{ id: string; filename: string; size: number; mimeType: string; uploadedAt: Date }>;
}

export interface StorageService {
  storeFile(
    buffer: Buffer,
    originalFilename: string,
    mimeType: AllowedMimeType
  ): Promise<{ storagePath: string; sanitizedFilename: string }>;
}

export interface UploadFileInput {
  buffer: Buffer;
  originalFilename: string;
  mimeType: AllowedMimeType;
  size: number;
}

/**
 * Store file to disk and persist metadata. Returns spec §1.4 response.
 */
export async function uploadFile(
  storage: StorageService,
  fileRepo: FileRepo,
  input: UploadFileInput
): Promise<UploadFileResponse> {
  const fileId = randomUUID();
  const { storagePath, sanitizedFilename } = await storage.storeFile(
    input.buffer,
    input.originalFilename,
    input.mimeType
  );
  const record = await fileRepo.createFile({
    id: fileId,
    filename: sanitizedFilename,
    size: input.size,
    mimeType: input.mimeType,
    storagePath,
  });
  return {
    fileId,
    filename: record.filename,
    size: record.size,
    mimeType: record.mimeType,
    uploadedAt: record.uploadedAt.toISOString(),
  };
}
