/**
 * Stable fingerprint for POST /users idempotency: same requestId + same payload → replay (200).
 */
import type { CreateUserRequest } from '@/types/user';
import { stableStringify } from '@/utils/stableJson';

export function userCreationPayloadFingerprint(data: CreateUserRequest): string {
  return stableStringify({
    type: data.type,
    businessInfo: data.businessInfo,
    registeredAddress: data.registeredAddress,
    legalRepresentative: data.legalRepresentative,
    metadata: data.metadata ?? null,
  });
}

export function userCreationPayloadFingerprintFromRow(row: {
  type: string;
  businessInfo: unknown;
  registeredAddress: unknown;
  legalRepresentative: unknown;
  metadata: unknown;
}): string {
  return stableStringify({
    type: row.type,
    businessInfo: row.businessInfo,
    registeredAddress: row.registeredAddress,
    legalRepresentative: row.legalRepresentative,
    metadata: row.metadata ?? null,
  });
}

export function userCreationPayloadsMatch(
  row: {
    type: string;
    businessInfo: unknown;
    registeredAddress: unknown;
    legalRepresentative: unknown;
    metadata: unknown;
  },
  data: CreateUserRequest
): boolean {
  return userCreationPayloadFingerprintFromRow(row) === userCreationPayloadFingerprint(data);
}
