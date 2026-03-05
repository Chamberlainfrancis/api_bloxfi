/**
 * KYB document repository. Only layer that touches Prisma for KybDocument.
 * Spec §1.5: attach uploaded files to user's KYB profile.
 */

import { prisma } from '../prisma/client';

export interface CreateKybDocumentInput {
  userId: string;
  fileId: string;
  type: string;
  subType?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface KybDocumentRecord {
  id: string;
  type: string;
  status: string;
  uploadedAt: Date;
}

export async function createKybDocuments(
  userId: string,
  items: Array<{ fileId: string; type: string; subType?: string | null; metadata?: Record<string, unknown> | null }>
): Promise<KybDocumentRecord[]> {
  const created = await prisma.$transaction(
    items.map((item) =>
      prisma.kybDocument.create({
        data: {
          userId,
          fileId: item.fileId,
          type: item.type,
          subType: item.subType ?? null,
          status: 'pending_review',
          metadata: item.metadata != null ? (item.metadata as object) : undefined,
        },
      })
    )
  );
  return created.map((d) => ({
    id: d.id,
    type: d.type,
    status: d.status,
    uploadedAt: d.uploadedAt,
  }));
}
