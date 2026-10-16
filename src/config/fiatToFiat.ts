/**
 * Fiat-to-fiat flow (NGN in, USD/EUR out): an onramp pays USDT into an
 * offramp's deposit address. Clients opt in with `flow: "FIAT_TO_FIAT"` on
 * POST /onramps/quotes and POST /offramps/quotes. Plain crypto flows ignore
 * this file and keep their normal 30 minute offramp quote.
 *
 * Edit the values here; there are no env vars.
 */

export const FIAT_TO_FIAT_FLOW = 'FIAT_TO_FIAT';

/** Extra markup per leg: 0.003 = 30 bps. Change here. */
const EXTRA_MARKUP = 0.003;

export const FIAT_TO_FIAT_CONFIG = {
  /** Onramp leg: how long the client has to send the bank transfer. */
  onrampWindowMinutes: 48 * 60,
  /**
   * Offramp leg: how long the USDT deposit address stays open and the quote
   * stays valid. Must outlast the onramp window plus processing time.
   */
  offrampWindowMinutes: 72 * 60,
  /**
   * Extra FX markup added on top of the normal pair markup, to cover holding a
   * locked rate for days. Decimal fractions: 0.005 = 50 bps. 0 = no extra.
   * `buy` applies to the onramp leg, `sell` to the offramp leg.
   */
  extraMarkup: { buy: EXTRA_MARKUP, sell: EXTRA_MARKUP },
} as const;

export function isFiatToFiatFlow(flow: string | undefined | null): boolean {
  return flow === FIAT_TO_FIAT_FLOW;
}
