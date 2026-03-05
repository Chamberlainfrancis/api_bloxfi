/**
 * File repository. Only layer that touches Prisma for File.
 * Spec §1.4: file metadata (fileId, filename, size, mimeType, uploadedAt).
 */

import { prisma } from '../prisma/client';

export interface CreateFileInput {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  storagePath: string;
}

export interface FileRecord {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: Date;
}

export async function createFile(data: CreateFileInput): Promise<FileRecord> {
  const file = await prisma.file.create({
    data: {
      id: data.id,
      filename: data.filename,
      size: data.size,
      mimeType: data.mimeType,
      storagePath: data.storagePath,
    },
  });
  return {
    id: file.id,
    filename: file.filename,
    size: file.size,
    mimeType: file.mimeType,
    uploadedAt: file.uploadedAt,
  };
}

export async function findFileById(id: string): Promise<FileRecord | null> {
  const file = await prisma.file.findUnique({
    where: { id },
  });
  return file
    ? {
        id: file.id,
        filename: file.filename,
        size: file.size,
        mimeType: file.mimeType,
        uploadedAt: file.uploadedAt,
      }
    : null;
}

export async function findFilesByIds(ids: string[]): Promise<FileRecord[]> {
  if (ids.length === 0) return [];
  const files = await prisma.file.findMany({
    where: { id: { in: ids } },
  });
  return files.map((f) => ({
    id: f.id,
    filename: f.filename,
    size: f.size,
    mimeType: f.mimeType,
    uploadedAt: f.uploadedAt,
  }));
}
