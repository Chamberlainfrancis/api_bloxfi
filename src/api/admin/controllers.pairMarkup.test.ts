import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { deletePairMarkup, listPairMarkups, putPairMarkup } from '@/api/admin/controllers';
import * as pairMarkupRepo from '@/db/repositories/pairMarkup.repo';
import * as adminActionRepo from '@/db/repositories/adminAction.repo';
import * as refresh from '@/jobs/pairMarkupRefresh';

vi.mock('@/config', () => ({
  env: { PALREMIT_LIQUIDITY_TENANT_ID: 'tenant_test', DASHBOARD_MARK_SECRET: 'pr2026' },
}));
vi.mock('@/services/palremitAdapters', () => ({ createPalremitLiquidityAdapter: vi.fn(() => vi.fn()) }));
vi.mock('@/db/repositories/user.repo', () => ({ listUsers: vi.fn(), searchUsers: vi.fn(), mergeUserMetadata: vi.fn() }));
vi.mock('@/db/repositories/pairMarkup.repo', () => ({
  listPairMarkupSettings: vi.fn(),
  findPairMarkupSettingById: vi.fn(),
  findPairMarkupSettingByKey: vi.fn(),
  upsertPairMarkupSetting: vi.fn(),
  deletePairMarkupSettingById: vi.fn(),
}));
vi.mock('@/db/repositories/adminAction.repo', () => ({ createAdminAction: vi.fn(), listAdminActionsForTxn: vi.fn() }));
vi.mock('@/jobs/pairMarkupRefresh', () => ({ reloadPairMarkupRules: vi.fn().mockResolvedValue(true) }));

const ROW = {
  id: 'pm_1',
  fiat: 'EUR',
  side: 'sell' as const,
  cryptos: 'USD,USDT,USDC',
  markupBps: 20,
  updatedBy: 'ops',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
};

function buildResponse(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function req(parts: { body?: unknown; headers?: Record<string, string>; params?: Record<string, string> }): Request {
  return { body: parts.body ?? {}, headers: parts.headers ?? {}, params: parts.params ?? {}, query: {} } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('listPairMarkups', () => {
  it('returns the rows and the pricing status (no passcode needed to view)', async () => {
    vi.mocked(pairMarkupRepo.listPairMarkupSettings).mockResolvedValue([ROW]);
    const res = buildResponse();
    await listPairMarkups(req({}), res, vi.fn() as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = vi.mocked(res.json).mock.calls[0]?.[0] as { data: { items: unknown[]; maxBps: number } };
    expect(body.data.items).toEqual([ROW]);
    expect(body.data.maxBps).toBe(1000);
  });
});

describe('putPairMarkup', () => {
  it('rejects a missing passcode with 401 before touching the repo', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putPairMarkup(req({ body: { fiat: 'EUR', side: 'sell', markupBps: 25 } }), buildResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Incorrect passcode', statusCode: 401 }));
    expect(pairMarkupRepo.upsertPairMarkupSetting).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range markup with 400', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putPairMarkup(
      req({ body: { fiat: 'EUR', side: 'sell', markupBps: 5000 }, headers: { 'x-dashboard-secret': 'pr2026' } }),
      buildResponse(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(pairMarkupRepo.upsertPairMarkupSetting).not.toHaveBeenCalled();
  });

  it.each(['', null])('rejects a blank markup (%o) with 400 instead of saving 0', async (markupBps) => {
    const next = vi.fn() as unknown as NextFunction;
    await putPairMarkup(
      req({ body: { fiat: 'EUR', side: 'buy', markupBps }, headers: { 'x-dashboard-secret': 'pr2026' } }),
      buildResponse(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(pairMarkupRepo.upsertPairMarkupSetting).not.toHaveBeenCalled();
  });

  it('saves, audits and reloads pricing with the right passcode', async () => {
    vi.mocked(pairMarkupRepo.findPairMarkupSettingByKey).mockResolvedValue(ROW);
    vi.mocked(pairMarkupRepo.upsertPairMarkupSetting).mockResolvedValue({ ...ROW, markupBps: 25 });
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;
    await putPairMarkup(
      req({ body: { fiat: 'eur', side: 'sell', cryptos: ['USD', 'USDT', 'USDC'], markupBps: '25', actor: 'Emmanuel' }, headers: { 'x-dashboard-secret': 'pr2026' } }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(pairMarkupRepo.upsertPairMarkupSetting).toHaveBeenCalledWith(
      { fiat: 'EUR', side: 'sell' },
      { cryptos: 'USD,USDT,USDC', markupBps: 25, updatedBy: 'Emmanuel' }
    );
    expect(adminActionRepo.createAdminAction).toHaveBeenCalledWith(expect.objectContaining({ txnType: 'pair_markup', txnId: 'EUR:sell' }));
    expect(refresh.reloadPairMarkupRules).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('deletePairMarkup', () => {
  it('rejects a wrong passcode with 401', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await deletePairMarkup(req({ params: { id: 'pm_1' }, headers: { 'x-dashboard-secret': 'nope' } }), buildResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(pairMarkupRepo.deletePairMarkupSettingById).not.toHaveBeenCalled();
  });

  it('404s an unknown id', async () => {
    vi.mocked(pairMarkupRepo.findPairMarkupSettingById).mockResolvedValue(null);
    const next = vi.fn() as unknown as NextFunction;
    await deletePairMarkup(req({ params: { id: 'nope' }, headers: { 'x-dashboard-secret': 'pr2026' } }), buildResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
