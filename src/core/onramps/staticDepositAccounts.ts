/**
 * Platform receiving accounts for GBP / USD / GHS / NGN onramps.
 * Ops marks fiat received manually (no provider deposit webhook).
 *
 * GBP / GHS / NGN: preferred first (skip orchestrator provision for now).
 *   NGN Wema is temporary — revert to Kuda pooled VAs when ready.
 * USD: still try orchestrator first; use these only if provision fails.
 *
 * Each deposit gets a unique payment reference (from the onramp txnRef).
 * Customers must put that exact value in the bank transfer narration so
 * ops can match the inbound payment.
 */

import type { DepositInfo } from '@/types/onramp';

export type StaticDepositCurrency = 'GBP' | 'USD' | 'GHS' | 'NGN';

const STATIC: Record<
  StaticDepositCurrency,
  {
    bankName: string;
    accountName: string;
    accountNumber: string;
    routingNumber?: string;
    sortCode?: string;
    iban?: string;
    bic?: string;
    country: string;
  }
> = {
  GBP: {
    bankName: 'Clear Bank',
    accountName: 'Tranzy',
    accountNumber: '00000094',
    sortCode: '040954',
    iban: 'GB76CLRB04095400000094',
    bic: 'CLRBGB22436',
    country: 'GB',
  },
  USD: {
    bankName: 'Cross River Bank',
    accountName: 'Palremit',
    accountNumber: '387199357253',
    routingNumber: '021214891',
    country: 'US',
  },
  GHS: {
    bankName: 'FIRST BANK',
    accountName: 'Palremit limited',
    accountNumber: '9990000103912',
    routingNumber: 'INCEGHAC',
    country: 'GH',
  },
  // TEMP: Wema pooled RA — remove when Kuda VAs are restored.
  NGN: {
    bankName: 'wema',
    accountName: 'Palremit limited',
    accountNumber: '7943896852',
    routingNumber: '035',
    country: 'NG',
  },
};

/**
 * Payment reference for bank narration. Same as the onramp txnRef so ops can
 * match the inbound payment 1:1 (trimmed, no spaces).
 */
export function staticDepositNarrationRef(txnRef: string): string {
  return txnRef.trim().replace(/\s+/g, '');
}

function narrationLabel(asset: StaticDepositCurrency): string {
  if (asset === 'USD') return 'wire memo / narration';
  if (asset === 'GHS' || asset === 'NGN') return 'transfer narration / description';
  return 'payment narration / reference';
}

export function isStaticDepositCurrency(asset: string): asset is StaticDepositCurrency {
  const a = asset.trim().toUpperCase();
  return a === 'GBP' || a === 'USD' || a === 'GHS' || a === 'NGN';
}

/** Currencies that should skip orchestrator and use platform accounts immediately. */
export function isPreferredStaticDepositCurrency(asset: string): boolean {
  const a = asset.trim().toUpperCase();
  return a === 'GBP' || a === 'GHS' || a === 'NGN';
}

export function buildStaticFallbackDepositInfo(params: {
  currency: string;
  amount: number;
  txnRef: string;
  depositByIso: string;
}): DepositInfo | null {
  const asset = params.currency.trim().toUpperCase();
  if (!isStaticDepositCurrency(asset)) return null;
  const acct = STATIC[asset];
  const ref = staticDepositNarrationRef(params.txnRef);
  const routing = acct.routingNumber ?? acct.sortCode ?? '';
  const label = narrationLabel(asset);
  return {
    bankName: acct.bankName,
    beneficiary: {
      name: acct.accountName,
      address: '',
      country: acct.country,
    },
    wire: {
      routingNumber: routing,
      accountNumber: acct.accountNumber,
    },
    ...(acct.sortCode ? { sortCode: acct.sortCode } : {}),
    ...(acct.iban ? { iban: acct.iban } : {}),
    ...(acct.bic ? { bic: acct.bic } : {}),
    reference: ref,
    depositBy: params.depositByIso,
    instruction:
      `Deposit exactly ${params.amount} ${asset} to the account above before ${params.depositByIso}. ` +
      `IMPORTANT: add this exact reference to the ${label}: ${ref}. ` +
      `Transfers without this narration cannot be matched. ` +
      `Crypto is sent after ops confirms your fiat deposit.`,
  };
}
