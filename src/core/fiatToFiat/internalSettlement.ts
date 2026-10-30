/**
 * Fiat-to-fiat internal settlement.
 *
 * In the FIAT_TO_FIAT flow the onramp pays its crypto into the paired
 * offramp's deposit address, which is ours. Sending it on-chain only moves
 * treasury money to our own deposit account and back, paying network and
 * exchange fees and waiting for confirmations. When the onramp's fiat lands
 * and the pair matches exactly, close the crypto leg on both rows instead:
 * the onramp completes and the offramp is treated as funded, so its fiat
 * payout starts straight away. Anything that does not match falls back to
 * the normal on-chain send.
 */

import { logger } from '@/lib/logger';
import { FIAT_TO_FIAT_CONFIG, isFiatToFiatFlow } from '@/config/fiatToFiat';
import {
  expectedOfframpCryptoAmount,
  priorCryptoReceivedAmount,
} from '@/core/offramps/offrampDepositAmount';
import type { OfframpStatus } from '@/types/offramp';
import type { OnrampStatus } from '@/types/onramp';

/** Offramp statuses that are still waiting for their crypto and have received none. */
export const SETTLEABLE_OFFRAMP_STATUSES: readonly OfframpStatus[] = ['AWAITING_CRYPTO', 'CRYPTO_PENDING'];

/** The onramp's crypto must equal the offramp's quoted deposit to the cent. */
const AMOUNT_TOLERANCE = 0.01;

export interface SettlementOnramp {
  id: string;
  userId: string;
  txnRef: string | null;
  status: string;
  destination: unknown;
  quoteInformation: unknown;
  providerRefs: unknown;
}

export interface SettlementOfframp {
  id: string;
  userId: string;
  txnRef: string | null;
  status: string;
  source: unknown;
  depositInstructions: unknown;
  rateInformation: unknown;
  timeline: unknown;
  providerRefs: unknown;
}

export interface FiatToFiatSettlementDeps {
  findOpenOfframpsByDepositAddress(userId: string, address: string): Promise<SettlementOfframp[]>;
  /**
   * Moves the offramp to CRYPTO_CONFIRMED only if it is still in one of
   * `fromStatuses`. Returns false when another writer got there first.
   */
  claimOfframpCrypto(
    offrampId: string,
    fromStatuses: readonly OfframpStatus[],
    updates: { timeline: object; providerRefs: object; receipt: object }
  ): Promise<boolean>;
  updateOnrampStatus(
    id: string,
    status: OnrampStatus,
    updates?: { receipt?: object | null; failedReason?: string | null; providerRefs?: object | null }
  ): Promise<unknown>;
  afterOnrampCompleted?(onrampId: string): void;
  advanceOfframpPayout(offrampId: string): Promise<void>;
  now?: () => Date;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v.trim()) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** EVM addresses are case-insensitive; Tron, Solana and others are not. */
