/**
 * Pair-level FX markup, edited on the dashboard Rates tab (PairMarkupSetting).
 * There are no rates in code. Applied on currency-api marketRate; does not
 * change currency-api.
 *
 * Offramps (crypto → fiat) must have a saved sell markup: with no row the
 * quote and the offramp are refused (RATE_MARKUP_NOT_SET). Onramps with no
 * row still use the currency-api B2B rate.
 *
 * Buy (onramp, fiat → crypto): customerRate = marketRate × (1 + markup)
 * Sell (offramp, crypto → fiat): customerRate = marketRate × (1 − markup)
 */

import { applyOnrampAccountMarkup } from '@/core/quotes/onrampAccountMarkup';
import { getPairMarkupRules, pairMarkupRulesLoaded } from '@/core/quotes/pairMarkupStore';
import { FIAT_TO_FIAT_CONFIG, isFiatToFiatFlow } from '@/config/fiatToFiat';

export type { PairMarkupRule } from '@/core/quotes/pairMarkup.config';

export type PairMarkupSide = 'buy' | 'sell';

export interface PairMarkupMatch {
  fiat: string;
  markup: number;
  side: PairMarkupSide;
}

function norm(ccy: string): string {
  return ccy.trim().toUpperCase();
}

function sidesOf(rule: { sides?: readonly PairMarkupSide[] }): readonly PairMarkupSide[] {
  return rule.sides ?? ['buy', 'sell'];
}

/** Normal pair markup, multiplied by the flow's multiplier when `flow` opts in. */
export function findPairMarkup(
  fromCurrency: string,
  toCurrency: string,
  flow?: string | null
): PairMarkupMatch | null {
  const base = findBasePairMarkup(fromCurrency, toCurrency);
  if (!base || !isFiatToFiatFlow(flow)) return base;
  return { ...base, markup: base.markup * FIAT_TO_FIAT_CONFIG.markupMultiplier };
}

/** Thrown when an offramp pair has no saved sell markup. */
export const RATE_MARKUP_NOT_SET = 'RATE_MARKUP_NOT_SET';

function assertRulesLoaded(): void {
  // Nothing is priced before the table has loaded once: there is no code fallback.
  if (!pairMarkupRulesLoaded()) throw new Error('PALREMIT_RATES_UNAVAILABLE');
}

function findBasePairMarkup(fromCurrency: string, toCurrency: string): PairMarkupMatch | null {
  return findBasePairRule(fromCurrency, toCurrency)?.match ?? null;
}

function findBasePairRule(
  fromCurrency: string,
  toCurrency: string
): { match: PairMarkupMatch; requireProviderRate: boolean } | null {
  assertRulesLoaded();
  const from = norm(fromCurrency);
  const to = norm(toCurrency);
  if (!from || !to) return null;

  for (const rule of getPairMarkupRules()) {
    const fiat = norm(rule.fiat);
    const crypto = new Set(rule.crypto.map(norm));
    const sides = sidesOf(rule);
    if (from === fiat && crypto.has(to) && sides.includes('buy')) {
      return { match: { fiat: rule.fiat, markup: rule.markup, side: 'buy' }, requireProviderRate: false };
    }
    if (crypto.has(from) && to === fiat && sides.includes('sell')) {
      return {
        match: { fiat: rule.fiat, markup: rule.markup, side: 'sell' },
        requireProviderRate: rule.requireProviderRate !== false,
      };
    }
  }
  return null;
}

/**
 * Offramp (crypto → fiat) sell markup. Throws RATE_MARKUP_NOT_SET when no row
 * covers the pair, so no offramp is quoted or created without a saved markup.
 */
export function requireOfframpPairMarkup(
  fromCurrency: string,
  toCurrency: string,
  flow?: string | null
): PairMarkupMatch & { requireProviderRate: boolean } {
  const found = findBasePairRule(fromCurrency, toCurrency);
  if (!found || found.match.side !== 'sell') throw new Error(RATE_MARKUP_NOT_SET);
  const markup = isFiatToFiatFlow(flow)
    ? found.match.markup * FIAT_TO_FIAT_CONFIG.markupMultiplier
    : found.match.markup;
  return { ...found.match, markup, requireProviderRate: found.requireProviderRate };
}

/** Offramp pricing: marketRate × (1 − saved sell markup). Throws RATE_MARKUP_NOT_SET with no row. */
export function applyRequiredOfframpPairMarkup(p: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  marketRate: string | number | undefined | null;
  rateCurrency: string | undefined | null;
  perCurrency: string | undefined | null;
  flow?: string | null;
}): { conversionRate: string; conversion: number } {
  const match = requireOfframpPairMarkup(p.fromCurrency, p.toCurrency, p.flow);
  // Offramp rates are fiat per crypto everywhere else in the quote (receive =
  // send × rate), so that is the orientation when currency-api leaves it out.
  return applyPairMarkup({
    amount: p.amount,
    toCurrency: p.toCurrency,
    marketRate: p.marketRate,
    rateCurrency: p.rateCurrency || p.toCurrency,
    perCurrency: p.perCurrency || p.fromCurrency,
    markup: match.markup,
    side: 'sell',
  });
}

export function applyPairMarkup(p: {
  amount: number;
  toCurrency: string;
  marketRate: string | number | undefined | null;
  rateCurrency: string | undefined | null;
  perCurrency: string | undefined | null;
  markup: number;
  side: PairMarkupSide;
}): { conversionRate: string; conversion: number } {
  const signed = p.side === 'sell' ? -p.markup : p.markup;
  return applyOnrampAccountMarkup({
    amount: p.amount,
    toCurrency: p.toCurrency,
    marketRate: p.marketRate,
    rateCurrency: p.rateCurrency,
    perCurrency: p.perCurrency,
    markup: signed,
  });
}

/** Saved rule → marked conversion; miss → null (onramp only: the caller keeps the B2B rate). */
export function applyPairMarkupIfMatched(p: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  marketRate: string | number | undefined | null;
  rateCurrency: string | undefined | null;
  perCurrency: string | undefined | null;
  flow?: string | null;
}): { conversionRate: string; conversion: number } | null {
  const match = findPairMarkup(p.fromCurrency, p.toCurrency, p.flow);
  if (!match) return null;
  return applyPairMarkup({
    amount: p.amount,
    toCurrency: p.toCurrency,
    marketRate: p.marketRate,
    rateCurrency: p.rateCurrency,
    perCurrency: p.perCurrency,
    markup: match.markup,
    side: match.side,
  });
}
