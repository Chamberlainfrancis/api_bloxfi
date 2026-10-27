import { describe, expect, it, vi } from 'vitest';
import {
  deletePairMarkupSetting,
  normalizePairMarkupInput,
  PairMarkupValidationError,
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
    });
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
      { cryptos: 'USD,USDT,USDC', markupBps: 25, updatedBy: 'Emmanuel' }
    );
    expect(d.audit.createAdminAction).toHaveBeenCalledWith({
      txnType: 'pair_markup',
      txnId: 'EUR:sell',
      fromStatus: '20 bps (USD,USDT,USDC)',
      toStatus: '25 bps (USD,USDT,USDC)',
      note: 'Rate markup updated',
      actor: 'Emmanuel',
    });
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('adds a new rule', async () => {
    const d = deps(null);
    await savePairMarkupSetting(d, { fiat: 'NGN', side: 'sell', cryptos: 'USDT', markupBps: 30 });
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: 'NGN:sell', fromStatus: '', toStatus: '30 bps (USDT)', note: 'Rate markup added' })
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

describe('deletePairMarkupSetting', () => {
  it('removes, audits and reloads', async () => {
    const d = deps(setting());
    await expect(deletePairMarkupSetting(d, 'pm_1', 'ops')).resolves.toBe(true);
    expect(d.repo.deletePairMarkupSettingById).toHaveBeenCalledWith('pm_1');
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: 'EUR:sell', fromStatus: '20 bps (USD,USDT,USDC)', toStatus: '', note: 'Rate markup removed', actor: 'ops' })
    );
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('returns false for an unknown id', async () => {
    const d = deps(null);
    await expect(deletePairMarkupSetting(d, 'nope')).resolves.toBe(false);
    expect(d.audit.createAdminAction).not.toHaveBeenCalled();
  });
});