function sameAddress(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (/^0x[0-9a-f]{40}$/i.test(a) && /^0x[0-9a-f]{40}$/i.test(b)) return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

export type PairCheck = { ok: true; amount: number } | { ok: false; reason: string };

/** Pure check: is `offramp` the funded leg of this fiat-to-fiat `onramp`? */
export function checkFiatToFiatPair(
  onramp: SettlementOnramp,
  offramp: SettlementOfframp,
  now: Date
): PairCheck {
  if (!isFiatToFiatFlow(str(asRecord(onramp.quoteInformation).flow))) return { ok: false, reason: 'onramp_not_fiat_to_fiat' };
  if (!isFiatToFiatFlow(str(asRecord(offramp.rateInformation).flow))) return { ok: false, reason: 'offramp_not_fiat_to_fiat' };
  if (onramp.userId !== offramp.userId) return { ok: false, reason: 'different_business' };
  if (!SETTLEABLE_OFFRAMP_STATUSES.includes(offramp.status as OfframpStatus)) {
    return { ok: false, reason: 'offramp_not_awaiting_crypto' };
  }
  if (priorCryptoReceivedAmount(offramp.timeline) > 0) return { ok: false, reason: 'offramp_already_received_crypto' };

  const dest = asRecord(onramp.destination);
  const di = asRecord(offramp.depositInstructions);
  if (!sameAddress(str(dest.walletAddress), str(di.address))) return { ok: false, reason: 'address_mismatch' };
  if (str(dest.currency).toUpperCase() !== str(di.currency).toUpperCase()) return { ok: false, reason: 'asset_mismatch' };
  if (str(dest.chain).toUpperCase() !== str(di.network).toUpperCase()) return { ok: false, reason: 'network_mismatch' };
  if (str(dest.memo) !== str(di.memo)) return { ok: false, reason: 'memo_mismatch' };

  const depositBy = Date.parse(str(di.depositBy));
  if (Number.isFinite(depositBy) && depositBy <= now.getTime()) return { ok: false, reason: 'offramp_deposit_window_closed' };

  const amount = num(dest.amount);
  const expected = expectedOfframpCryptoAmount(offramp);
  if (amount == null || expected == null) return { ok: false, reason: 'amount_missing' };
  if (Math.abs(amount - expected) > AMOUNT_TOLERANCE) return { ok: false, reason: 'amount_mismatch' };

  return { ok: true, amount };
}

/**
 * Settle the onramp's crypto leg internally when its paired offramp is
 * found. Returns true when settled (the caller must not send on-chain).
 */
export async function trySettleFiatToFiatInternally(
  deps: FiatToFiatSettlementDeps,
  onramp: SettlementOnramp
): Promise<boolean> {
  if (!FIAT_TO_FIAT_CONFIG.internalSettlement) return false;
  if (!onramp.txnRef || onramp.status !== 'FIAT_PROCESSED') return false;
  if (!isFiatToFiatFlow(str(asRecord(onramp.quoteInformation).flow))) return false;

  const address = str(asRecord(onramp.destination).walletAddress);
  if (!address) return false;

  const now = (deps.now ?? (() => new Date()))();
  const candidates = await deps.findOpenOfframpsByDepositAddress(onramp.userId, address);
  const reasons: string[] = [];
  const matches: { offramp: SettlementOfframp; amount: number }[] = [];
  for (const offramp of candidates) {
    const check = checkFiatToFiatPair(onramp, offramp, now);
    if (check.ok) matches.push({ offramp, amount: check.amount });
    else reasons.push(`${offramp.txnRef ?? offramp.id}:${check.reason}`);
  }
  // Each offramp gets its own deposit address, so the address names one
  // offramp. If two open offramps ever share one, do not guess which.
  if (matches.length > 1) {
    logger.warn(
      { onrampId: onramp.id, txnRef: onramp.txnRef, offramps: matches.map((m) => m.offramp.txnRef ?? m.offramp.id) },
      'fiat-to-fiat: deposit address matches more than one open offramp; sending crypto on-chain'
    );
    return false;
  }
  const pair = matches[0] ?? null;
  if (!pair) {
    logger.info(
      { onrampId: onramp.id, txnRef: onramp.txnRef, candidates: candidates.length, reasons },
      'fiat-to-fiat: no settleable offramp; sending crypto on-chain'
    );
    return false;
  }

  const { offramp, amount } = pair;
  const settledAt = now.toISOString();
  const dest = asRecord(onramp.destination);
  const settlement = {
    method: 'internal',
    onrampTxnRef: onramp.txnRef,
    offrampTxnRef: offramp.txnRef,
    amount,
    currency: str(dest.currency).toUpperCase(),
    network: str(dest.chain).toUpperCase(),
    address,
    settledAt,
  };
  const expected = expectedOfframpCryptoAmount(offramp) ?? amount;
  const offrampOrch = asRecord(asRecord(offramp.providerRefs).palremitOrchestrator);

  const claimed = await deps.claimOfframpCrypto(offramp.id, SETTLEABLE_OFFRAMP_STATUSES, {
    timeline: {
      ...asRecord(offramp.timeline),
      cryptoReceivedAmount: amount,
      cryptoExpectedAmount: expected,
      lastDepositCreditedAt: settledAt,
      cryptoConfirmedAt: settledAt,
      fiatToFiatSettlement: settlement,
    },
    providerRefs: {
      palremitOrchestrator: {
        ...offrampOrch,
        depositStatus: 'credited',
        cryptoReceivedAmount: amount,
        cryptoExpectedAmount: expected,
      },
      fiatToFiatSettlement: settlement,
    },
    receipt: { provider: 'internal', fiatToFiatSettlement: settlement },
  });
  if (!claimed) {
    logger.warn(
      { onrampId: onramp.id, offrampId: offramp.id },
      'fiat-to-fiat: offramp changed before it could be claimed; sending crypto on-chain'
    );
    return false;
  }

  const onrampOrch = asRecord(asRecord(onramp.providerRefs).palremitOrchestrator);
  await deps.updateOnrampStatus(onramp.id, 'COMPLETED', {
    failedReason: null,
    receipt: {
      provider: 'internal',
      txnRef: onramp.txnRef,
      completedAt: settledAt,
      awaitingWebhookConfirmation: false,
      fiatToFiatSettlement: settlement,
    },
    providerRefs: {
      palremitOrchestrator: { ...onrampOrch, withdrawalStatus: 'settled_internally', completedAt: settledAt },
      fiatToFiatSettlement: settlement,
    },
  });
  logger.info(
    { onrampId: onramp.id, offrampId: offramp.id, amount, currency: settlement.currency, network: settlement.network },
    'fiat-to-fiat: crypto leg settled internally; starting offramp payout'
  );

  deps.afterOnrampCompleted?.(onramp.id);
  try {
    await deps.advanceOfframpPayout(offramp.id);
  } catch (e) {
    logger.error({ offrampId: offramp.id, err: e }, 'fiat-to-fiat: offramp payout start failed after settlement');
  }
  return true;
}
