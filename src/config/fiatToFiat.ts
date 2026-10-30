/**
 * Fiat-to-fiat flow (NGN in, USD/EUR out): an onramp pays USDT into an
 * offramp's deposit address. Clients opt in with `flow: "FIAT_TO_FIAT"` on
 * POST /onramps/quotes and POST /offramps/quotes. Plain crypto flows ignore
 * this file and keep their normal 30 minute offramp quote.
 *
 * Edit the values here; there are no env vars.
 */

export const FIAT_TO_FIAT_FLOW = 'FIAT_TO_FIAT';

export const FIAT_TO_FIAT_CONFIG = {
  /**
   * Onramp source currencies allowed in this flow, and how long the client has
   * to send the bank transfer. Any currency not listed is rejected.
   */
  onrampWindowMinutes: {
    NGN: 60,
    GHS: 60,
    GBP: 60,
    USD: 24 * 60,
  } as Readonly<Record<string, number>>,
  /** Onramp transfer types allowed per currency. Unlisted currencies are unrestricted. */
  onrampTransferTypes: { USD: ['wire'] } as Readonly<Record<string, readonly string[]>>,
  /**
   * Offramp leg: how long the USDT deposit address stays open and the quote
   * stays valid. Must outlast the longest onramp window plus processing time.
   */
  offrampWindowMinutes: 26 * 60,
  /** Palremit's normal pair markup is multiplied by this in the flow (2 = double). */
  markupMultiplier: 2,
  /**
   * When the onramp's fiat lands, settle its crypto leg into the paired
   * offramp internally instead of sending it on-chain to our own deposit
   * address (core/fiatToFiat/internalSettlement.ts). false = always send.
   */
  internalSettlement: true,
};

export function isFiatToFiatFlow(flow: string | undefined | null): boolean {
  return flow === FIAT_TO_FIAT_FLOW;
}

export function fiatToFiatOnrampWindowMinutes(currency: string): number | null {
  return FIAT_TO_FIAT_CONFIG.onrampWindowMinutes[currency.trim().toUpperCase()] ?? null;
}

export function fiatToFiatTransferTypeAllowed(currency: string, transferType: string | undefined): boolean {
  const allowed = FIAT_TO_FIAT_CONFIG.onrampTransferTypes[currency.trim().toUpperCase()];
  if (!allowed) return true;
  return allowed.includes((transferType ?? '').trim().toLowerCase());
}
