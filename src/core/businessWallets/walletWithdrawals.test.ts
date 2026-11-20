import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@/generated/prisma/client';
import {
  applyWalletWithdrawalEvent,
  approveWalletWithdrawal,
  rejectWalletWithdrawal,
  requestWalletWithdrawal,
  WalletWithdrawalError,
  type WalletWithdrawalDeps,
} from './walletWithdrawals';
import type { WalletWithdrawalRow } from '@/db/repositories/businessWallet.repo';

const USER = 'c758e59d-0f04-486e-9a62-434381c9d055';
const TRON = 'TXjTdP8HfNnAYZ6974pFuogvdinn6Nh5Vv';

function row(over: Partial<WalletWithdrawalRow> = {}): WalletWithdrawalRow {
  return {
    id: 'w1', requestId: 'r1', txnRef: 'WALWD-aaaaaaaaaaaaaaaaaaaaaaaa', userId: USER, asset: 'USDT', chain: 'TRC20',
    amount: new Prisma.Decimal('25'), address: TRON, memo: null, status: 'pending_approval', orchestratorWithdrawalId: null,
    txHash: null, failureReason: null, approvedBy: null, approvedAt: null, rejectedBy: null, rejectedAt: null,
    createdAt: new Date('2026-11-19T09:00:00Z'), updatedAt: new Date('2026-11-19T09:00:00Z'), ...over,
  };
}

function deps(over: Partial<WalletWithdrawalDeps> = {}, current: WalletWithdrawalRow = row()): WalletWithdrawalDeps {
  let state = current;
  return {
    findBusinessWallet: vi.fn(async () => ({ enabled: true } as never)),
    isWhitelisted: vi.fn(async () => false),
    listDepositAddresses: vi.fn(async () => [{ asset: 'USDT', chain: 'TRC20', status: 'active' } as never]),
    createWalletWithdrawal: vi.fn(async () => ({ row: state, created: true })),
    findWalletWithdrawalById: vi.fn(async () => state),
    findWalletWithdrawalByRef: vi.fn(async () => state),
    transitionWalletWithdrawal: vi.fn(async (_id, from, data) => {
      if (!from.includes(state.status)) return null;
      state = { ...state, ...data } as WalletWithdrawalRow;
      return state;
    }),
    finishWalletWithdrawal: vi.fn(async (_id, outcome, data) => {
      if (['completed', 'failed', 'rejected'].includes(state.status)) return null;
      state = { ...state, status: outcome, txHash: data.txHash ?? null, failureReason: data.failureReason ?? null };
      return state;
    }),
    createOrchestratorWithdrawal: vi.fn(async () => ({ ok: true, id: 'orch-w1' } as never)),
    emitPartnerWebhook: vi.fn(),
    ...over,
  };
}

