import { afterEach, describe, expect, it, vi } from 'vitest';
import { findPairMarkup } from '@/core/quotes/pairMarkup';
import {
  _resetPairMarkupRulesForTests,
  getPairMarkupRulesStatus,
  refreshPairMarkupRules,
  rulesFromSettings,
  setPairMarkupRulesFromSettings,
} from '@/core/quotes/pairMarkupStore';

vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

afterEach(() => {
  _resetPairMarkupRulesForTests();
});

describe('pair markup store', () => {
  it('uses the built-in config until the table has loaded', () => {
    expect(getPairMarkupRulesStatus().source).toBe('config');
    expect(findPairMarkup('usdc', 'eur')).toEqual({ fiat: 'EUR', markup: 0.002, side: 'sell' });
  });

  it('prices from the table once loaded (bps → fraction, per side)', () => {
    setPairMarkupRulesFromSettings([
      { fiat: 'EUR', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 35 },
      { fiat: 'eur', side: 'buy', cryptos: 'USDT', markupBps: 100 },
    ]);
    expect(getPairMarkupRulesStatus().source).toBe('database');
    expect(findPairMarkup('USDC', 'EUR')).toEqual({ fiat: 'EUR', markup: 0.0035, side: 'sell' });
    expect(findPairMarkup('EUR', 'USDT')).toEqual({ fiat: 'EUR', markup: 0.01, side: 'buy' });
    // EUR buy only applies to USDT now.
    expect(findPairMarkup('EUR', 'USDC')).toBeNull();
  });

  it('a pair with no row has no markup after a load (rows are the source of truth)', () => {
    setPairMarkupRulesFromSettings([{ fiat: 'CAD', side: 'sell', cryptos: 'USDC', markupBps: 20 }]);
    expect(findPairMarkup('USDC', 'EUR')).toBeNull();
    setPairMarkupRulesFromSettings([]);
    expect(findPairMarkup('USDC', 'CAD')).toBeNull();
  });

  it('keeps the last loaded rules when a reload fails', async () => {
    setPairMarkupRulesFromSettings([{ fiat: 'JPY', side: 'sell', cryptos: 'USDC', markupBps: 50 }]);
    const ok = await refreshPairMarkupRules(() => Promise.reject(new Error('db down')));
    expect(ok).toBe(false);
    expect(findPairMarkup('USDC', 'JPY')).toEqual({ fiat: 'JPY', markup: 0.005, side: 'sell' });
  });

  it('drops a reload that finishes after a newer one was applied', async () => {
    let finishOld: (rows: { fiat: string; side: string; cryptos: string; markupBps: number }[]) => void = () => {};
    const older = refreshPairMarkupRules(() => new Promise((resolve) => { finishOld = resolve; }));
    await refreshPairMarkupRules(async () => [{ fiat: 'EUR', side: 'sell', cryptos: 'USDC', markupBps: 25 }]);
    finishOld([{ fiat: 'EUR', side: 'sell', cryptos: 'USDC', markupBps: 20 }]);
    await older;
    expect(findPairMarkup('USDC', 'EUR')).toEqual({ fiat: 'EUR', markup: 0.0025, side: 'sell' });
  });

  it('skips rows with an unknown side, no cryptos or a negative markup', () => {
    expect(
      rulesFromSettings([
        { fiat: 'EUR', side: 'both', cryptos: 'USDC', markupBps: 20 },
        { fiat: 'EUR', side: 'sell', cryptos: ' , ', markupBps: 20 },
        { fiat: 'EUR', side: 'sell', cryptos: 'USDC', markupBps: -5 },
        { fiat: 'GBP', side: 'buy', cryptos: 'usd, usdc', markupBps: 45 },
      ])
    ).toEqual([{ fiat: 'GBP', crypto: ['USD', 'USDC'], markup: 0.0045, sides: ['buy'] }]);
  });
});
