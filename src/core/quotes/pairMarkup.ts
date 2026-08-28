/**
 * Pair-level FX markup (USD↔EUR today).
 * Applied on currency-api marketRate; does not change currency-api.
 *
 * Buy (onramp, fiat → crypto): customerRate = marketRate × (1 + markup)
 * Sell (offramp, crypto → fiat): customerRate = marketRate × (1 − markup)
 */

import { applyOnrampAccountMarkup } from '@/core/quotes/onrampAccountMarkup';
import { PAIR_MARKUP_RULES } from '@/core/quotes/pairMarkup.config';

export type { PairMarkupRule } from '@/core/quotes/pairMarkup.config';
export { PAIR_MARKUP_RULES } from '@/core/quotes/pairMarkup.config';

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

export function findPairMarkup(fromCurrency: string, toCurrency: string): PairMarkupMatch | null {
  const from = norm(fromCurrency);
  const to = norm(toCurrency);
  if (!from || !to) return null;

  for (const rule of PAIR_MARKUP_RULES) {
    const fiat = norm(rule.fiat);
    const crypto = new Set(rule.crypto.map(norm));
    const sides = sidesOf(rule);
    if (from === fiat && crypto.has(to) && sides.includes('buy')) {
      return { fiat: rule.fiat, markup: rule.markup, side: 'buy' };
    }
    if (crypto.has(from) && to === fiat && sides.includes('sell')) {
      return { fiat: rule.fiat, markup: rule.markup, side: 'sell' };
    }
  }
  return null;
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

/** Config hit → marked conversion; miss → null (caller keeps the B2B rate). */
export function applyPairMarkupIfMatched(p: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  marketRate: string | number | undefined | null;
  rateCurrency: string | undefined | null;
  perCurrency: string | undefined | null;
}): { conversionRate: string; conversion: number } | null {
  const match = findPairMarkup(p.fromCurrency, p.toCurrency);
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
