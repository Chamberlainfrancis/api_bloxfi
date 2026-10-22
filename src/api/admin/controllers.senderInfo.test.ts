import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { deleteSenderInfo, listSenderInfo, putSenderInfo } from '@/api/admin/controllers';
import * as senderInfoRepo from '@/db/repositories/senderInfo.repo';
import * as adminActionRepo from '@/db/repositories/adminAction.repo';

vi.mock('@/config', () => ({
  env: {
    PALREMIT_LIQUIDITY_TENANT_ID: 'tenant_test',
    DASHBOARD_MARK_SECRET: 'pr2026',
  },
}));

vi.mock('@/services/palremitAdapters', () => ({
  createPalremitLiquidityAdapter: vi.fn(() => vi.fn()),
}));

vi.mock('@/db/repositories/user.repo', () => ({
  listUsers: vi.fn(),
  searchUsers: vi.fn(),
  mergeUserMetadata: vi.fn(),
}));

vi.mock('@/db/repositories/senderInfo.repo', () => ({
  listSenderInfoSettings: vi.fn(),
  findSenderInfoSettingsForCurrency: vi.fn(),
  findSenderInfoSettingById: vi.fn(),
  findSenderInfoSettingByKey: vi.fn(),
  upsertSenderInfoSetting: vi.fn(),
  deleteSenderInfoSettingById: vi.fn(),
}));

vi.mock('@/db/repositories/adminAction.repo', () => ({
  createAdminAction: vi.fn(),
  listAdminActionsForTxn: vi.fn(),
}));

const ROW = {
  id: 'si_1',
  rampType: 'offramp' as const,
  currency: 'NGN',
  rail: '',
  senderName: 'Palremit LTD',
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

describe('listSenderInfo', () => {
  it('returns all settings', async () => {
    vi.mocked(senderInfoRepo.listSenderInfoSettings).mockResolvedValue([ROW]);
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;
    await listSenderInfo(req({}), res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { items: [ROW] } });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('putSenderInfo', () => {
  it('rejects a missing passcode with 401 before touching the repo', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(req({ body: { rampType: 'offramp', currency: 'NGN', senderName: 'X' } }), buildResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Incorrect passcode', statusCode: 401 }));
    expect(senderInfoRepo.upsertSenderInfoSetting).not.toHaveBeenCalled();
  });

  it('rejects a wrong passcode with 401', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(
      req({ body: { rampType: 'offramp', currency: 'NGN', senderName: 'X', secret: 'nope' } }),
      buildResponse(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an unknown ramp type with 400', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(
      req({ body: { rampType: 'swap', currency: 'NGN', senderName: 'X', secret: 'pr2026' } }),
      buildResponse(),
      next
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: expect.stringContaining('rampType') })
    );
    expect(senderInfoRepo.upsertSenderInfoSetting).not.toHaveBeenCalled();
  });

  it('rejects a name longer than 140 characters with 400', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(
      req({ body: { rampType: 'offramp', currency: 'NGN', senderName: 'x'.repeat(141) }, headers: { 'x-dashboard-secret': 'pr2026' } }),
      buildResponse(),
      next
    );
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 400, message: expect.stringContaining('senderName') })
    );
  });

  it('rejects a missing currency with 400', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(
      req({ body: { rampType: 'offramp', currency: '', senderName: 'X', secret: 'pr2026' } }),
      buildResponse(),
      next
    );
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('upserts with the header passcode, normalises the key and writes an AdminAction', async () => {
    vi.mocked(senderInfoRepo.findSenderInfoSettingByKey).mockResolvedValue(null);
    vi.mocked(senderInfoRepo.upsertSenderInfoSetting).mockResolvedValue({ ...ROW, rail: 'local_bank' });
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(
      req({
        body: { rampType: 'offramp', currency: 'ngn', rail: 'Local_Bank', senderName: ' Palremit LTD ', actor: 'ops' },
        headers: { 'x-dashboard-secret': 'pr2026' },
      }),
      res,
      next
    );
    expect(next).not.toHaveBeenCalled();
    expect(senderInfoRepo.upsertSenderInfoSetting).toHaveBeenCalledWith(
      { rampType: 'offramp', currency: 'NGN', rail: 'local_bank' },
      { senderName: 'Palremit LTD', updatedBy: 'ops' }
    );
    expect(adminActionRepo.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnType: 'sender_info', txnId: 'offramp:NGN:local_bank', fromStatus: '', toStatus: 'Palremit LTD', actor: 'ops' })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { setting: { ...ROW, rail: 'local_bank' } } });
  });

  it('treats a blank name as removal', async () => {
    vi.mocked(senderInfoRepo.findSenderInfoSettingByKey).mockResolvedValue(ROW);
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;
    await putSenderInfo(req({ body: { rampType: 'offramp', currency: 'NGN', senderName: '  ', secret: 'pr2026' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(senderInfoRepo.deleteSenderInfoSettingById).toHaveBeenCalledWith('si_1');
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { setting: null } });
  });
});

describe('deleteSenderInfo', () => {
  it('requires the passcode', async () => {
    const next = vi.fn() as unknown as NextFunction;
    await deleteSenderInfo(req({ params: { id: 'si_1' } }), buildResponse(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(senderInfoRepo.deleteSenderInfoSettingById).not.toHaveBeenCalled();
  });

  it('deletes and audits, 404 when unknown', async () => {
    vi.mocked(senderInfoRepo.findSenderInfoSettingById).mockResolvedValueOnce(ROW).mockResolvedValueOnce(null);
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;
    await deleteSenderInfo(req({ params: { id: 'si_1' }, body: { actor: 'ops', secret: 'pr2026' } }), res, next);
    expect(senderInfoRepo.deleteSenderInfoSettingById).toHaveBeenCalledWith('si_1');
    expect(adminActionRepo.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnType: 'sender_info', txnId: 'offramp:NGN:any', fromStatus: 'Palremit LTD', toStatus: '', actor: 'ops' })
    );
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { ok: true } });

    const next2 = vi.fn() as unknown as NextFunction;
    await deleteSenderInfo(req({ params: { id: 'missing' }, headers: { 'x-dashboard-secret': 'pr2026' } }), buildResponse(), next2);
    expect(next2).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });
});
