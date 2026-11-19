/**
 * Withdrawals from a business wallet to a whitelisted address.
 *
 * request  → amount reserved, status pending_approval (one transaction).
 * approve  → admin; status approved, then the orchestrator crypto withdrawal
 *            is created (idempotency key per withdrawal, so a retried
 *            approval never sends twice) → submitted.
 * reject   → admin; reserve released.
 * webhook  → withdrawal.successful settles the reserve; withdrawal.failed
 *            releases it. Each ends once (shared ledger key).
 */

import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import type { BusinessWalletRow, WalletAsset, WalletDepositAddressRow, WalletWithdrawalRow } from '@/db/repositories/businessWallet.repo';
import type { PalremitWithdrawalOutcome } from '@/core/integrations/palremitLiquidity';
import { normalizeWalletAddress } from './chains';

export interface WalletWithdrawalDeps {
  findBusinessWallet(userId: string): Promise<BusinessWalletRow | null>;
  listDepositAddresses(userId: string): Promise<WalletDepositAddressRow[]>;
  createWalletWithdrawal(input: {
    requestId: string;
    userId: string;
    asset: WalletAsset;
    chain: string;
    amount: Prisma.Decimal;
    address: string;
    memo?: string | null;
  }): Promise<{ row: WalletWithdrawalRow; created: boolean }>;
  findWalletWithdrawalById(id: string): Promise<WalletWithdrawalRow | null>;
  findWalletWithdrawalByRef(txnRef: string): Promise<WalletWithdrawalRow | null>;
  transitionWalletWithdrawal(
    id: string,
    from: string[],
    data: Partial<Pick<WalletWithdrawalRow, 'status' | 'orchestratorWithdrawalId' | 'txHash' | 'failureReason' | 'approvedBy' | 'approvedAt'>>
  ): Promise<WalletWithdrawalRow | null>;
  finishWalletWithdrawal(
    id: string,
    outcome: 'completed' | 'failed' | 'rejected',
    data: { txHash?: string | null; failureReason?: string | null; actor: string }
  ): Promise<WalletWithdrawalRow | null>;
  createOrchestratorWithdrawal(body: Record<string, unknown>, idempotencyKey: string): Promise<PalremitWithdrawalOutcome>;
  emitPartnerWebhook(
    eventType: 'wallet.withdrawal.submitted' | 'wallet.withdrawal.completed' | 'wallet.withdrawal.failed' | 'wallet.withdrawal.rejected',
    data: Record<string, unknown>
  ): void;
}

export class WalletWithdrawalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 422
  ) {
    super(message);
  }
}

