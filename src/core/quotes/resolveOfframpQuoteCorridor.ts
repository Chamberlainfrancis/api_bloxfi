/**
 * POST /offramps/quotes corridor: body fields, or the payout Account's
 * stored providerPayout.corridor when accountId is sent.
 */

import type { OfframpQuoteCorridor } from '@/types/quote';

export interface OfframpQuoteCorridorBody {
  country?: string;
  destinationType?: string;
  beneficiaryType?: 'individual' | 'business';
}

export interface OfframpAccountPayoutCorridor {
  asset: string;
  country: string;
  destinationType: string;
  beneficiaryType: 'individual' | 'business';
}

function normCountry(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? '';
}

function normRail(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function resolveOfframpQuoteCorridor(input: {
  toCurrency: string;
  body: OfframpQuoteCorridorBody;
  account: OfframpAccountPayoutCorridor | null;
}): OfframpQuoteCorridor {
  const to = input.toCurrency.trim().toLowerCase();
  const bodyCountry = normCountry(input.body.country);
  const bodyRail = normRail(input.body.destinationType);
  const bodyBeneficiary = input.body.beneficiaryType;

  if (input.account) {
    if (input.account.asset.trim().toLowerCase() !== to) {
      throw new Error('QUOTE_CORRIDOR_MISMATCH');
    }
    const accountCountry = normCountry(input.account.country);
    const accountRail = normRail(input.account.destinationType);
    if (bodyCountry && bodyCountry !== accountCountry) {
      throw new Error('QUOTE_CORRIDOR_MISMATCH');
    }
    if (bodyRail && bodyRail !== accountRail) {
      throw new Error('QUOTE_CORRIDOR_MISMATCH');
    }
    if (
      bodyBeneficiary &&
      input.account.beneficiaryType &&
      bodyBeneficiary !== input.account.beneficiaryType
    ) {
      throw new Error('QUOTE_CORRIDOR_MISMATCH');
    }
    const beneficiaryType = bodyBeneficiary ?? input.account.beneficiaryType;
    return {
      country: accountCountry,
      destinationType: accountRail,
      ...(beneficiaryType ? { beneficiaryType } : {}),
    };
  }

  if (!bodyCountry || !bodyRail) {
    throw new Error('CORRIDOR_REQUIRED');
  }
  return {
    country: bodyCountry,
    destinationType: bodyRail,
    ...(bodyBeneficiary ? { beneficiaryType: bodyBeneficiary } : {}),
  };
}
