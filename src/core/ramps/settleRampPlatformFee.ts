/**
 * Post-completion ramp platform-fee settlement via Palremit USDT/USDC crypto withdrawal.
 * Shared by onramps and offramps. Pays out on `platformFee.settlementNetwork`.
 * Converts USDT↔USDC at the configured 1.02 only.
 * Queued as `pending` on completion; admin approval triggers the withdrawal.
 * Soft validation: invalid config is recorded on the row and no withdrawal is sent.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { createPalremitWithdrawal, getPalremitWithdrawalByClientReference } from '@/core/integrations/palremitLiquidity';
import {
  fetchPalremitNetworksForCoin,
  resolvePalremitNetworkFromOptions,
} from '@/core/integrations/palremitCoinNetworks';
import { convertUsdtUsdc, parseStableFeeAsset } from '@/core/offramps/stablecoinFee';
import type { PlatformFeeSettlement, PlatformFeeSettlementStatus } from '@/types/offramp';
import { buildRampFeeClientReference } from '@/utils/txnRef';
import { logger } from '@/lib/logger';

const MIN_SETTLEMENT_AMOUNT = 0.000001;

export type RampKind = 'onramp' | 'offramp';

export interface RampPlatformFee {
  type: 'PERCENTAGE' | 'FLAT';
  value: string;
  amount: string;
  currency: string;
  walletAddress: string;
  settlementCurrency?: string;
  settlementNetwork?: string;
  transactionHash?: string;
  settlement?: PlatformFeeSettlement;
}

export interface RampFeesWithPlatformFee {
  platformFee?: RampPlatformFee;
  [key: string]: unknown;
}

export interface RampFeeSettlementRow {
  id: string;
  status: string;
  txnRef: string | null;
  fees: unknown;
}

export interface RampFeeSettlementRepo {
  findById(id: string): Promise<RampFeeSettlementRow | null>;
  findByTxnRef(txnRef: string): Promise<RampFeeSettlementRow | null>;
  saveFees(id: string, fees: object): Promise<unknown>;
}

export interface SettleRampPlatformFeeDeps {
  liquidityRequest: PalremitLiquidityRequestFn;
}

export type SettleRampPlatformFeeOutcome =
  | 'skipped'
  | 'pending'
  | 'processing'
  | 'already_settled'
  | 'already_queued'
  | 'not_ready';

export interface SettleRampPlatformFeeResult {
  outcome: SettleRampPlatformFeeOutcome;
  settlement?: PlatformFeeSettlement;
}

interface FeeSettlementValidation {
  fees: RampFeesWithPlatformFee | null;
  notes: string[];
  txnRef: string;
  wallet: string;
  settlementAsset: string;
  networkRaw: string;
  settlementAmount: number;
  resolvedNetwork: string | null;
}

function parseFees(raw: unknown): RampFeesWithPlatformFee | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as RampFeesWithPlatformFee;
}

function mergePlatformFeeSettlement(
  fees: RampFeesWithPlatformFee | null,
  patch: Partial<PlatformFeeSettlement> & { status: PlatformFeeSettlementStatus }
): RampFeesWithPlatformFee {
  const base = fees ?? {};
  const pf: RampPlatformFee = base.platformFee ?? {
    type: 'PERCENTAGE',
    value: '0',
    amount: '0',
    currency: 'USDC',
    walletAddress: '',
  };
  const prev = pf.settlement;
  const resetNotes =
    prev?.status === 'failed' &&
    (patch.status === 'processing' || patch.status === 'pending');
  const notes = resetNotes
    ? [...(patch.notes ?? [])].filter(Boolean)
    : [...(prev?.notes ?? []), ...(patch.notes ?? [])].filter(Boolean);
  const settlement: PlatformFeeSettlement = {
    ...(prev ?? {}),
    ...patch,
    ...(notes.length > 0 ? { notes } : resetNotes ? { notes: [] } : {}),
  };
  return {
    ...base,
    platformFee: {
      ...pf,
      settlement,
      ...(patch.transactionHash ? { transactionHash: patch.transactionHash } : {}),
    },
  };
}

function resolveSettlementAmount(
  feeAmountStr: string,
  feeCurrency: string,
  settlementAsset: string
): { amount: number } | { error: string } {
  const feeAmount = Number(feeAmountStr);
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
    return { error: 'platform fee amount is zero or invalid' };
  }
  const from = parseStableFeeAsset(feeCurrency);
  const to = parseStableFeeAsset(settlementAsset);
  if (!from) {
    return { error: `platform fee currency must be USDT or USDC (got ${feeCurrency.trim().toUpperCase() || 'empty'})` };
  }
  if (!to) {
    return { error: `settlement currency must be USDT or USDC (got ${settlementAsset.trim().toUpperCase() || 'empty'})` };
  }
  return { amount: convertUsdtUsdc(feeAmount, from, to) };
}

async function resolveWithdrawNetworkForAsset(
  deps: SettleRampPlatformFeeDeps,
  asset: string,
  networkRaw: string
): Promise<{ network: string } | { error: string }> {
  const options = await fetchPalremitNetworksForCoin(deps.liquidityRequest, asset);
  if (!options?.length) {
    return { error: `${asset} network list unavailable from Palremit` };
  }
  const resolved = resolvePalremitNetworkFromOptions(options, networkRaw);
  if (!resolved) {
    const codes = options.map((o) => o.code).join(', ');
    return { error: `unsupported network "${networkRaw}" for ${asset} (valid: ${codes})` };
  }
  const opt = options.find((o) => o.code === resolved);
  if (opt?.withdrawEnabled === false) {
    return { error: `withdrawals disabled on network ${resolved}` };
  }
  return { network: resolved };
}

async function persistPlatformFeeSettlement(
  repo: RampFeeSettlementRepo,
  id: string,
  fees: RampFeesWithPlatformFee | null,
  patch: Partial<PlatformFeeSettlement> & { status: PlatformFeeSettlementStatus }
): Promise<PlatformFeeSettlement> {
  const merged = mergePlatformFeeSettlement(fees, patch);
  await repo.saveFees(id, merged as object);
  return merged.platformFee!.settlement!;
}

function terminalSettlementStatus(status: string | undefined): boolean {
  return (
    status === 'processing' ||
    status === 'completed' ||
    status === 'skipped' ||
    status === 'failed'
  );
}

async function validatePlatformFeeSettlement(
  kind: RampKind,
  row: { txnRef: string | null; fees: unknown },
  deps: SettleRampPlatformFeeDeps
): Promise<FeeSettlementValidation> {
  const fees = parseFees(row.fees);
  const pf = fees?.platformFee;
  const notes: string[] = [];
  const txnRef = row.txnRef?.trim() ?? '';
  if (!txnRef) {
    notes.push(`missing ${kind} txnRef`);
  }

  const wallet = pf?.walletAddress?.trim() ?? '';
  if (!wallet) {
    notes.push('missing platformFee.walletAddress');
  }

  const feeCurrency = pf?.currency?.trim() ?? '';
  const rawSettlement = pf?.settlementCurrency?.trim() ?? '';
  if (rawSettlement && !parseStableFeeAsset(rawSettlement)) {
    notes.push(`settlement currency must be USDT or USDC (got ${rawSettlement.toUpperCase()})`);
  }
  if (feeCurrency && !parseStableFeeAsset(feeCurrency)) {
    notes.push(`platform fee currency must be USDT or USDC (got ${feeCurrency.toUpperCase()})`);
  }
  let settlementAsset =
    parseStableFeeAsset(rawSettlement) ?? parseStableFeeAsset(feeCurrency) ?? '';
  if (!settlementAsset) {
    notes.push('settlement currency must be USDT or USDC');
  }

  const networkRaw = pf?.settlementNetwork?.trim() ?? '';
  if (!networkRaw) {
    notes.push('missing platformFee.network for settlement');
  }

  const feeAmountStr = pf?.amount ?? '';
  let settlementAmount = 0;
  if (!notes.length) {
    const amountRes = resolveSettlementAmount(feeAmountStr, feeCurrency, settlementAsset);
    if ('error' in amountRes) {
      notes.push(amountRes.error);
    } else {
      settlementAmount = amountRes.amount;
      if (settlementAmount < MIN_SETTLEMENT_AMOUNT) {
        notes.push(`settlement amount below minimum (${settlementAmount})`);
      }
    }
  }

  let resolvedNetwork: string | null = null;
  if (!notes.length && networkRaw && settlementAsset) {
    const primary = await resolveWithdrawNetworkForAsset(deps, settlementAsset, networkRaw);
    if ('network' in primary) {
      resolvedNetwork = primary.network;
    } else {
      const feeAsset = parseStableFeeAsset(feeCurrency);
      const canFallback = Boolean(feeAsset && feeAsset !== settlementAsset);
      const fallback = canFallback
        ? await resolveWithdrawNetworkForAsset(deps, feeAsset!, networkRaw)
        : null;
      if (fallback && 'network' in fallback && feeAsset) {
        settlementAsset = feeAsset;
        resolvedNetwork = fallback.network;
        const amountRes = resolveSettlementAmount(feeAmountStr, feeCurrency, feeAsset);
        if ('error' in amountRes) {
          notes.push(amountRes.error);
        } else {
          settlementAmount = amountRes.amount;
        }
      } else {
        notes.push(primary.error);
      }
    }
  }

  return {
    fees,
    notes,
    txnRef,
    wallet,
    settlementAsset,
    networkRaw,
    settlementAmount,
    resolvedNetwork,
  };
}

function withdrawalTerminalState(state: string): 'completed' | 'failed' | null {
  const normalized = state.trim().toLowerCase();
  if (normalized === 'successful') return 'completed';
  if (normalized === 'failed') return 'failed';
  return null;
}

async function resolvePalremitFeeWithdrawal(
  deps: SettleRampPlatformFeeDeps,
  withdrawalBody: Record<string, unknown>,
  idempotencyKey: string,
  clientReference: string
): Promise<Record<string, unknown> | null> {
  const created = await createPalremitWithdrawal(deps.liquidityRequest, withdrawalBody, idempotencyKey);
  const live =
    (await getPalremitWithdrawalByClientReference(deps.liquidityRequest, clientReference)) ??
    created;
  if (!live?.id) return null;
  return live.raw != null && typeof live.raw === 'object' && !Array.isArray(live.raw)
    ? (live.raw as Record<string, unknown>)
    : {
        id: live.id,
        client_reference: live.client_reference,
        state: live.state,
      };
}

/** Queue platform-fee settlement for admin approval after ramp completion. */
export async function queueRampPlatformFeeSettlement(
  kind: RampKind,
  repo: RampFeeSettlementRepo,
  deps: SettleRampPlatformFeeDeps,
  id: string
): Promise<SettleRampPlatformFeeResult> {
  const row = await repo.findById(id);
  if (!row) {
    return { outcome: 'not_ready' };
  }
  if (row.status !== 'COMPLETED') {
    return { outcome: 'not_ready' };
  }

  const fees = parseFees(row.fees);
  const existing = fees?.platformFee?.settlement;
  if (existing?.status === 'pending') {
    return { outcome: 'already_queued', settlement: existing };
  }
  if (terminalSettlementStatus(existing?.status)) {
    return { outcome: 'already_settled', settlement: existing };
  }

  const validation = await validatePlatformFeeSettlement(kind, row, deps);
  const attemptedAt = new Date().toISOString();
  if (validation.notes.length > 0) {
    const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
      status: 'skipped',
      notes: validation.notes,
      attemptedAt,
    });
    logger.info({ kind, rampId: id, notes: validation.notes }, `${kind} platform fee settlement skipped`);
    return { outcome: 'skipped', settlement };
  }

  const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
    status: 'pending',
    attemptedAt,
  });
  logger.info({ kind, rampId: id, txnRef: validation.txnRef }, `${kind} platform fee settlement queued for approval`);
  return { outcome: 'pending', settlement };
}

