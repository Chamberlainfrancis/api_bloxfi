/**
 * Core: attach documents to KYB. Spec §1.5.
 * Accept array of { type, fileId, … }; return documentsAdded, documents[].
 * No Express/Prisma; receives repos via DI.
 */

import type { AttachDocumentsResponse, AttachDocumentItem } from '../../types/file';

export interface UserRepoFind {
  findUserById(id: string): Promise<{ id: string } | null>;
}

export interface FileRepoFind {
  findFilesByIds(ids: string[]): Promise<Array<{ id: string }>>;
}

export interface KybDocumentRepo {
  createKybDocuments(
    userId: string,
    items: Array<{
      fileId: string;
      type: string;
      subType?: string | null;
      metadata?: Record<string, unknown> | null;
    }>
  ): Promise<Array<{ id: string; type: string; status: string; uploadedAt: Date }>>;
}

/**
 * Attach uploaded files to user's KYB profile. All fileIds must exist.
 * Returns null if user not found (caller should respond 404).
 */
export async function attachDocumentsToKyb(
  userRepo: UserRepoFind,
  fileRepo: FileRepoFind,
  kybDocRepo: KybDocumentRepo,
  userId: string,
  items: AttachDocumentItem[]
): Promise<AttachDocumentsResponse | null> {
  const user = await userRepo.findUserById(userId);
  if (!user) {
    return null;
  }
  if (items.length === 0) {
    return { documentsAdded: 0, documents: [] };
  }
  const fileIds = [...new Set(items.map((i) => i.fileId))];
  const existingFiles = await fileRepo.findFilesByIds(fileIds);
  const existingIds = new Set(existingFiles.map((f) => f.id));
  const missing = fileIds.filter((id) => !existingIds.has(id));
  if (missing.length > 0) {
    throw new Error(`FILE_NOT_FOUND: ${missing.join(', ')}`);
  }
  const docItems = items.map((item) => ({
    fileId: item.fileId,
    type: item.type,
    subType: item.subType ?? null,
    metadata:
      item.issuedCountry ||
      item.issueDate ||
      item.expiryDate != null ||
      item.documentNumber ||
      item.ownerName
        ? {
            ...(item.issuedCountry && { issuedCountry: item.issuedCountry }),
            ...(item.issueDate && { issueDate: item.issueDate }),
            ...(item.expiryDate !== undefined && { expiryDate: item.expiryDate }),
            ...(item.documentNumber && { documentNumber: item.documentNumber }),
            ...(item.ownerName && { ownerName: item.ownerName }),
          }
        : undefined,
  }));
  const documents = await kybDocRepo.createKybDocuments(userId, docItems);
  return {
    documentsAdded: documents.length,
    documents: documents.map((d) => ({
      id: d.id,
      type: d.type,
      status: d.status,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
  };
}
