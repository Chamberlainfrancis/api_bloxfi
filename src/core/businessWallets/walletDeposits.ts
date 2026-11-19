/**
 * `deposit.credited` for a business wallet address (client_reference WAL-…).
 *
 * The deposit is recorded once (orchestrator deposit id is unique) and either
 * credited or quarantined in the same transaction:
 * - whitelist off: credited.
 * - whitelist on, sender whitelisted for that chain: credited.
 * - whitelist on, sender unknown or not whitelisted: quarantined. Never
 *   credited, never shown to the business, no partner webhook. The funds are
 *   swept to main like any deposit; an admin credits or refunds it by hand.
 */

import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';
import type {
  BusinessWalletRow,
  IncomingWalletDeposit,
  WalletAsset,
  WalletDepositAddressRow,
  WalletDepositRow,
} from '@/db/repositories/businessWallet.repo';
import { normalizeWalletAddress, parseWalletClientReference } from './chains';

export interface WalletDepositDeps {
  findDepositAddressByProvisionedAccount(id: string): Promise<WalletDepositAddressRow | null>;
  findBusinessWallet(userId: string): Promise<BusinessWalletRow | null>;
  isWhitelisted(userId: string, chain: string, address: string): Promise<boolean>;
  recordWalletDeposit(
    dep: IncomingWalletDeposit,
    decision: { credit: true } | { credit: false; reason: string }
  ): Promise<{ row: WalletDepositRow; created: boolean; credited: boolean }>;
  emitPartnerWebhook(eventType: 'wallet.credited', data: Record<string, unknown>): void;
}

export type WalletDepositOutcome =
  | { kind: 'credited'; depositId: string }
  | { kind: 'quarantined'; depositId: string; reason: string }
  | { kind: 'replay' }
  | { kind: 'ignored'; reason: string };

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function rec(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Exact decimal amount from the orchestrator payload (amount_decimal, else amount). */
export function walletDepositAmount(dep: Record<string, unknown>): Prisma.Decimal | null {
  const raw = str(dep.amount_decimal) || (typeof dep.amount === 'number' ? String(dep.amount) : str(dep.amount));
  if (!raw || !/^\d+(\.\d+)?$/.test(raw)) return null;
  const d = new Prisma.Decimal(raw);
  return d.isPositive() && !d.isZero() ? d : null;
}

export async function applyWalletDepositCredited(
  deps: WalletDepositDeps,
  clientRef: string,
  dep: Record<string, unknown>,
  rawPayload?: unknown
): Promise<WalletDepositOutcome> {
  const refUserId = parseWalletClientReference(clientRef);
  if (!refUserId) return { kind: 'ignored', reason: 'not a wallet client reference' };
  if (str(dep.mode) && str(dep.mode) !== 'CRYPTO_DEPOSIT') return { kind: 'ignored', reason: 'not a crypto deposit' };
  const depositId = str(dep.id);
  const provId = str(dep.provisioned_account_id);
  if (!depositId || !provId) return { kind: 'ignored', reason: 'missing deposit or account id' };

  const addr = await deps.findDepositAddressByProvisionedAccount(provId);
  if (!addr || addr.userId.toLowerCase() !== refUserId) {
    logger.error({ clientRef, provId, depositId }, 'wallet deposit on an unknown or mismatched address; not credited');
    return { kind: 'ignored', reason: 'address not a wallet address of this business' };
  }
  const asset = str(rec(dep.asset).code).toUpperCase();
  if (asset !== addr.asset) return { kind: 'ignored', reason: `asset ${asset} is not ${addr.asset}` };
  const network = str(dep.network).toUpperCase();
  if (network && network !== addr.chain.toUpperCase()) return { kind: 'ignored', reason: `network ${network} is not ${addr.chain}` };
  const amount = walletDepositAmount(dep);
  if (!amount) {
    logger.error({ clientRef, depositId }, 'wallet deposit without a valid amount; not credited');
    return { kind: 'ignored', reason: 'missing amount' };
  }

  const sourceRef = rec(dep.source_ref);
  const rawSender = str(sourceRef.sender_address);
  const sender = rawSender ? normalizeWalletAddress(addr.chain, rawSender) ?? rawSender : null;

  const wallet = await deps.findBusinessWallet(addr.userId);
  let decision: { credit: true } | { credit: false; reason: string } = { credit: true };
  if (wallet?.whitelistRequired) {
    if (!sender) decision = { credit: false, reason: 'sender unknown' };
    else if (!(await deps.isWhitelisted(addr.userId, addr.chain, sender))) decision = { credit: false, reason: 'sender not whitelisted' };
  }

  const incoming: IncomingWalletDeposit = {
    orchestratorDepositId: depositId,
    userId: addr.userId,
    asset: asset as WalletAsset,
    chain: addr.chain,
    amount,
    address: addr.address ?? str(sourceRef.address),
    senderAddress: sender,
    txId: str(dep.provider_tx_id) || null,
    rawPayload,
  };
  const r = await deps.recordWalletDeposit(incoming, decision);
  if (!r.created) return { kind: 'replay' };
  if (!r.credited) {
    logger.warn({ userId: addr.userId, depositId, sender, reason: (decision as { reason: string }).reason }, 'wallet deposit quarantined');
    return { kind: 'quarantined', depositId: r.row.id, reason: (decision as { reason: string }).reason };
  }
  deps.emitPartnerWebhook('wallet.credited', {
    userId: addr.userId,
    depositId: r.row.id,
    asset,
    chain: addr.chain,
    amount: amount.toString(),
    senderAddress: sender,
    transactionHash: incoming.txId,
    creditedAt: r.row.createdAt.toISOString(),
  });
  return { kind: 'credited', depositId: r.row.id };
}
