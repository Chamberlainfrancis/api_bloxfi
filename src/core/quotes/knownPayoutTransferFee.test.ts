import { describe, it, expect } from 'vitest';
import { knownPayoutTransferFeeUsdc } from '@/core/quotes/knownPayoutTransferFee';

describe('knownPayoutTransferFeeUsdc', () => {
  it("returns Palremit's $0 wire fee for non-GBP wire", () => {
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'wire', toCurrency: 'usd' })).toBe(0);
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'WIRE', toCurrency: 'AED' })).toBe(0);
    expect(knownPayoutTransferFeeUsdc({ destinationType: 'wire', toCurrency: 'eur' })).toBe(0);
  });

  it('does not guess a fee for GBP — Palremit must preview that rail', () => {
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
