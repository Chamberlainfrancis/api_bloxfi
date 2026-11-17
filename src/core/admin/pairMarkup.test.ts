import { describe, expect, it, vi } from 'vitest';
import {
  deletePairMarkupSetting,
  normalizePairMarkupInput,
  PairMarkupValidationError,
  pausedOfframpCurrencies,
  savePairMarkupSetting,
  type PairMarkupDeps,
  type PairMarkupSetting,
} from '@/core/admin/pairMarkup';

function setting(partial: Partial<PairMarkupSetting> = {}): PairMarkupSetting {
  return {
    id: 'pm_1',
    fiat: 'EUR',
    side: 'sell',
    cryptos: 'USD,USDT,USDC',
    markupBps: 20,
    requireProviderRate: true,
    updatedBy: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...partial,
  };
}

function deps(existing: PairMarkupSetting | null): PairMarkupDeps {
  return {
    repo: {
      listPairMarkupSettings: vi.fn(),
      findPairMarkupSettingById: vi.fn().mockResolvedValue(existing),
      findPairMarkupSettingByKey: vi.fn().mockResolvedValue(existing),
      upsertPairMarkupSetting: vi.fn().mockImplementation(async (key, data) => setting({ ...key, ...data })),
      deletePairMarkupSettingById: vi.fn(),
      listRecentOfframpCurrencies: vi.fn().mockResolvedValue([]),
    },
    audit: { createAdminAction: vi.fn() },
    reload: vi.fn().mockResolvedValue(true),
  };
}

describe('normalizePairMarkupInput', () => {
  it('upper-cases, dedupes and orders cryptos', () => {
    expect(normalizePairMarkupInput({ fiat: ' eur ', side: 'sell', cryptos: ['usdc', 'USD', 'usdc'], markupBps: 12.5 })).toEqual({
      key: { fiat: 'EUR', side: 'sell' },
      cryptos: 'USD,USDC',
      markupBps: 12.5,
      requireProviderRate: true,
    });
  });

  it.each([1.1, 0.29, 0.07, 12.35])('accepts %s bps despite float rounding', (bps) => {
    expect(normalizePairMarkupInput({ fiat: 'EUR', side: 'sell', markupBps: bps }).markupBps).toBe(bps);
  });

  it('defaults cryptos to USD/USDT/USDC minus the fiat itself', () => {
    expect(normalizePairMarkupInput({ fiat: 'USD', side: 'sell', markupBps: 20 }).cryptos).toBe('USDT,USDC');
    expect(normalizePairMarkupInput({ fiat: 'AUD', side: 'buy', markupBps: 50 }).cryptos).toBe('USD,USDT,USDC');
  });

  it.each([
    [{ fiat: 'EURO', side: 'sell' as const, markupBps: 20 }, '3-letter'],
    [{ fiat: 'EUR', side: 'sell' as const, cryptos: ['BTC'], markupBps: 20 }, 'USD, USDT, USDC'],
    [{ fiat: 'USD', side: 'sell' as const, cryptos: ['USD'], markupBps: 20 }, 'not the fiat'],
    [{ fiat: 'EUR', side: 'sell' as const, markupBps: -1 }, 'between 0 and 1000'],
    [{ fiat: 'EUR', side: 'sell' as const, markupBps: 1001 }, 'between 0 and 1000'],
    [{ fiat: 'EUR', side: 'sell' as const, markupBps: 12.345 }, '2 decimal places'],
  ])('rejects %o', (input, msg) => {
    expect(() => normalizePairMarkupInput(input)).toThrow(PairMarkupValidationError);
    expect(() => normalizePairMarkupInput(input)).toThrow(msg);
  });
});

describe('savePairMarkupSetting', () => {
  it('updates, audits the old and new value, and reloads pricing', async () => {
    const d = deps(setting());
    await savePairMarkupSetting(d, { fiat: 'eur', side: 'sell', markupBps: 25, actor: ' Emmanuel ' });
    expect(d.repo.upsertPairMarkupSetting).toHaveBeenCalledWith(
      { fiat: 'EUR', side: 'sell' },
      { cryptos: 'USD,USDT,USDC', markupBps: 25, requireProviderRate: true, updatedBy: 'Emmanuel' }
    );
    expect(d.audit.createAdminAction).toHaveBeenCalledWith({
      txnType: 'pair_markup',
      txnId: 'EUR:sell',
      fromStatus: '20 bps (USD,USDT,USDC), provider rate required',
      toStatus: '25 bps (USD,USDT,USDC), provider rate required',
      note: 'Rate markup updated',
      actor: 'Emmanuel',
    });
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('adds a new rule', async () => {
    const d = deps(null);
    await savePairMarkupSetting(d, { fiat: 'NGN', side: 'sell', cryptos: 'USDT', markupBps: 30, requireProviderRate: false });
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: 'NGN:sell', fromStatus: '', toStatus: '30 bps (USDT), provider rate optional', note: 'Rate markup added' })
    );
  });

  it('does nothing when the rule is unchanged', async () => {
    const d = deps(setting());
    await savePairMarkupSetting(d, { fiat: 'EUR', side: 'sell', cryptos: 'USDC,USDT,USD', markupBps: 20 });
    expect(d.repo.upsertPairMarkupSetting).not.toHaveBeenCalled();
    expect(d.audit.createAdminAction).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe('requireProviderRate', () => {
  it('is saved on sell rows and always true on buy rows', () => {
    expect(normalizePairMarkupInput({ fiat: 'GBP', side: 'sell', markupBps: 20, requireProviderRate: false }).requireProviderRate).toBe(false);
    expect(normalizePairMarkupInput({ fiat: 'GBP', side: 'sell', markupBps: 20 }).requireProviderRate).toBe(true);
    expect(normalizePairMarkupInput({ fiat: 'GBP', side: 'buy', markupBps: 45, requireProviderRate: false }).requireProviderRate).toBe(true);
  });

  it('a change to it alone is saved and audited', async () => {
    const d = deps(setting());
    await savePairMarkupSetting(d, { fiat: 'EUR', side: 'sell', markupBps: 20, requireProviderRate: false });
    expect(d.repo.upsertPairMarkupSetting).toHaveBeenCalledTimes(1);
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ toStatus: '20 bps (USD,USDT,USDC), provider rate optional' })
    );
  });
});

describe('pausedOfframpCurrencies', () => {
  it('lists recent offramp currencies with no sell row', () => {
    expect(
      pausedOfframpCurrencies(
        [
          { fiat: 'EUR', side: 'sell' },
          { fiat: 'GBP', side: 'buy' },
        ],
        ['eur', 'GBP', 'NGN', 'NGN', 'usdt', '']
      )
    ).toEqual(['GBP', 'NGN']);
  });
});

describe('deletePairMarkupSetting', () => {
  it('removes, audits and reloads', async () => {
    const d = deps(setting());
    await expect(deletePairMarkupSetting(d, 'pm_1', 'ops')).resolves.toBe(true);
    expect(d.repo.deletePairMarkupSettingById).toHaveBeenCalledWith('pm_1');
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: 'EUR:sell', fromStatus: '20 bps (USD,USDT,USDC), provider rate required', toStatus: '', note: 'Rate markup removed', actor: 'ops' })
    );
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('returns false for an unknown id', async () => {
    const d = deps(null);
    await expect(deletePairMarkupSetting(d, 'nope')).resolves.toBe(false);
    expect(d.audit.createAdminAction).not.toHaveBeenCalled();
  });
});
