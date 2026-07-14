/**
 * Stable fingerprint for onramp POST /accounts idempotency: same creationRequestId + same
 * (userId, identity) → soft replay. Mirrors src/db/repositories/userCreationPayload.ts's
 * userCreationPayloadsMatch — Account.creationRequestId is globally unique (not scoped by
 * userId), so a bare `findByCreationRequestId` hit is not sufficient proof the row belongs
 * to this caller; it must be corroborated against userId + identity before being replayed.
 */
import { stableStringify } from '@/utils/stableJson';

interface AccountIdentityInput {
  accountHolder: {
    email?: string | null;
    firstName?: string;
    lastName?: string;
  };
}

interface AccountIdentityRow {
  userId: string;
  accountHolder: unknown;
}

export function accountCreationPayloadFingerprint(userId: string, data: AccountIdentityInput): string {
  return stableStringify({
    userId,
    email: data.accountHolder.email ?? null,
    firstName: data.accountHolder.firstName ?? null,
    lastName: data.accountHolder.lastName ?? null,
  });
}

export function accountCreationPayloadFingerprintFromRow(row: AccountIdentityRow): string {
  const holder = (row.accountHolder ?? null) as
    | { email?: string | null; firstName?: string; lastName?: string }
    | null;
  return stableStringify({
    userId: row.userId,
    email: holder?.email ?? null,
    firstName: holder?.firstName ?? null,
    lastName: holder?.lastName ?? null,
  });
}

export function accountCreationPayloadsMatch(
  row: AccountIdentityRow,
  userId: string,
  data: AccountIdentityInput
): boolean {
  return accountCreationPayloadFingerprintFromRow(row) === accountCreationPayloadFingerprint(userId, data);
}
