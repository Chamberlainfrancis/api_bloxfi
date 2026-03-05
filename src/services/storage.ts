/**
 * File storage service. Spec §1.4: store uploaded files (PDF, JPEG, PNG, max 10MB).
 * S3-compatible (e.g. Railway bucket). No business logic. Used by core for file upload.
 */

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { env } from '../config';

export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

export interface StoreResult {
  /** S3 object key (stored in File.storagePath) */
  storagePath: string;
  sanitizedFilename: string;
}

const S3_PREFIX = 'uploads';

/** Generate unique filename: DOC-<UUID> e.g. DOC-550e8400-e29b-41d4-a716-446655440000.pdf */
function generateUniqueFilename(mimeType: AllowedMimeType): string {
  const uuid = randomUUID();
  const ext = mimeToExt(mimeType);
  return `DOC-${uuid}${ext}`;
}

function getS3Client(): S3Client {
  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3 storage not configured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY'
    );
  }
  return new S3Client({
    endpoint,
    region: env.S3_REGION,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
}

/**
 * Store a file in S3-compatible bucket. Caller must validate size and mime type before calling.
 * Uses unique name format DOC-<UUID> for bucket and DB. Returns the object
 * key (storagePath) and same unique filename for the File record.
 */
export async function storeFile(
  buffer: Buffer,
  _originalFilename: string,
  mimeType: AllowedMimeType
): Promise<StoreResult> {
  const uniqueFilename = generateUniqueFilename(mimeType);
  const objectKey = `${S3_PREFIX}/${uniqueFilename}`;

  const client = getS3Client();
  const bucket = env.S3_BUCKET!;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.length,
    })
  );

  return { storagePath: objectKey, sanitizedFilename: uniqueFilename };
}

function mimeToExt(mime: AllowedMimeType): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  return '.bin';
}
