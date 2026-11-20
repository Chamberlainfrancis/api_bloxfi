import { describe, expect, it, vi } from 'vitest';
import {
  deletePairMarkupSetting,
  normalizePairMarkupInput,
  PairMarkupValidationError,
  pausedOfframpCurrencies,
  savePairMarkupSetting,
  PairMarkupNotFoundError,
  type PairMarkupDeps,
  type PairMarkupSetting,
  type PairMarkupWriteTx,
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

/** In-memory table so saves can be checked end to end. */
function deps(existing: PairMarkupSetting | PairMarkupSetting[] | null) {
  let rows: PairMarkupSetting[] = existing == null ? [] : Array.isArray(existing) ? [...existing] : [existing];
  let n = 100;
  const tx: PairMarkupWriteTx = {
    listPairMarkupSettingsForKey: vi.fn(async (key) => rows.filter((r) => r.fiat === key.fiat && r.side === key.side)),
    findPairMarkupSettingById: vi.fn(async (id) => rows.find((r) => r.id === id) ?? null),
    createPairMarkupSetting: vi.fn(async (key, data) => {
      const row = setting({ id: `pm_${++n}`, ...key, ...data });
      rows.push(row);
      return row;
    }),
    updatePairMarkupSetting: vi.fn(async (id, data) => {
      const i = rows.findIndex((r) => r.id === id);
      rows[i] = { ...rows[i]!, ...data };
      return rows[i]!;
    }),
    deletePairMarkupSettingById: vi.fn(async (id) => {
      rows = rows.filter((r) => r.id !== id);
    }),
  };
  const d: PairMarkupDeps = {
    repo: {
      listPairMarkupSettings: vi.fn(async () => rows),
      findPairMarkupSettingById: vi.fn(async (id: string) => rows.find((r) => r.id === id) ?? null),
      deletePairMarkupSettingById: vi.fn(async (id: string) => {
        rows = rows.filter((r) => r.id !== id);
      }),
      withPairMarkupWriteLock: vi.fn(async (fn) => fn(tx)),
      listRecentOfframpCurrencies: vi.fn().mockResolvedValue([]),
    },
    audit: { createAdminAction: vi.fn() },
    reload: vi.fn().mockResolvedValue(true),
  };
  return Object.assign(d, { tx, rows: () => rows });
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
    expect(d.tx.updatePairMarkupSetting).toHaveBeenCalledWith(
      'pm_1',
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
    expect(d.tx.updatePairMarkupSetting).not.toHaveBeenCalled();
    expect(d.tx.createPairMarkupSetting).not.toHaveBeenCalled();
    expect(d.audit.createAdminAction).not.toHaveBeenCalled();
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe('savePairMarkupSetting: different markups per coin', () => {
  const usdSell = (p: Partial<PairMarkupSetting> = {}) =>
    setting({ id: 'pm_usd', fiat: 'USD', side: 'sell', cryptos: 'USDT,USDC', markupBps: 20, ...p });

  it('adding USDT 25 bps splits USDT out of the shared USD row in one save', async () => {
    const d = deps(usdSell());
    await savePairMarkupSetting(d, { fiat: 'USD', side: 'sell', cryptos: ['USDT'], markupBps: 25, actor: 'Emmanuel' });
    const rows = d.rows().map((r) => ({ cryptos: r.cryptos, markupBps: r.markupBps }));
    expect(rows).toEqual([
      { cryptos: 'USDC', markupBps: 20 },
      { cryptos: 'USDT', markupBps: 25 },
    ]);
    expect(d.repo.withPairMarkupWriteLock).toHaveBeenCalledTimes(1);
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        txnId: 'USD:sell',
        fromStatus: '20 bps (USDT,USDC), provider rate required',
        toStatus: '20 bps (USDC), provider rate required',
        note: 'Rate markup narrowed: USDT moved to its own row',
      })
    );
    expect(d.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ fromStatus: '', toStatus: '25 bps (USDT), provider rate required', note: 'Rate markup added' })
    );
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('a row that loses all its coins is removed', async () => {
    const d = deps([usdSell({ id: 'a', cryptos: 'USDT', markupBps: 25 }), usdSell({ id: 'b', cryptos: 'USDC', markupBps: 20 })]);
    await savePairMarkupSetting(d, { fiat: 'USD', side: 'sell', cryptos: ['USDT', 'USDC'], markupBps: 22 });
    expect(d.rows().map((r) => [r.cryptos, r.markupBps])).toEqual([['USDT,USDC', 22]]);
  });

  it('editing a row by id changes only that row', async () => {
    const d = deps([usdSell({ id: 'a', cryptos: 'USDT', markupBps: 25 }), usdSell({ id: 'b', cryptos: 'USDC', markupBps: 20 })]);
    await savePairMarkupSetting(d, { id: 'a', fiat: 'USD', side: 'sell', cryptos: ['USDT'], markupBps: 30 });
    expect(d.rows().map((r) => [r.id, r.cryptos, r.markupBps])).toEqual([
      ['a', 'USDT', 30],
      ['b', 'USDC', 20],
    ]);
  });

  it('a different currency or direction is never touched', async () => {
    const d = deps([usdSell(), setting({ id: 'eur', fiat: 'EUR', side: 'sell', cryptos: 'USD,USDT,USDC' })]);
    await savePairMarkupSetting(d, { fiat: 'USD', side: 'sell', cryptos: ['USDT'], markupBps: 25 });
    expect(d.rows().find((r) => r.id === 'eur')?.cryptos).toBe('USD,USDT,USDC');
  });

  it('refuses to move a row to another currency, and 404s an unknown id', async () => {
    const d = deps(usdSell());
    await expect(savePairMarkupSetting(d, { id: 'pm_usd', fiat: 'EUR', side: 'sell', markupBps: 25 })).rejects.toThrow(
      PairMarkupValidationError
    );
    await expect(savePairMarkupSetting(d, { id: 'nope', fiat: 'USD', side: 'sell', markupBps: 25 })).rejects.toThrow(
      PairMarkupNotFoundError
    );
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
    expect(d.tx.updatePairMarkupSetting).toHaveBeenCalledTimes(1);
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

  it('lists coins left without a sell row', () => {
    expect(
      pausedOfframpCurrencies(
        [
          { fiat: 'USD', side: 'sell', cryptos: 'USDT' },
          { fiat: 'EUR', side: 'sell', cryptos: 'USD,USDT,USDC' },
        ],
        ['USD', 'EUR']
      )
    ).toEqual(['USD from USDC']);
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
