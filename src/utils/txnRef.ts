/**
 * BloxFi-wide transaction reference: opaque, stable, sent to Palremit and echoed in webhooks as `data.txnRef`.
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
