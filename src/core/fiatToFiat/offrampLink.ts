/**
 * Fiat-to-fiat: an onramp may name the offramp it funds with
 * `destination.offrampId` (the OFF- txnRef). bloxfi then takes the crypto
 * destination from that offramp's deposit instructions, so the partner no
 * longer needs to register the deposit address as an external wallet.
 *
 * Every mismatch is rejected when the onramp is created, before any money
 * moves. Onramps without offrampId keep pairing by deposit address
 * (internalSettlement.ts).
 */

import { isFiatToFiatFlow } from '@/config/fiatToFiat';
import {
  expectedOfframpCryptoAmount,
  priorCryptoReceivedAmount,
} from '@/core/offramps/offrampDepositAmount';
import { SETTLEABLE_OFFRAMP_STATUSES, sameAddress } from '@/core/fiatToFiat/internalSettlement';
import type { OfframpStatus } from '@/types/offramp';

/** Same tolerance as internal settlement: equal to the cent. */
const AMOUNT_TOLERANCE = 0.01;

export type OfframpLinkErrorCode = 'NOT_FOUND' | 'INVALID_REQUEST' | 'CONFLICT';

export class OfframpLinkError extends Error {
  constructor(
    readonly code: OfframpLinkErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'OfframpLinkError';
  }
}

export interface LinkableOfframp {
  id: string;
  userId: string;
  txnRef: string | null;
  status: string;
  source: unknown;
  depositInstructions: unknown;
  rateInformation: unknown;
  timeline: unknown;
}

export interface OfframpLinkDeps {
  findOfframpByTxnRef(txnRef: string): Promise<LinkableOfframp | null>;
  /** Onramps still able to fund this offramp, linked by offrampId or paying its address. */
  findLiveOnrampsForOfframp(offrampTxnRef: string, address: string): Promise<Array<{ txnRef: string | null }>>;
  now?: () => Date;
}

export interface OfframpLinkInput {
  offrampId: string;
  userId: string;
  /** From the locked onramp quote. Required: the flow is only offered through quotes. */
  quote: { flow?: string; toCurrency: string; destinationChain: string; receiveNet: number } | null;
  /** Set when the partner also sent externalWalletId. */
  walletAddress?: string | null;
}

export interface OfframpLink {
  offrampId: string;
  address: string;
  memo: string | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function fmt(n: number): string {
  return String(Math.round(n * 1e6) / 1e6);
}

/** Validates the link and returns where the onramp's crypto must go. */
export async function resolveOfframpLink(deps: OfframpLinkDeps, input: OfframpLinkInput): Promise<OfframpLink> {
  const ref = input.offrampId.trim();
  const offramp = await deps.findOfframpByTxnRef(ref);
  if (!offramp || offramp.userId !== input.userId) {
    throw new OfframpLinkError('NOT_FOUND', 'destination.offrampId does not match an offramp for this business');
  }

  if (!input.quote || !isFiatToFiatFlow(input.quote.flow) || !isFiatToFiatFlow(str(asRecord(offramp.rateInformation).flow))) {
    throw new OfframpLinkError('INVALID_REQUEST', 'destination.offrampId is only allowed in the fiat-to-fiat flow');
  }

  const di = asRecord(offramp.depositInstructions);
  const address = str(di.address);
  const depositBy = Date.parse(str(di.depositBy));
  const now = (deps.now ?? (() => new Date()))();
  if (
    !SETTLEABLE_OFFRAMP_STATUSES.includes(offramp.status as OfframpStatus) ||
    priorCryptoReceivedAmount(offramp.timeline) > 0 ||
    !address ||
    (Number.isFinite(depositBy) && depositBy <= now.getTime())
  ) {
    throw new OfframpLinkError('INVALID_REQUEST', `offramp ${ref} is not awaiting crypto`);
  }

  const wantAsset = str(di.currency).toUpperCase();
  const wantNetwork = str(di.network).toUpperCase();
  const payAsset = input.quote.toCurrency.trim().toUpperCase();
  const payNetwork = input.quote.destinationChain.trim().toUpperCase();
  if (payAsset !== wantAsset || payNetwork !== wantNetwork) {
    throw new OfframpLinkError(
      'INVALID_REQUEST',
      `onramp pays ${payAsset}/${payNetwork} but offramp ${ref} expects ${wantAsset}/${wantNetwork}`
    );
  }

  const expected = expectedOfframpCryptoAmount(offramp);
  if (expected == null || Math.abs(input.quote.receiveNet - expected) > AMOUNT_TOLERANCE) {
    throw new OfframpLinkError(
      'INVALID_REQUEST',
      `onramp amount ${fmt(input.quote.receiveNet)} ${payAsset} does not match offramp deposit ${expected == null ? 'unknown' : fmt(expected)} ${wantAsset}`
    );
  }

  if (input.walletAddress != null && !sameAddress(input.walletAddress.trim(), address)) {
    throw new OfframpLinkError(
      'INVALID_REQUEST',
      `destination.externalWalletId address is not the deposit address of ${ref}`
    );
  }

  const live = await deps.findLiveOnrampsForOfframp(ref, address);
  if (live.length > 0) {
    throw new OfframpLinkError(
      'CONFLICT',
      `offramp ${ref} is already linked to ${live[0]!.txnRef ?? 'another onramp'}`
    );
  }

  const memo = str(di.memo);
  return { offrampId: ref, address, memo: memo || null };
}
