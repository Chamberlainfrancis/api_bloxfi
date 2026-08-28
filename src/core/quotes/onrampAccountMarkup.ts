/**
 * Capability + currency onramp FX markup (named USD today).
 * Applied on currency-api marketRate; does not change currency-api.
 *
 * EUR onramp is a shared house SEPA account (every business, including
 * Graph/Bancara-pinned ones). Its 2.4% buy markup lives in pairMarkup.config.
 */

import type { AccountCapabilities } from '@/types/account';
import {
  ONRAMP_ACCOUNT_MARKUP_RULES,
  type OnrampAccountMarkupRule,
} from '@/core/quotes/onrampAccountMarkup.config';

export type { OnrampAccountMarkupRule, OnrampMarkupCapability } from '@/core/quotes/onrampAccountMarkup.config';
export { ONRAMP_ACCOUNT_MARKUP_RULES } from '@/core/quotes/onrampAccountMarkup.config';

export function findOnrampAccountMarkup(
  fromCurrency: string,
  capabilities: AccountCapabilities | undefined
): OnrampAccountMarkupRule | null {
  if (!capabilities) return null;
  const from = fromCurrency.trim().toUpperCase();
  for (const rule of ONRAMP_ACCOUNT_MARKUP_RULES) {
    if (rule.currency.toUpperCase() !== from) continue;
    if (capabilities[rule.capability] != null) return rule;
  }
  return null;
}

export function resolveOnrampAccountMarkup(params: {
  fromCurrency: string;
  account: { currency?: string | null; railType?: string | null; accountType?: string | null };
  capabilities: AccountCapabilities | undefined;
}): OnrampAccountMarkupRule | null {
  const rail = (params.account.railType ?? '').trim().toLowerCase();
  if (rail !== 'onramp') return null;
  // Onramp rows store the corridor on accountType (e.g. "usd") and often leave currency null.
  const accountCurrency = (
    params.account.currency?.trim() ||
    params.account.accountType?.trim() ||
    ''
  ).toUpperCase();
  const from = params.fromCurrency.trim().toUpperCase();
  if (!accountCurrency || accountCurrency !== from) return null;
  return findOnrampAccountMarkup(params.fromCurrency, params.capabilities);
}

export function applyOnrampAccountMarkup(p: {
  amount: number;
  toCurrency: string;
  marketRate: string | number | undefined | null;
  rateCurrency: string | undefined | null;
  perCurrency: string | undefined | null;
  markup: number;
}): { conversionRate: string; conversion: number } {
  const marketRate =
    typeof p.marketRate === 'string' ? parseFloat(p.marketRate) : p.marketRate;
  if (marketRate == null || !Number.isFinite(marketRate) || marketRate <= 0) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const rateCurrency = p.rateCurrency?.trim();
  const perCurrency = p.perCurrency?.trim();
  if (!rateCurrency || !perCurrency) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const customerRate = marketRate * (1 + p.markup);
  if (!Number.isFinite(customerRate) || customerRate <= 0) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }

  const to = p.toCurrency.trim().toUpperCase();
  const rc = rateCurrency.toUpperCase();
  const pc = perCurrency.toUpperCase();
  let conversion: number;
  if (to === rc) {
    conversion = p.amount * customerRate;
  } else if (to === pc) {
    conversion = p.amount / customerRate;
  } else {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  if (!Number.isFinite(conversion) || conversion <= 0) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  return { conversionRate: String(customerRate), conversion };
}