describe('requestWalletWithdrawal', () => {
  const input = { requestId: 'r1', userId: USER, asset: 'usdt', chain: 'trc20', amount: '25', address: TRON };

  it('reserves through the repo with a normalised asset, chain and exact amount', async () => {
    const d = deps();
    await requestWalletWithdrawal(d, input);
    const call = (d.createWalletWithdrawal as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call).toMatchObject({ asset: 'USDT', chain: 'TRC20', address: TRON });
    expect(call.amount.toString()).toBe('25');
  });

  it('waits for an admin when the address is a business-registered wallet', async () => {
    const d = deps();
    const r = await requestWalletWithdrawal(d, input);
    expect(r.row.status).toBe('pending_approval');
    expect(d.createOrchestratorWithdrawal).not.toHaveBeenCalled();
  });

  it('sends at once to an admin-whitelisted address', async () => {
    const d = deps({ isWhitelisted: vi.fn(async () => true) });
    const r = await requestWalletWithdrawal(d, input);
    expect(r.created).toBe(true);
    expect(r.row).toMatchObject({ status: 'submitted', orchestratorWithdrawalId: 'orch-w1', approvedBy: 'auto:whitelist' });
    expect(d.createOrchestratorWithdrawal).toHaveBeenCalledTimes(1);
    expect(d.emitPartnerWebhook).toHaveBeenCalledWith('wallet.withdrawal.submitted', expect.objectContaining({ status: 'submitted' }));
  });

  it('leaves a whitelisted withdrawal approved when the payout service is down', async () => {
    const d = deps({
      isWhitelisted: vi.fn(async () => true),
      createOrchestratorWithdrawal: vi.fn(async () => ({ ok: false, httpStatus: 503, message: 'down' } as never)),
    });
    const r = await requestWalletWithdrawal(d, input);
    expect(r.row.status).toBe('approved');
  });

  it('does not send again when the same requestId comes back', async () => {
    const d = deps({
      isWhitelisted: vi.fn(async () => true),
      createWalletWithdrawal: vi.fn(async () => ({ row: row({ status: 'submitted' }), created: false })),
    });
    await requestWalletWithdrawal(d, input);
    expect(d.createOrchestratorWithdrawal).not.toHaveBeenCalled();
  });

  it('refuses a chain the wallet has no address on, a bad address, and too many decimals', async () => {
    await expect(requestWalletWithdrawal(deps(), { ...input, chain: 'ERC20', address: '0x' + '1'.repeat(40) })).rejects.toMatchObject({ code: 'CHAIN_NOT_ENABLED' });
    await expect(requestWalletWithdrawal(deps(), { ...input, address: 'nope' })).rejects.toMatchObject({ code: 'INVALID_ADDRESS' });
    await expect(requestWalletWithdrawal(deps(), { ...input, amount: '1.0000001' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('turns repo refusals into clear errors', async () => {
    const d = deps({ createWalletWithdrawal: vi.fn(async () => { throw new Error('ADDRESS_NOT_WHITELISTED'); }) });
    await expect(requestWalletWithdrawal(d, input)).rejects.toBeInstanceOf(WalletWithdrawalError);
    await expect(requestWalletWithdrawal(d, input)).rejects.toMatchObject({ code: 'ADDRESS_NOT_WHITELISTED' });
  });
});

describe('approveWalletWithdrawal', () => {
  it('approves, sends once with a stable idempotency key, and marks it submitted', async () => {
    const d = deps();
    const r = await approveWalletWithdrawal(d, 'w1', 'ops');
    expect(r.status).toBe('submitted');
    expect(r.orchestratorWithdrawalId).toBe('orch-w1');
    expect(d.createOrchestratorWithdrawal).toHaveBeenCalledWith(
      expect.objectContaining({ client_reference: 'WALWD-aaaaaaaaaaaaaaaaaaaaaaaa', amount: '25', network: 'TRC20' }),
      'wallet-wd:WALWD-aaaaaaaaaaaaaaaaaaaaaaaa'
    );
    expect(d.emitPartnerWebhook).toHaveBeenCalledWith('wallet.withdrawal.submitted', expect.anything());
  });

  it('a temporary orchestrator error leaves it approved; approving again reuses the same key', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({ ok: false, httpStatus: 503, message: 'down' })
      .mockResolvedValueOnce({ ok: true, id: 'orch-w1' });
    const d = deps({ createOrchestratorWithdrawal: send });
    await expect(approveWalletWithdrawal(d, 'w1', 'ops')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(d.finishWalletWithdrawal).not.toHaveBeenCalled();
    const r = await approveWalletWithdrawal(d, 'w1', 'ops');
    expect(r.status).toBe('submitted');
    expect(send.mock.calls[0]![1]).toBe(send.mock.calls[1]![1]);
  });

  it('a definitive refusal fails it (which releases the reserve)', async () => {
    const d = deps({ createOrchestratorWithdrawal: vi.fn(async () => ({ ok: false, httpStatus: 422, message: 'bad address' } as never)) });
    const r = await approveWalletWithdrawal(d, 'w1', 'ops');
    expect(r.status).toBe('failed');
    expect(d.finishWalletWithdrawal).toHaveBeenCalledWith('w1', 'failed', expect.objectContaining({ failureReason: 'bad address' }));
  });

  it('refuses one that already ended', async () => {
    await expect(approveWalletWithdrawal(deps({}, row({ status: 'completed' })), 'w1', 'ops')).rejects.toMatchObject({ code: 'NOT_PENDING' });
  });
});

describe('rejectWalletWithdrawal', () => {
  it('needs a reason and only works while pending', async () => {
    await expect(rejectWalletWithdrawal(deps(), 'w1', 'ops', ' ')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(rejectWalletWithdrawal(deps({}, row({ status: 'submitted' })), 'w1', 'ops', 'no')).rejects.toMatchObject({ code: 'NOT_PENDING' });
    const r = await rejectWalletWithdrawal(deps(), 'w1', 'ops', 'not the client');
    expect(r.status).toBe('rejected');
  });
});

describe('applyWalletWithdrawalEvent', () => {
  it('settles on success with the tx hash, once', async () => {
    const d = deps({}, row({ status: 'submitted', orchestratorWithdrawalId: 'orch-w1' }));
    const r = await applyWalletWithdrawalEvent(d, 'WALWD-aaaaaaaaaaaaaaaaaaaaaaaa', { id: 'orch-w1', provider_external_ref: '0xhash' }, 'successful');
    expect(r?.status).toBe('completed');
    expect(r?.txHash).toBe('0xhash');
    await applyWalletWithdrawalEvent(d, 'WALWD-aaaaaaaaaaaaaaaaaaaaaaaa', { id: 'orch-w1' }, 'failed', 'late');
    expect(d.finishWalletWithdrawal).toHaveBeenCalledTimes(1);
    expect(d.emitPartnerWebhook).toHaveBeenCalledTimes(1);
  });

  it('ignores a webhook whose withdrawal id does not match', async () => {
    const d = deps({}, row({ status: 'submitted', orchestratorWithdrawalId: 'orch-w1' }));
    expect(await applyWalletWithdrawalEvent(d, 'WALWD-aaaaaaaaaaaaaaaaaaaaaaaa', { id: 'other' }, 'successful')).toBeNull();
    expect(d.finishWalletWithdrawal).not.toHaveBeenCalled();
  });
});
