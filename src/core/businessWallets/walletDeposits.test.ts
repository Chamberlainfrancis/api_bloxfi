import { describe, expect, it, vi } from 'vitest';
import { applyWalletDepositCredited, type WalletDepositDeps } from './walletDeposits';

const USER = 'c758e59d-0f04-486e-9a62-434381c9d055';
const ADDR = {
  id: 'a1', userId: USER, asset: 'USDT', chain: 'TRC20', address: 'TDepositAddressxxxxxxxxxxxxxxxxxxx', memo: null,
  provisionedAccountId: 'pa-1', clientReference: `WAL-${USER}`, status: 'active', failureReason: null, createdBy: null,
  createdAt: new Date(), updatedAt: new Date(),
};
const SENDER = 'TXjTdP8HfNnAYZ6974pFuogvdinn6Nh5Vv';

function dep(over: Record<string, unknown> = {}) {
  return {
    id: 'dep-1', provisioned_account_id: 'pa-1', mode: 'CRYPTO_DEPOSIT', network: 'TRC20',
    asset: { code: 'USDT', kind: 'crypto' }, amount: 100.5, amount_decimal: '100.500001',
    source_ref: { kind: 'crypto_address', address: ADDR.address, address_tag: null, sender_address: SENDER },
    provider_tx_id: 'abc:0', ...over,
  };
}

function deps(over: Partial<WalletDepositDeps> & { whitelistRequired?: boolean; listed?: boolean } = {}) {
  const d: WalletDepositDeps = {
    findDepositAddressByProvisionedAccount: vi.fn(async () => ADDR),
    findBusinessWallet: vi.fn(async () => ({ whitelistRequired: over.whitelistRequired ?? false } as never)),
    isWhitelisted: vi.fn(async () => over.listed ?? false),
    recordWalletDeposit: vi.fn(async (_dep, decision) => ({
      row: { id: 'wd-1', createdAt: new Date('2026-11-19T09:00:00Z') } as never,
      created: true,
      credited: decision.credit,
    })),
    emitPartnerWebhook: vi.fn(),
    ...over,
  };
  return d;
}

describe('applyWalletDepositCredited', () => {
  it('credits the exact decimal amount when the whitelist is off, and tells the business', async () => {
    const d = deps();
    const r = await applyWalletDepositCredited(d, `WAL-${USER}`, dep());
    expect(r).toEqual({ kind: 'credited', depositId: 'wd-1' });
    const [incoming, decision] = (d.recordWalletDeposit as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(incoming.amount.toString()).toBe('100.500001');
    expect(incoming.senderAddress).toBe(SENDER);
    expect(decision).toEqual({ credit: true });
    expect(d.emitPartnerWebhook).toHaveBeenCalledWith('wallet.credited', expect.objectContaining({ amount: '100.500001', asset: 'USDT' }));
  });

  it('quarantines a deposit from a sender that is not whitelisted, silently', async () => {
    const d = deps({ whitelistRequired: true, listed: false });
    const r = await applyWalletDepositCredited(d, `WAL-${USER}`, dep());
    expect(r).toMatchObject({ kind: 'quarantined', reason: 'sender not whitelisted' });
    expect(d.emitPartnerWebhook).not.toHaveBeenCalled();
  });

  it('quarantines when the sender is unknown and the whitelist is on', async () => {
    const d = deps({ whitelistRequired: true, listed: true });
    const r = await applyWalletDepositCredited(d, `WAL-${USER}`, dep({ source_ref: { kind: 'crypto_address', address: 'x' } }));
    expect(r).toMatchObject({ kind: 'quarantined', reason: 'sender unknown' });
  });

  it('credits a whitelisted sender', async () => {
    const d = deps({ whitelistRequired: true, listed: true });
    expect((await applyWalletDepositCredited(d, `WAL-${USER}`, dep())).kind).toBe('credited');
    expect(d.isWhitelisted).toHaveBeenCalledWith(USER, 'TRC20', SENDER);
  });

  it('ignores a deposit whose address belongs to another business or another asset/chain', async () => {
    const other = deps({ findDepositAddressByProvisionedAccount: vi.fn(async () => ({ ...ADDR, userId: '00000000-0000-0000-0000-000000000000' })) });
    expect((await applyWalletDepositCredited(other, `WAL-${USER}`, dep())).kind).toBe('ignored');
    expect((await applyWalletDepositCredited(deps(), `WAL-${USER}`, dep({ asset: { code: 'USDC' } }))).kind).toBe('ignored');
    expect((await applyWalletDepositCredited(deps(), `WAL-${USER}`, dep({ network: 'ERC20' }))).kind).toBe('ignored');
    expect((await applyWalletDepositCredited(deps(), `WAL-${USER}`, dep({ amount_decimal: '-1', amount: undefined }))).kind).toBe('ignored');
  });

  it('a replayed webhook does nothing', async () => {
    const d = deps({ recordWalletDeposit: vi.fn(async () => ({ row: {} as never, created: false, credited: false })) });
    expect(await applyWalletDepositCredited(d, `WAL-${USER}`, dep())).toEqual({ kind: 'replay' });
    expect(d.emitPartnerWebhook).not.toHaveBeenCalled();
  });
});
