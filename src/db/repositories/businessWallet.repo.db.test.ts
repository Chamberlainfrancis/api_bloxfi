/**
 * Business wallet ledger against a real Postgres (the guarantees live in the
 * database: locks, unique keys, CHECKs, triggers). Runs only when
 * WALLET_DB_TEST_URL points at a migrated, disposable database:
 *
 *   WALLET_DB_TEST_URL=postgresql://postgres:postgres@localhost:5432/bloxfi_test npx vitest run src/db/repositories/businessWallet.repo.db.test.ts
 */

import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const url = process.env.WALLET_DB_TEST_URL;

describe.skipIf(!url)('business wallet ledger (Postgres)', () => {
  type Repo = typeof import('@/db/repositories/businessWallet.repo');
  type Client = typeof import('@/db/prisma/client');
  let repo: Repo;
  let prisma: Client['prisma'];
  let D: (v: string) => import('@/generated/prisma/client').Prisma.Decimal;
  let userId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    repo = await import('@/db/repositories/businessWallet.repo');
    prisma = (await import('@/db/prisma/client')).prisma;
    const { Prisma } = await import('@/generated/prisma/client');
    D = (v: string) => new Prisma.Decimal(v);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  beforeEach(async () => {
    userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        businessInfo: { email: `${userId}@test.local`, legalName: 'Test Co' },
        registeredAddress: {},
        legalRepresentative: {},
      },
    });
    await repo.upsertBusinessWallet(userId, { enabled: true }, 'test');
  });

  function deposit(id: string, amount: string) {
    return repo.recordWalletDeposit(
      {
        orchestratorDepositId: id,
        userId,
        asset: 'USDT',
        chain: 'TRC20',
        amount: D(amount),
        address: 'TDeposit',
        senderAddress: 'TSender',
        txId: `tx-${id}`,
      },
      { credit: true }
    );
  }

  async function balance() {
    const b = await repo.getBalances(userId);
    return b.find((x) => x.asset === 'USDT')!;
  }

  it('credits a deposit once, even when the same webhook arrives 10 times at once', async () => {
    const id = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => deposit(id, '100.123456')));
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(results.filter((r) => r.status === 'fulfilled' && r.value.credited)).toHaveLength(1);
    expect(await balance()).toEqual({ asset: 'USDT', available: '100.123456', reserved: '0' });
    expect(await prisma.walletJournal.count({ where: { userId } })).toBe(1);
  });

  it('quarantines without crediting, and an admin credit posts once', async () => {
    const id = randomUUID();
    const r = await repo.recordWalletDeposit(
      { orchestratorDepositId: id, userId, asset: 'USDT', chain: 'TRC20', amount: D('50'), address: 'TDeposit', senderAddress: 'TStranger', txId: null },
      { credit: false, reason: 'sender not whitelisted' }
    );
    expect(r.row.status).toBe('quarantined');
    expect((await balance()).available).toBe('0');
    const both = await Promise.allSettled([
      repo.creditQuarantinedDeposit(r.row.id, 'admin', 'checked'),
      repo.creditQuarantinedDeposit(r.row.id, 'admin', 'checked'),
    ]);
    expect(both.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await balance()).available).toBe('50');
  });

  it('never lets two concurrent offramps spend the same money', async () => {
    await deposit(randomUUID(), '100');
    const attempts = Array.from({ length: 8 }, (_, i) =>
      repo.inWalletTx((tx) => repo.reserveForOfframp(tx, { userId, asset: 'USDT', amount: D('30'), txnRef: `OFF-${userId}-${i}` }))
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(3);
    expect(refused.every((r) => (r as PromiseRejectedResult).reason instanceof repo.InsufficientWalletBalanceError)).toBe(true);
    expect(await balance()).toEqual({ asset: 'USDT', available: '10', reserved: '90' });
  });

  it('ends an offramp exactly one way: settle and release race, one wins', async () => {
    await deposit(randomUUID(), '100');
    const f = { userId, asset: 'USDT' as const, amount: D('40'), txnRef: `OFF-race-${userId}` };
    await repo.inWalletTx((tx) => repo.reserveForOfframp(tx, f));
    await Promise.allSettled([
      repo.inWalletTx((tx) => repo.finalizeWalletOfframp(tx, f, 'COMPLETED')),
      repo.inWalletTx((tx) => repo.finalizeWalletOfframp(tx, f, 'CANCELLED')),
      repo.inWalletTx((tx) => repo.finalizeWalletOfframp(tx, f, 'COMPLETED')),
    ]);
    const b = await balance();
    expect(b.reserved).toBe('0');
    expect(['60', '100']).toContain(b.available);
    expect(await prisma.walletJournal.count({ where: { idempotencyKey: repo.offrampFinalKey(f.txnRef) } })).toBe(1);
  });

  it('refund after a completed payout credits back once', async () => {
    await deposit(randomUUID(), '100');
    const f = { userId, asset: 'USDT' as const, amount: D('40'), txnRef: `OFF-ref-${userId}` };
    await repo.inWalletTx((tx) => repo.reserveForOfframp(tx, f));
    await repo.inWalletTx((tx) => repo.finalizeWalletOfframp(tx, f, 'COMPLETED'));
    expect((await balance()).available).toBe('60');
    await repo.inWalletTx((tx) => repo.finalizeWalletOfframp(tx, f, 'REFUNDED'));
    await repo.inWalletTx((tx) => repo.finalizeWalletOfframp(tx, f, 'REFUNDED'));
    expect(await balance()).toEqual({ asset: 'USDT', available: '100', reserved: '0' });
  });

  it('the database refuses edits, deletes, unbalanced journals and a cache that disagrees with the ledger', async () => {
    await deposit(randomUUID(), '10');
    const j = await prisma.walletJournal.findFirstOrThrow({ where: { userId } });
    await expect(prisma.walletJournal.update({ where: { id: j.id }, data: { note: 'x' } })).rejects.toThrow(/append-only/);
    await expect(prisma.walletLedgerEntry.deleteMany({ where: { journalId: j.id } })).rejects.toThrow(/append-only/);
    await expect(
      prisma.$transaction(async (tx) => {
        const jj = await tx.walletJournal.create({
          data: { idempotencyKey: `bad-${randomUUID()}`, userId, asset: 'USDT', type: 'adjustment', amount: D('5'), actor: 'test' },
        });
        await tx.walletLedgerEntry.createMany({
          data: [
            { journalId: jj.id, userId, asset: 'USDT', account: 'available', amount: D('5') },
            { journalId: jj.id, userId, asset: 'USDT', account: 'adjustment', amount: D('-4') },
          ],
        });
      })
    ).rejects.toThrow(/not balanced/);
    await expect(
      prisma.walletBalance.update({ where: { userId_asset: { userId, asset: 'USDT' } }, data: { available: D('1000') } })
    ).rejects.toThrow(/does not match ledger/);
    expect((await balance()).available).toBe('10');
  });

  it('withdrawals: only to whitelisted addresses, reserve at request, one ending', async () => {
    await deposit(randomUUID(), '100');
    await expect(
      repo.createWalletWithdrawal({ requestId: randomUUID(), userId, asset: 'USDT', chain: 'TRC20', amount: D('10'), address: 'TNotListed' })
    ).rejects.toThrow('ADDRESS_NOT_WHITELISTED');
    await repo.addWhitelistAddress({ userId, chain: 'TRC20', address: 'TListed', addedBy: 'admin' });
    const requestId = randomUUID();
    const [a, b] = await Promise.all([
      repo.createWalletWithdrawal({ requestId, userId, asset: 'USDT', chain: 'TRC20', amount: D('25'), address: 'TListed' }),
      repo.createWalletWithdrawal({ requestId, userId, asset: 'USDT', chain: 'TRC20', amount: D('25'), address: 'TListed' }).catch(() => null),
    ]);
    expect([a, b].filter((x) => x?.created)).toHaveLength(1);
    expect(await balance()).toEqual({ asset: 'USDT', available: '75', reserved: '25' });
    const w = a.row;
    await repo.finishWalletWithdrawal(w.id, 'completed', { actor: 'system', txHash: '0xabc' });
    await repo.finishWalletWithdrawal(w.id, 'failed', { actor: 'system' });
    expect(await balance()).toEqual({ asset: 'USDT', available: '75', reserved: '0' });
  });

  it('paused debits refuse offramps; credits still post', async () => {
    await repo.setDebitsPaused(userId, true, 'checking', 'admin');
    await deposit(randomUUID(), '20');
    await expect(
      repo.inWalletTx((tx) => repo.reserveForOfframp(tx, { userId, asset: 'USDT', amount: D('5'), txnRef: `OFF-p-${userId}` }))
    ).rejects.toBeInstanceOf(repo.WalletDebitsPausedError);
    expect((await balance()).available).toBe('20');
  });

  it('wallet-funded offramp: reserve and row commit together; status endings move the balance once', async () => {
    const offRepo = await import('@/db/repositories/offramp.repo');
    await deposit(randomUUID(), '100');
    const make = (amount: number) => {
      const txnRef = `OFF-w-${randomUUID().slice(0, 8)}`;
      return offRepo.createWalletFundedOfframp(
        {
          requestId: randomUUID(),
          txnRef,
          userId,
          status: 'CRYPTO_CONFIRMED',
          source: { userId, currency: 'usdt', amount, chain: 'TRC20', fundingSource: 'wallet' },
          destination: {},
          rateInformation: {},
          depositInstructions: null,
          lpReference: txnRef,
        },
        { asset: 'USDT', amount: String(amount) }
      );
    };
    const before = await prisma.offramp.count({ where: { userId } });
    await expect(make(150)).rejects.toBeInstanceOf(repo.InsufficientWalletBalanceError);
    expect(await prisma.offramp.count({ where: { userId } })).toBe(before);

    const a = await make(40);
    const b = await make(30);
    expect(await balance()).toEqual({ asset: 'USDT', available: '30', reserved: '70' });

    await Promise.all([
      offRepo.updateOfframpStatus(a.id, 'CANCELLED'),
      offRepo.updateOfframpStatus(a.id, 'CANCELLED'),
    ]);
    await offRepo.updateOfframpStatus(b.id, 'COMPLETED');
    expect(await balance()).toEqual({ asset: 'USDT', available: '70', reserved: '0' });
    await offRepo.updateOfframpStatus(b.id, 'REFUNDED');
    expect(await balance()).toEqual({ asset: 'USDT', available: '100', reserved: '0' });
  });
});
