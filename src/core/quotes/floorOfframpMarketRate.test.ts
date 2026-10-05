import { describe, it, expect } from 'vitest';
import {
  executableRateExcludingTransferFee,
  floorOfframpMarketRate,
} from '@/core/quotes/floorOfframpMarketRate';

describe('floorOfframpMarketRate', () => {
  it('caps currency-api mid at the live executable OwlPay rate', () => {
    // OFF-c58b07a9: stale currency-api 0.870293 vs OwlPay SEPA 0.855861.
    expect(floorOfframpMarketRate(0.870293, 0.855861)).toBe(0.855861);
  });

  it('keeps currency-api when it is already at or below the executable rate', () => {
    expect(floorOfframpMarketRate(0.85, 0.855861)).toBe(0.85);
  });

  it('ignores a missing or unusable executable rate', () => {
    expect(floorOfframpMarketRate(0.870293, null)).toBe(0.870293);
    expect(floorOfframpMarketRate(0.870293, 0)).toBe(0.870293);
    expect(floorOfframpMarketRate(0.870293, Number.NaN)).toBe(0.870293);
  });
});

function feeQuote(fee: string, dest: string, currency = 'USDC') {
  return {
    feeUnavailable: false,
    totalFee: { amount: fee, currency },
    destinationAmount: dest,
  };
}

describe('executableRateExcludingTransferFee', () => {
  it('strips the USD funding spread that is also charged as the transfer fee', () => {
    // OFF-1396fd70 (2026-10-03): dest 9920.15, source 9946.23, rate 0.99737806.
    const r = executableRateExcludingTransferFee({
      fromCurrency: 'usdt',
      toCurrency: 'usd',
      executableRate: 0.99737806,
      feeQuote: feeQuote('26.08', '9920.15'),
    });
    expect(r.embeddedFee).toBe(26.08);
    expect(r.executableRate!).toBeCloseTo(1, 4);
  });

  it('keeps the rate when the fee is not the spread inside it (USD WIRE flat $25)', () => {
    // 2026-10-05 KE wire: rate 0.99639255 implies ~36 spread, fee is the flat 25.
    const r = executableRateExcludingTransferFee({
      fromCurrency: 'usdt',
      toCurrency: 'usd',
      executableRate: 0.99639255,
      feeQuote: feeQuote('25', '9944.00'),
    });
    expect(r).toEqual({ executableRate: 0.99639255, embeddedFee: 0 });
  });

  it('keeps the rate when OwlPay reports source == destination', () => {
    const r = executableRateExcludingTransferFee({
      fromCurrency: 'usdt',
      toCurrency: 'usd',
      executableRate: 1,
      feeQuote: feeQuote('25', '975.00'),
    });
    expect(r).toEqual({ executableRate: 1, embeddedFee: 0 });
  });

  it('only applies to USD payouts', () => {
    const r = executableRateExcludingTransferFee({
      fromCurrency: 'usdt',
      toCurrency: 'eur',
      executableRate: 0.99737806,
      feeQuote: feeQuote('26.08', '9920.15'),
    });
    expect(r).toEqual({ executableRate: 0.99737806, embeddedFee: 0 });
  });

  it('only applies to stablecoin sends', () => {
    const r = executableRateExcludingTransferFee({
      fromCurrency: 'btc',
      toCurrency: 'usd',
      executableRate: 0.99737806,
      feeQuote: feeQuote('26.08', '9920.15'),
    });
    expect(r).toEqual({ executableRate: 0.99737806, embeddedFee: 0 });
  });

  it('keeps the rate when the fee is zero, unavailable or missing', () => {
    const base = { fromCurrency: 'usdt', toCurrency: 'usd', executableRate: 0.99737806 };
    expect(executableRateExcludingTransferFee({ ...base, feeQuote: feeQuote('0', '9920.15') }))
      .toEqual({ executableRate: 0.99737806, embeddedFee: 0 });
    expect(
      executableRateExcludingTransferFee({
        ...base,
        feeQuote: { ...feeQuote('26.08', '9920.15'), feeUnavailable: true },
      })
    ).toEqual({ executableRate: 0.99737806, embeddedFee: 0 });
    expect(executableRateExcludingTransferFee({ ...base, feeQuote: null }))
      .toEqual({ executableRate: 0.99737806, embeddedFee: 0 });
    expect(
      executableRateExcludingTransferFee({ ...base, feeQuote: feeQuote('26.08', '') })
    ).toEqual({ executableRate: 0.99737806, embeddedFee: 0 });
  });

  it('passes through a missing executable rate', () => {
    const r = executableRateExcludingTransferFee({
      fromCurrency: 'usdt',
      toCurrency: 'usd',
      executableRate: null,
      feeQuote: feeQuote('26.08', '9920.15'),
    });
    expect(r).toEqual({ executableRate: null, embeddedFee: 0 });
  });
});