/** Admin-approved execution of a pending platform-fee settlement. */
export async function settleRampPlatformFee(
  kind: RampKind,
  repo: RampFeeSettlementRepo,
  deps: SettleRampPlatformFeeDeps,
  id: string
): Promise<SettleRampPlatformFeeResult> {
  const row = await repo.findById(id);
  if (!row) {
    return { outcome: 'not_ready' };
  }
  if (row.status !== 'COMPLETED') {
    return { outcome: 'not_ready' };
  }

  const fees = parseFees(row.fees);
  const existing = fees?.platformFee?.settlement;
  if (existing?.status === 'processing' || existing?.status === 'completed') {
    return { outcome: 'already_settled', settlement: existing };
  }
  if (existing?.status === 'skipped') {
    return { outcome: 'already_settled', settlement: existing };
  }
  if (existing?.status !== 'pending' && existing?.status !== 'failed') {
    return { outcome: 'not_ready' };
  }

  const validation = await validatePlatformFeeSettlement(kind, row, deps);
  const attemptedAt = new Date().toISOString();
  if (validation.notes.length > 0) {
    const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
      status: 'skipped',
      notes: validation.notes,
      attemptedAt,
    });
    logger.info({ kind, rampId: id, notes: validation.notes }, `${kind} platform fee settlement skipped on approval`);
    return { outcome: 'skipped', settlement };
  }

  const clientReference = buildRampFeeClientReference(validation.txnRef);
  const idempotencyKey = `${kind}-fee-settlement:${validation.txnRef}`;
  const withdrawalBody: Record<string, unknown> = {
    client_reference: clientReference,
    asset: validation.settlementAsset,
    amount: validation.settlementAmount,
    destination_type: 'crypto_address',
    network: validation.resolvedNetwork,
    destination: { address: validation.wallet },
  };

  const created = await resolvePalremitFeeWithdrawal(
    deps,
    withdrawalBody,
    idempotencyKey,
    clientReference
  );
  if (!created) {
    const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
      status: 'failed',
      notes: ['Palremit withdrawal request failed'],
      attemptedAt,
    });
    logger.error({ kind, rampId: id, clientReference }, `${kind} platform fee settlement withdrawal failed`);
    return { outcome: 'skipped', settlement };
  }

  const wid = typeof created.id === 'string' ? created.id.trim() : '';
  const wstate = typeof created.state === 'string' ? created.state : '';
  const terminal = withdrawalTerminalState(wstate);
  if (terminal === 'completed') {
    const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
      status: 'completed',
      withdrawalId: wid,
      transactionHash: withdrawalSettlementHash(created),
      attemptedAt,
      completedAt: new Date().toISOString(),
    });
    logger.info(
      { kind, rampId: id, withdrawalId: wid, clientReference },
      `${kind} platform fee settlement already completed at Palremit`
    );
    return { outcome: 'already_settled', settlement };
  }
  if (terminal === 'failed') {
    const fail = created.failure_reason;
    const reason =
      fail != null &&
      typeof fail === 'object' &&
      !Array.isArray(fail) &&
      typeof (fail as { message?: unknown }).message === 'string' &&
      (fail as { message: string }).message.trim() !== ''
        ? (fail as { message: string }).message.trim()
        : 'fee settlement withdrawal failed';
    const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
      status: 'failed',
      withdrawalId: wid || undefined,
      notes: [reason],
      attemptedAt,
      completedAt: new Date().toISOString(),
    });
    logger.error(
      { kind, rampId: id, withdrawalId: wid, clientReference },
      `${kind} platform fee settlement failed at Palremit`
    );
    return { outcome: 'skipped', settlement };
  }

  const settlement = await persistPlatformFeeSettlement(repo, id, fees, {
    status: 'processing',
    withdrawalId: wid,
    attemptedAt,
  });
  logger.info(
    {
      kind,
      rampId: id,
      withdrawalId: wid,
      clientReference,
      amount: validation.settlementAmount,
    },
    `${kind} platform fee settlement initiated`
  );
  return { outcome: 'processing', settlement };
}

