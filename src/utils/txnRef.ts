/**
 * BloxFi-wide transaction reference (ON-… / OFF-…).
 *
 * **Palremit Liquidity Orchestrator:** this exact string is sent as `client_reference` on
 * `POST /v1/provisioned-accounts` and `POST /v1/withdrawals`. Webhooks return the same value as
 * `data.client_reference` (and on nested `withdrawal.client_reference` where applicable).
 * BloxFi API surfaces it as `transferDetails.txnRef` and `transferDetails.clientReference` (identical).
 */

import { randomBytes } from 'crypto';

const ON_PREFIX = 'ON-';
const OFF_PREFIX = 'OFF-';
const HEX_LEN = 24;

function randomHex24(): string {
  return randomBytes(12).toString('hex');
}

/** New onramp row — e.g. ON-7a1f0c92e84b1c0e3d2a6b4f */
export function generateOnrampTxnRef(): string {
  return `${ON_PREFIX}${randomHex24()}`;
}

/** New offramp row — e.g. OFF-c4a18b6e3a71f02d4e5b9c08 */
export function generateOfframpTxnRef(): string {
  return `${OFF_PREFIX}${randomHex24()}`;
}

const ON_RE = /^ON-[a-f0-9]{24}$/;
const OFF_RE = /^OFF-[a-f0-9]{24}$/;

export function isOnrampTxnRef(s: string): boolean {
  return ON_RE.test(s.trim());
}

export function isOfframpTxnRef(s: string): boolean {
  return OFF_RE.test(s.trim());
}

const FEE_SUFFIX = '-FEE';

/** Palremit `client_reference` for a ramp platform-fee settlement withdrawal. */
export function buildRampFeeClientReference(txnRef: string): string {
  return `${txnRef.trim()}${FEE_SUFFIX}`;
}

function parseFeeParent(clientRef: string): string | null {
  const trimmed = clientRef.trim();
  if (!trimmed.endsWith(FEE_SUFFIX)) return null;
  return trimmed.slice(0, -FEE_SUFFIX.length);
}

/** Palremit `client_reference` for offramp platform-fee settlement withdrawal. */
export function buildOfframpFeeClientReference(txnRef: string): string {
  return buildRampFeeClientReference(txnRef);
}

/** Parent offramp `txnRef` when `client_reference` is a fee settlement ref. */
export function parseOfframpFeeClientReference(clientRef: string): string | null {
  const parent = parseFeeParent(clientRef);
  return parent != null && isOfframpTxnRef(parent) ? parent : null;
}

export function isOfframpFeeClientReference(clientRef: string): boolean {
  return parseOfframpFeeClientReference(clientRef) != null;
}

/** Palremit `client_reference` for onramp platform-fee settlement withdrawal. */
export function buildOnrampFeeClientReference(txnRef: string): string {
  return buildRampFeeClientReference(txnRef);
}

/** Parent onramp `txnRef` when `client_reference` is a fee settlement ref. */
export function parseOnrampFeeClientReference(clientRef: string): string | null {
  const parent = parseFeeParent(clientRef);
  return parent != null && isOnrampTxnRef(parent) ? parent : null;
}
