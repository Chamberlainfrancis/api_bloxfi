import { describe, it, expect, vi } from 'vitest';
import {
  deleteSenderInfoSetting,
  normalizeSenderInfoKey,
  resolveSenderInfoForTransfer,
  resolveSenderInfoSetting,
  saveSenderInfoSetting,
  senderInfoKeyLabel,
  SenderInfoValidationError,
  type SenderInfoDeps,
  type SenderInfoSetting,
} from '@/core/admin/senderInfo';

function setting(partial: Partial<SenderInfoSetting> & Pick<SenderInfoSetting, 'id' | 'senderName'>): SenderInfoSetting {
  return {
    rampType: 'offramp',
    currency: 'NGN',
    rail: '',
    updatedBy: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    ...partial,
  };
}

describe('resolveSenderInfoSetting', () => {
  const anyRail = setting({ id: 'any', senderName: 'Palremit LTD' });
  const localBank = setting({ id: 'lb', senderName: 'Palremit Payments', rail: 'local_bank' });
  const onrampNgn = setting({ id: 'on', senderName: 'Palremit Deposits', rampType: 'onramp' });
  const gbpWire = setting({ id: 'gbp', senderName: 'Palremit UK', currency: 'GBP', rail: 'wire' });

  it('prefers an exact rail match over the any-rail setting', () => {
    expect(resolveSenderInfoSetting([anyRail, localBank], { rampType: 'offramp', currency: 'NGN', rail: 'local_bank' })?.id).toBe('lb');
  });

  it('falls back to the any-rail setting when the rail has no override', () => {
    expect(resolveSenderInfoSetting([anyRail, localBank], { rampType: 'offramp', currency: 'NGN', rail: 'mobile_money' })?.id).toBe('any');
    expect(resolveSenderInfoSetting([anyRail, localBank], { rampType: 'offramp', currency: 'NGN' })?.id).toBe('any');
  });

  it('returns null when nothing matches (no any-rail fallback)', () => {
    expect(resolveSenderInfoSetting([gbpWire], { rampType: 'offramp', currency: 'GBP', rail: 'local_bank' })).toBeNull();
    expect(resolveSenderInfoSetting([anyRail], { rampType: 'offramp', currency: 'USD' })).toBeNull();
    expect(resolveSenderInfoSetting([], { rampType: 'offramp', currency: 'NGN' })).toBeNull();
  });

  it('never crosses ramp types', () => {
    expect(resolveSenderInfoSetting([onrampNgn], { rampType: 'offramp', currency: 'NGN' })).toBeNull();
    expect(resolveSenderInfoSetting([onrampNgn, anyRail], { rampType: 'onramp', currency: 'NGN' })?.id).toBe('on');
  });

  it('normalises currency and rail casing on both sides', () => {
    expect(resolveSenderInfoSetting([localBank], { rampType: 'offramp', currency: ' ngn ', rail: 'LOCAL_BANK' })?.id).toBe('lb');
    const mixed = setting({ id: 'm', senderName: 'X', currency: 'gbp', rail: 'Wire' });
    expect(resolveSenderInfoSetting([mixed], { rampType: 'offramp', currency: 'GBP', rail: 'wire' })?.id).toBe('m');
  });

  it('ignores settings with a blank name', () => {
    expect(resolveSenderInfoSetting([setting({ id: 'b', senderName: '   ' })], { rampType: 'offramp', currency: 'NGN' })).toBeNull();
  });
});

describe('normalizeSenderInfoKey / senderInfoKeyLabel', () => {
  it('upper-cases currency, lower-cases rail, and maps missing rail to empty string', () => {
    expect(normalizeSenderInfoKey({ rampType: 'onramp', currency: 'ngn', rail: ' Local_Bank ' })).toEqual({
      rampType: 'onramp', currency: 'NGN', rail: 'local_bank',
    });
    expect(normalizeSenderInfoKey({ rampType: 'offramp', currency: 'usd' })).toEqual({ rampType: 'offramp', currency: 'USD', rail: '' });
    expect(senderInfoKeyLabel({ rampType: 'offramp', currency: 'USD', rail: '' })).toBe('offramp:USD:any');
    expect(senderInfoKeyLabel({ rampType: 'onramp', currency: 'NGN', rail: 'local_bank' })).toBe('onramp:NGN:local_bank');
  });
});

describe('resolveSenderInfoForTransfer', () => {
  it('returns the snapshot stored on new transfers', async () => {
    const repo = { findSenderInfoSettingsForCurrency: vi.fn(async () => [setting({ id: 's1', senderName: ' Palremit LTD ' })]) };
    await expect(resolveSenderInfoForTransfer(repo, { rampType: 'offramp', currency: 'ngn', rail: 'local_bank' })).resolves.toEqual({
      senderName: 'Palremit LTD', settingId: 's1', source: 'ops_setting',
    });
    expect(repo.findSenderInfoSettingsForCurrency).toHaveBeenCalledWith('offramp', 'NGN');
  });

  it('is null without a currency or a match', async () => {
    const repo = { findSenderInfoSettingsForCurrency: vi.fn(async () => []) };
    await expect(resolveSenderInfoForTransfer(repo, { rampType: 'offramp', currency: '  ' })).resolves.toBeNull();
    expect(repo.findSenderInfoSettingsForCurrency).not.toHaveBeenCalled();
    await expect(resolveSenderInfoForTransfer(repo, { rampType: 'offramp', currency: 'NGN' })).resolves.toBeNull();
  });

  it('treats a failed lookup as no setting so the transfer still gets created', async () => {
    const repo = {
      findSenderInfoSettingsForCurrency: vi.fn(async () => {
        throw new Error('relation "SenderInfoSetting" does not exist');
      }),
    };
    await expect(resolveSenderInfoForTransfer(repo, { rampType: 'onramp', currency: 'NGN' })).resolves.toBeNull();
  });
});

