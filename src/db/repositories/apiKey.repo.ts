import { createHash } from 'crypto';
import { prisma } from '../prisma/client';

const HASH_ALGORITHM = 'sha256';

/**
 * Hash an API key for storage or lookup. Never store raw keys.
 */
export function hashApiKey(plainKey: string): string {
  return createHash(HASH_ALGORITHM).update(plainKey, 'utf8').digest('hex');
}

/**
 * Find an active API key by the hash of the provided key. Returns null if not found or inactive.
 */
export async function findActiveApiKeyByKeyHash(keyHash: string): Promise<{
  id: string;
  keyPrefix: string;
  partnerId: string;
  environment: string;
} | null> {
  const row = await prisma.apiKey.findFirst({
    where: { keyHash, isActive: true },
    select: { id: true, keyPrefix: true, partnerId: true, environment: true },
  });
  return row;
}

/**
 * Deactivate all API keys for a partner in the given environment (e.g. before refreshing the key).
 */
export async function deactivateKeysForPartner(
  partnerId: string,
  environment: string
): Promise<number> {
  const result = await prisma.apiKey.updateMany({
    where: { partnerId, environment },
    data: { isActive: false },
  });
  return result.count;
}

/**
 * Create an API key record (hash + prefix). Caller must generate the raw key and pass its hash and prefix.
 */
export async function createApiKey(params: {
  keyHash: string;
  keyPrefix: string;
  partnerId: string;
  environment: string;
}): Promise<{ id: string }> {
  const row = await prisma.apiKey.create({
    data: {
      keyHash: params.keyHash,
      keyPrefix: params.keyPrefix,
      partnerId: params.partnerId,
      environment: params.environment,
    },
    select: { id: true },
  });
  return row;
}