export function withdrawalSettlementHash(withdrawal: Record<string, unknown>): string | undefined {
  if (typeof withdrawal.provider_external_ref === 'string' && withdrawal.provider_external_ref.trim()) {
    return withdrawal.provider_external_ref.trim();
  }
  if (typeof withdrawal.settlement_reference === 'string' && withdrawal.settlement_reference.trim()) {
    return withdrawal.settlement_reference.trim();
  }
  return undefined;
}

export async function applyRampPlatformFeeWithdrawalWebhook(
  repo: RampFeeSettlementRepo,
  parentTxnRef: string,
  withdrawal: Record<string, unknown>,
  terminal: 'completed' | 'failed',
  failureNote?: string
): Promise<boolean> {
  const row = await repo.findByTxnRef(parentTxnRef);
  if (!row) return false;

  const fees = parseFees(row.fees);
  const settlement = fees?.platformFee?.settlement;
  if (!settlement || !['processing', 'failed'].includes(settlement.status)) return false;

  const wid = typeof withdrawal.id === 'string' ? withdrawal.id.trim() : '';
  if (settlement.withdrawalId && wid && settlement.withdrawalId !== wid) {
    return false;
  }

  const completedAt = new Date().toISOString();
  if (terminal === 'completed') {
    const txHash = withdrawalSettlementHash(withdrawal);
    await persistPlatformFeeSettlement(repo, row.id, fees, {
      status: 'completed',
      withdrawalId: wid || settlement.withdrawalId,
      transactionHash: txHash,
      completedAt,
    });
    return true;
  }

  await persistPlatformFeeSettlement(repo, row.id, fees, {
    status: 'failed',
    withdrawalId: wid || settlement.withdrawalId,
    notes: [failureNote ?? 'fee settlement withdrawal failed'],
    completedAt,
  });
  return true;
}
