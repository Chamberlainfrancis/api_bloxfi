import { describe, it, expect } from 'vitest';
import { hydrateOfframpCreateFromQuote } from '@/core/quotes/hydrateCreateFromQuote';
import type { OfframpQuoteSnapshot } from '@/types/quote';

const snapshot: OfframpQuoteSnapshot = {
  version: 1,
  fromCurrency: 'usdt',
  toCurrency: 'usd',
  fromChain: 'TRC20',
  clientFromChain: 'TRC20',
  sendAmount: 1000,
  corridor: { country: 'US', destinationType: 'local_bank', beneficiaryType: 'individual' },
  platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' },
  baseConversionRate: '0.9984',
  conversionRate: '0.96903628624',
  inverseRate: '1.031957',
  rateValidUntil: '2026-06-19T12:32:07.233Z',
  destinationAmount: 969.04,
  quote: {
    sendGross: { amount: '1000', currency: 'usdt' },
    sendNet: { amount: '980.39', currency: 'usdt' },
    receiveGross: { amount: '998.40', currency: 'usd' },
    baseReceiveNet: { amount: '978.82', currency: 'usd' },
    receiveNet: { amount: '969.04', currency: 'usd' },
    transferFee: { fees: [], total: null, unavailable: false },
  },
  fees: {
    platformFee: {
      type: 'PERCENTAGE',
      value: '0.01',
      amount: '9.78',
      currency: 'usd',
      walletAddress: '0xFee',
    },
  },
  rateInformation: {
    rate: '0.96903628624',
    conversionRate: '0.96903628624',
    inverseRate: '1.031957',
    fromCurrency: 'usdt',
    toCurrency: 'usd',
    fromChain: 'TRC20',
  },
};

describe('hydrateOfframpCreateFromQuote', () => {
  it('fills pricing from snapshot and keeps execution fields', () => {
    const body = hydrateOfframpCreateFromQuote(snapshot, {
      source: { userId: 'user-1', externalWalletId: 'wallet-1' },
      destination: {
        userId: 'user-1',
        accountId: 'acc-1',
        purposeOfPayment: 'FAMILY_MAINTENANCE',
      },
      metadata: { isSelfTransfer: false },
    });
    expect(body.source.amount).toBe(1000);
    expect(body.source.currency).toBe('usdt');
    expect(body.destination.amount).toBe(969.04);
    expect(body.platformFee?.value).toBe(0.01);
    expect(body.metadata).toEqual({ isSelfTransfer: false });
  });
});
