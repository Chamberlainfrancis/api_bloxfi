import { describe, it, expect } from 'vitest';
import { knownPayoutTransferFeeUsdc } from '@/core/quotes/knownPayoutTransferFee';

describe('knownPayoutTransferFeeUsdc', () => {
  it('returns the $25 SWIFT fee for non-GBP wire', () => {
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'wire', toCurrency: 'usd' })).toBe(25);
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'WIRE', toCurrency: 'AED' })).toBe(25);
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'wire', toCurrency: 'eur' })).toBe(25);
  });

  it('does not invent $0 or $25 for GBP — Palremit must preview that rail', () => {
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'wire', toCurrency: 'gbp' })).toBeNull();
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'local_bank', toCurrency: 'GBP' })).toBeNull();
  });

  it('does not invent $0 for EUR SEPA — Palremit must preview the fee', () => {
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'local_bank', toCurrency: 'eur' })).toBeNull();
  });

  it('does not invent a fee for other local rails', () => {
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'local_bank', toCurrency: 'ngn' })).toBeNull();
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'local_bank', toCurrency: 'cny' })).toBeNull();
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'ach', toCurrency: 'usd' })).toBeNull();
  });
});
