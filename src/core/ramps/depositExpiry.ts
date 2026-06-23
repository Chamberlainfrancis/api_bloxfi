/**
 * Expire onramps/offramps that are still awaiting deposit after the deposit window.
 */

import type { OnrampStatus } from '@/types/onramp';
import type { OfframpStatus } from '@/types/offramp';

export const DEPOSIT_EXPIRED_REASON = 'Deposit window expired';

export const ONRAMP_AWAITING_DEPOSIT: readonly OnrampStatus[] = ['AWAITING_FUNDS', 'FIAT_PENDING'];
export const OFFRAMP_AWAITING_DEPOSIT: readonly OfframpStatus[] = ['AWAITING_CRYPTO', 'CRYPTO_PENDING'];

function parseDepositDeadlineFromObject(value: unknown): Date | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const raw = obj.depositBy ?? obj.expiresAt;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseDepositDeadline(...sources: unknown[]): Date | null {
  for (const src of sources) {
    const d = parseDepositDeadlineFromObject(src);
    if (d) return d;
  }
  return null;
}

export function extractOnrampDepositDeadline(row: {
  quoteInformation?: unknown;
  depositInfo?: unknown;
}): Date | null {
  return parseDepositDeadline(row.depositInfo, row.quoteInformation);
}

export function extractOfframpDepositDeadline(row: {
  rateInformation?: unknown;
  depositInstructions?: unknown;
}): Date | null {
  return parseDepositDeadline(row.depositInstructions, row.rateInformation);
}

export function isDepositPastDue(deadline: Date | null, now = new Date()): boolean {
  if (!deadline) return false;
  return deadline.getTime() <= now.getTime();
}

export function shouldExpireOnrampStatus(status: string): boolean {
  return (ONRAMP_AWAITING_DEPOSIT as readonly string[]).includes(status);
}

export function shouldExpireOfframpStatus(status: string): boolean {
  return (OFFRAMP_AWAITING_DEPOSIT as readonly string[]).includes(status);
}

export interface OnrampExpireRepo {
  updateOnrampStatus(
    id: string,
    status: OnrampStatus,
    updates?: { failedReason?: string | null }
  ): Promise<unknown>;
}

export interface OfframpExpireRepo {
  updateOfframpStatus(
    id: string,
    status: OfframpStatus,
    updates?: { failedReason?: string | null }
  ): Promise<unknown>;
}

export async function expireOnrampIfDepositPastDue(
  row: { id: string; status: string; quoteInformation?: unknown; depositInfo?: unknown },
  repo: OnrampExpireRepo,
  now = new Date()
): Promise<OnrampStatus | null> {
  if (row.status === 'EXPIRED') return 'EXPIRED';
  if (!shouldExpireOnrampStatus(row.status)) return null;
  if (!isDepositPastDue(extractOnrampDepositDeadline(row), now)) return null;
  await repo.updateOnrampStatus(row.id, 'EXPIRED', { failedReason: DEPOSIT_EXPIRED_REASON });
  return 'EXPIRED';
}

export async function expireOfframpIfDepositPastDue(
  row: {
    id: string;
    status: string;
    rateInformation?: unknown;
    depositInstructions?: unknown;
  },
  repo: OfframpExpireRepo,
  now = new Date()
): Promise<OfframpStatus | null> {
  if (row.status === 'EXPIRED') return 'EXPIRED';
  if (!shouldExpireOfframpStatus(row.status)) return null;
  if (!isDepositPastDue(extractOfframpDepositDeadline(row), now)) return null;
  await repo.updateOfframpStatus(row.id, 'EXPIRED', { failedReason: DEPOSIT_EXPIRED_REASON });
  return 'EXPIRED';
}

export async function expireStaleOnramps(
  listAwaiting: () => Promise<
    Array<{ id: string; status: string; quoteInformation?: unknown; depositInfo?: unknown }>
  >,
  repo: OnrampExpireRepo,
  now = new Date()
): Promise<number> {
  const rows = await listAwaiting();
  let count = 0;
  for (const row of rows) {
    const wasAwaiting = shouldExpireOnrampStatus(row.status);
    const result = await expireOnrampIfDepositPastDue(row, repo, now);
    if (wasAwaiting && result === 'EXPIRED') count += 1;
  }
  return count;
}

export async function expireStaleOfframps(
  listAwaiting: () => Promise<
    Array<{
      id: string;
      status: string;
      rateInformation?: unknown;
      depositInstructions?: unknown;
    }>
  >,
  repo: OfframpExpireRepo,
  now = new Date()
): Promise<number> {
  const rows = await listAwaiting();
  let count = 0;
  for (const row of rows) {
    const wasAwaiting = shouldExpireOfframpStatus(row.status);
    const result = await expireOfframpIfDepositPastDue(row, repo, now);
    if (wasAwaiting && result === 'EXPIRED') count += 1;
  }
  return count;
}