function makeDeps(existing: SenderInfoSetting | null) {
  const deps = {
    repo: {
      listSenderInfoSettings: vi.fn(async () => (existing ? [existing] : [])),
      findSenderInfoSettingsForCurrency: vi.fn(async () => (existing ? [existing] : [])),
      findSenderInfoSettingById: vi.fn(async (id: string) => (existing && existing.id === id ? existing : null)),
      findSenderInfoSettingByKey: vi.fn(async () => existing),
      upsertSenderInfoSetting: vi.fn(async (key, data) => setting({ id: existing?.id ?? 'new', ...key, ...data })),
      deleteSenderInfoSettingById: vi.fn(async () => undefined),
    },
    audit: { createAdminAction: vi.fn(async () => undefined) },
  } satisfies SenderInfoDeps;
  return deps;
}

describe('saveSenderInfoSetting', () => {
  it('upserts with a normalised key and audits old → new name', async () => {
    const deps = makeDeps(setting({ id: 's1', senderName: 'Old Name', rail: 'local_bank' }));
    const saved = await saveSenderInfoSetting(deps, {
      rampType: 'offramp', currency: 'ngn', rail: 'Local_Bank', senderName: '  New Name ', actor: ' ops ',
    });
    expect(saved?.senderName).toBe('New Name');
    expect(deps.repo.upsertSenderInfoSetting).toHaveBeenCalledWith(
      { rampType: 'offramp', currency: 'NGN', rail: 'local_bank' },
      { senderName: 'New Name', updatedBy: 'ops' }
    );
    expect(deps.audit.createAdminAction).toHaveBeenCalledWith({
      txnType: 'sender_info',
      txnId: 'offramp:NGN:local_bank',
      fromStatus: 'Old Name',
      toStatus: 'New Name',
      note: 'Sender name updated',
      actor: 'ops',
    });
  });

  it('audits a brand-new setting with an empty previous name', async () => {
    const deps = makeDeps(null);
    await saveSenderInfoSetting(deps, { rampType: 'onramp', currency: 'gbp', senderName: 'Palremit UK' });
    expect(deps.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: 'onramp:GBP:any', fromStatus: '', toStatus: 'Palremit UK', note: 'Sender name added', actor: null })
    );
  });

  it('skips the write and audit when the name is unchanged', async () => {
    const deps = makeDeps(setting({ id: 's1', senderName: 'Same' }));
    await saveSenderInfoSetting(deps, { rampType: 'offramp', currency: 'NGN', senderName: 'Same' });
    expect(deps.repo.upsertSenderInfoSetting).not.toHaveBeenCalled();
    expect(deps.audit.createAdminAction).not.toHaveBeenCalled();
  });

  it('treats a blank name as delete', async () => {
    const deps = makeDeps(setting({ id: 's1', senderName: 'Gone' }));
    await expect(saveSenderInfoSetting(deps, { rampType: 'offramp', currency: 'NGN', senderName: '   ' })).resolves.toBeNull();
    expect(deps.repo.deleteSenderInfoSettingById).toHaveBeenCalledWith('s1');
    expect(deps.repo.upsertSenderInfoSetting).not.toHaveBeenCalled();
    expect(deps.audit.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnId: 'offramp:NGN:any', fromStatus: 'Gone', toStatus: '', note: 'Sender name removed' })
    );
  });

  it('rejects names over 140 characters and a missing currency', async () => {
    const deps = makeDeps(null);
    await expect(
      saveSenderInfoSetting(deps, { rampType: 'offramp', currency: 'NGN', senderName: 'x'.repeat(141) })
    ).rejects.toBeInstanceOf(SenderInfoValidationError);
    await expect(
      saveSenderInfoSetting(deps, { rampType: 'offramp', currency: ' ', senderName: 'ok' })
    ).rejects.toBeInstanceOf(SenderInfoValidationError);
    expect(deps.repo.upsertSenderInfoSetting).not.toHaveBeenCalled();
  });
});

describe('deleteSenderInfoSetting', () => {
  it('deletes by id and audits', async () => {
    const deps = makeDeps(setting({ id: 's1', senderName: 'Gone', rampType: 'onramp', currency: 'NGN', rail: 'bank_transfer' }));
    await expect(deleteSenderInfoSetting(deps, 's1', 'ops')).resolves.toBe(true);
    expect(deps.repo.deleteSenderInfoSettingById).toHaveBeenCalledWith('s1');
    expect(deps.audit.createAdminAction).toHaveBeenCalledWith({
      txnType: 'sender_info', txnId: 'onramp:NGN:bank_transfer', fromStatus: 'Gone', toStatus: '', note: 'Sender name removed', actor: 'ops',
    });
  });

  it('returns false for an unknown id', async () => {
    const deps = makeDeps(null);
    await expect(deleteSenderInfoSetting(deps, 'nope')).resolves.toBe(false);
    expect(deps.repo.deleteSenderInfoSettingById).not.toHaveBeenCalled();
  });
});