export function withdrawalView(w: WalletWithdrawalRow): Record<string, unknown> {
  return {
    id: w.id,
    requestId: w.requestId,
    reference: w.txnRef,
    userId: w.userId,
    asset: w.asset,
    chain: w.chain,
    amount: new Prisma.Decimal(w.amount).toString(),
    address: w.address,
    memo: w.memo,
    status: w.status,
    transactionHash: w.txHash,
    failureReason: w.failureReason,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export async function requestWalletWithdrawal(
  deps: WalletWithdrawalDeps,
  input: { requestId: string; userId: string; asset: string; chain: string; amount: string; address: string; memo?: string | null }
): Promise<{ row: WalletWithdrawalRow; created: boolean }> {
  const asset = input.asset.trim().toUpperCase();
  if (asset !== 'USDT' && asset !== 'USDC') throw new WalletWithdrawalError('INVALID_REQUEST', 'asset must be USDT or USDC', 400);
  const chain = input.chain.trim().toUpperCase();
  if (!/^\d+(\.\d+)?$/.test(input.amount.trim())) throw new WalletWithdrawalError('INVALID_REQUEST', 'amount must be a positive decimal string', 400);
  const amount = new Prisma.Decimal(input.amount.trim());
  if (amount.isZero()) throw new WalletWithdrawalError('INVALID_REQUEST', 'amount must be more than 0', 400);
  if (amount.decimalPlaces() > 6) throw new WalletWithdrawalError('INVALID_REQUEST', 'amount has more than 6 decimal places', 400);

  const wallet = await deps.findBusinessWallet(input.userId);
  if (!wallet?.enabled) throw new WalletWithdrawalError('WALLET_NOT_ENABLED', 'Wallet is not enabled for this business', 422);
  const enabledChain = (await deps.listDepositAddresses(input.userId)).some(
    (a) => a.asset === asset && a.chain.toUpperCase() === chain && a.status === 'active'
  );
  if (!enabledChain) throw new WalletWithdrawalError('CHAIN_NOT_ENABLED', `${asset} on ${chain} is not enabled for this wallet`, 422);
  const address = normalizeWalletAddress(chain, input.address);
  if (!address) throw new WalletWithdrawalError('INVALID_ADDRESS', `address is not a valid ${chain} address`, 400);

  try {
    return await deps.createWalletWithdrawal({
      requestId: input.requestId,
      userId: input.userId,
      asset: asset as WalletAsset,
      chain,
      amount,
      address,
      memo: input.memo ?? null,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : '';
    if (m === 'ADDRESS_NOT_WHITELISTED') throw new WalletWithdrawalError(m, 'Address is not whitelisted for this wallet', 422);
    if (m === 'INSUFFICIENT_WALLET_BALANCE') throw new WalletWithdrawalError(m, 'Wallet balance is too low', 422);
    if (m === 'WALLET_DEBITS_PAUSED') throw new WalletWithdrawalError(m, 'Wallet debits are paused', 423);
    throw e;
  }
}

/** 4xx from the orchestrator (other than conflict / rate limit) means it refused for good. */
function definitiveRefusal(httpStatus: number): boolean {
  return httpStatus >= 400 && httpStatus < 500 && httpStatus !== 409 && httpStatus !== 429 && httpStatus !== 408;
}

export async function approveWalletWithdrawal(
  deps: WalletWithdrawalDeps,
  id: string,
  actor: string
): Promise<WalletWithdrawalRow> {
  const current = await deps.findWalletWithdrawalById(id);
  if (!current) throw new WalletWithdrawalError('NOT_FOUND', 'Withdrawal not found', 404);
  let w: WalletWithdrawalRow | null = current;
  if (current.status === 'pending_approval') {
    w = await deps.transitionWalletWithdrawal(id, ['pending_approval'], { status: 'approved', approvedBy: actor, approvedAt: new Date() });
    if (!w) throw new WalletWithdrawalError('CONFLICT', 'Withdrawal changed while approving; reload', 409);
  } else if (current.status !== 'approved') {
    throw new WalletWithdrawalError('NOT_PENDING', `Withdrawal is ${current.status}`, 409);
  }

  const body: Record<string, unknown> = {
    client_reference: w.txnRef,
    asset: w.asset,
    amount: new Prisma.Decimal(w.amount).toString(),
    destination_type: 'crypto_address',
    network: w.chain,
    destination: { address: w.address, ...(w.memo ? { memo: w.memo } : {}) },
  };
  const out = await deps.createOrchestratorWithdrawal(body, `wallet-wd:${w.txnRef}`);
  if (!out.ok) {
    if (definitiveRefusal(out.httpStatus)) {
      const done = await deps.finishWalletWithdrawal(id, 'failed', { failureReason: out.message, actor });
      if (done) deps.emitPartnerWebhook('wallet.withdrawal.failed', withdrawalView(done));
      return done ?? w;
    }
    logger.error({ id, txnRef: w.txnRef, httpStatus: out.httpStatus, message: out.message }, 'wallet withdrawal not accepted yet; stays approved, approve again to retry');
    throw new WalletWithdrawalError('PROVIDER_UNAVAILABLE', `Payout service did not accept it yet (${out.message}). Approve again to retry; it will not send twice.`, 502);
  }
  const submitted = await deps.transitionWalletWithdrawal(id, ['approved'], { status: 'submitted', orchestratorWithdrawalId: out.id });
  const row = submitted ?? (await deps.findWalletWithdrawalById(id)) ?? w;
  if (submitted) deps.emitPartnerWebhook('wallet.withdrawal.submitted', withdrawalView(submitted));
  return row;
}

export async function rejectWalletWithdrawal(
  deps: WalletWithdrawalDeps,
  id: string,
  actor: string,
  reason: string
): Promise<WalletWithdrawalRow> {
  if (!reason.trim()) throw new WalletWithdrawalError('INVALID_REQUEST', 'A reason is required', 400);
  const current = await deps.findWalletWithdrawalById(id);
  if (!current) throw new WalletWithdrawalError('NOT_FOUND', 'Withdrawal not found', 404);
  if (current.status !== 'pending_approval') throw new WalletWithdrawalError('NOT_PENDING', `Withdrawal is ${current.status}`, 409);
  const done = await deps.finishWalletWithdrawal(id, 'rejected', { failureReason: reason.trim(), actor });
  if (!done) throw new WalletWithdrawalError('NOT_FOUND', 'Withdrawal not found', 404);
  deps.emitPartnerWebhook('wallet.withdrawal.rejected', withdrawalView(done));
  return done;
}

export async function applyWalletWithdrawalEvent(
  deps: WalletWithdrawalDeps,
  clientRef: string,
  w: Record<string, unknown>,
  outcome: 'successful' | 'failed',
  reason?: string
): Promise<WalletWithdrawalRow | null> {
  const row = await deps.findWalletWithdrawalByRef(clientRef);
  if (!row) {
    logger.error({ clientRef }, 'wallet withdrawal webhook for an unknown reference');
    return null;
  }
  const wid = typeof w.id === 'string' ? w.id.trim() : '';
  if (row.orchestratorWithdrawalId && wid && row.orchestratorWithdrawalId !== wid) {
    logger.error({ clientRef, wid, expected: row.orchestratorWithdrawalId }, 'wallet withdrawal webhook id mismatch; ignored');
    return null;
  }
  if (['completed', 'failed', 'rejected'].includes(row.status)) return row;
  const txHash =
    typeof w.provider_external_ref === 'string' ? w.provider_external_ref : typeof w.tx_hash === 'string' ? w.tx_hash : null;
  const done = await deps.finishWalletWithdrawal(row.id, outcome === 'successful' ? 'completed' : 'failed', {
    actor: 'system',
    txHash,
    failureReason: outcome === 'failed' ? reason ?? 'withdrawal failed' : null,
  });
  if (done) deps.emitPartnerWebhook(outcome === 'successful' ? 'wallet.withdrawal.completed' : 'wallet.withdrawal.failed', withdrawalView(done));
  return done;
}
