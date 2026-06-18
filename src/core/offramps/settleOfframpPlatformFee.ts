/**
 * Post-completion offramp platform-fee settlement via Palremit USDC crypto withdrawal.
 * Soft validation: invalid config is recorded on the offramp and no withdrawal is sent.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { createPalremitWithdrawal } from '@/core/integrations/palremitLiquidity';
import {
  fetchPalremitNetworksForCoin,
  resolvePalremitNetworkFromOptions,
} from '@/core/integrations/palremitCoinNetworks';
import type {
  OfframpFees,
  OfframpStatus,
  PlatformFeeSettlement,
  PlatformFeeSettlementStatus,
} from '@/types/offramp';
import { buildOfframpFeeClientReference } from '@/utils/txnRef';
import { logger } from '@/lib/logger';

const DEFAULT_SETTLEMENT_ASSET = 'USDC';
const MIN_SETTLEMENT_AMOUNT = 0.000001;

export interface SettleOfframpPlatformFeeRepo {
  findOfframpById(id: string): Promise<{
    id: string;
    status: string;
    txnRef: string | null;
    fees: unknown;
  } | null>;
  findOfframpByTxnRef(txnRef: string): Promise<{
    id: string;
    status: string;
    txnRef: string | null;
    fees: unknown;
  } | null>;
  updateOfframpStatus(
    id: string,
    status: OfframpStatus,
    updates?: { fees?: object | null }
  ): Promise<unknown>;
}

export interface SettleOfframpPlatformFeeDeps {
  liquidityRequest: PalremitLiquidityRequestFn;
  getRate?: (
    fromCurrency: string,
    toCurrency: string
  ) => Promise<{ conversionRate: string } | null>;
}

export interface SettleOfframpPlatformFeeResult {
  outcome: 'skipped' | 'processing' | 'already_settled' | 'not_ready';
  settlement?: PlatformFeeSettlement;
}

function parseFees(raw: unknown): OfframpFees | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as OfframpFees;
}

function mergePlatformFeeSettlement(
  fees: OfframpFees | null,
  patch: Partial<PlatformFeeSettlement> & { status: PlatformFeeSettlementStatus }
): OfframpFees {
  const base = fees ?? {};
  const pf = base.platformFee ?? {
    type: 'PERCENTAGE' as const,
    value: '0',
    amount: '0',
    currency: DEFAULT_SETTLEMENT_ASSET,
    walletAddress: '',
  };
  const prev = pf.settlement;
  const notes = [...(prev?.notes ?? []), ...(patch.notes ?? [])].filter(Boolean);
  const settlement: PlatformFeeSettlement = {
    ...(prev ?? {}),
    ...patch,
    ...(notes.length > 0 ? { notes } : {}),
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

async function resolveSettlementAmountUsdc(
  feeAmountStr: string,
  feeCurrency: string,
  settlementAsset: string,
  getRate?: SettleOfframpPlatformFeeDeps['getRate']
): Promise<{ amount: number } | { error: string }> {
  const feeAmount = Number(feeAmountStr);
  if (!Number.isFinite(feeAmount) || feeAmount <= 0) {
    return { error: 'platform fee amount is zero or invalid' };
  }
  const from = feeCurrency.trim().toUpperCase();
  const to = settlementAsset.trim().toUpperCase();
  if (from === to) {
    return { amount: feeAmount };
  }
  if (!getRate) {
    return { error: `cannot convert ${from} fee to ${to}: rates unavailable` };
  }
  const rateRow = await getRate(from, to);
  if (!rateRow?.conversionRate) {
    return { error: `cannot convert ${from} fee to ${to}: rate lookup failed` };
  }
  const rate = parseFloat(rateRow.conversionRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return { error: `cannot convert ${from} fee to ${to}: invalid rate` };
  }
  return { amount: feeAmount * rate };
}

export async function persistPlatformFeeSettlement(
  repo: SettleOfframpPlatformFeeRepo,
  offrampId: string,
  offrampStatus: OfframpStatus,
  fees: OfframpFees | null,
  patch: Partial<PlatformFeeSettlement> & { status: PlatformFeeSettlementStatus }
): Promise<PlatformFeeSettlement> {
  const merged = mergePlatformFeeSettlement(fees, patch);
  await repo.updateOfframpStatus(offrampId, offrampStatus, {
    fees: merged as object,
  });
  return merged.platformFee!.settlement!;
}

export async function settleOfframpPlatformFee(
  repo: SettleOfframpPlatformFeeRepo,
  deps: SettleOfframpPlatformFeeDeps,
  offrampId: string
): Promise<SettleOfframpPlatformFeeResult> {
  const row = await repo.findOfframpById(offrampId);
  if (!row) {
    return { outcome: 'not_ready' };
  }
  if (row.status !== 'COMPLETED') {
    return { outcome: 'not_ready' };
  }

  const fees = parseFees(row.fees);
  const pf = fees?.platformFee;
  const existing = pf?.settlement;
  if (existing?.status === 'processing' || existing?.status === 'completed') {
    return { outcome: 'already_settled', settlement: existing };
  }
  if (existing?.status === 'skipped' || existing?.status === 'failed') {
    return { outcome: 'already_settled', settlement: existing };
  }

  const notes: string[] = [];
  const txnRef = row.txnRef?.trim() ?? '';
  if (!txnRef) {
    notes.push('missing offramp txnRef');
  }

  const wallet = pf?.walletAddress?.trim() ?? '';
  if (!wallet) {
    notes.push('missing platformFee.walletAddress');
  }

  const settlementAsset = (pf?.settlementCurrency ?? DEFAULT_SETTLEMENT_ASSET).trim().toUpperCase();
  if (settlementAsset !== DEFAULT_SETTLEMENT_ASSET) {
    notes.push(`settlement currency must be USDC (got ${settlementAsset})`);
  }

  const networkRaw = pf?.settlementNetwork?.trim() ?? '';
  if (!networkRaw) {
    notes.push('missing platformFee.network for settlement');
  }

  const feeCurrency = pf?.currency?.trim().toUpperCase() ?? '';
  const feeAmountStr = pf?.amount ?? '';
  let settlementAmount = 0;
  if (!notes.length) {
    const amountRes = await resolveSettlementAmountUsdc(
      feeAmountStr,
      feeCurrency,
      settlementAsset,
      deps.getRate
    );
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
  if (!notes.length && networkRaw) {
    const options = await fetchPalremitNetworksForCoin(deps.liquidityRequest, DEFAULT_SETTLEMENT_ASSET);
    if (!options?.length) {
      notes.push('USDC network list unavailable from Palremit');
    } else {
      resolvedNetwork = resolvePalremitNetworkFromOptions(options, networkRaw);
      if (!resolvedNetwork) {
        const codes = options.map((o) => o.code).join(', ');
        notes.push(`unsupported network "${networkRaw}" for USDC (valid: ${codes})`);
      } else {
        const opt = options.find((o) => o.code === resolvedNetwork);
        if (opt?.withdrawEnabled === false) {
          notes.push(`withdrawals disabled on network ${resolvedNetwork}`);
        }
      }
    }
  }

  const attemptedAt = new Date().toISOString();
  if (notes.length > 0) {
    const settlement = await persistPlatformFeeSettlement(repo, offrampId, 'COMPLETED', fees, {
      status: 'skipped',
      notes,
      attemptedAt,
    });
    logger.info({ offrampId, notes }, 'offramp platform fee settlement skipped');
    return { outcome: 'skipped', settlement };
  }

  const clientReference = buildOfframpFeeClientReference(txnRef);
  const idempotencyKey = `offramp-fee-settlement:${txnRef}`;
  const withdrawalBody: Record<string, unknown> = {
    client_reference: clientReference,
    asset: DEFAULT_SETTLEMENT_ASSET,
    amount: settlementAmount,
    destination_type: 'crypto_address',
    network: resolvedNetwork,
    destination: { address: wallet },
  };

  const created = await createPalremitWithdrawal(deps.liquidityRequest, withdrawalBody, idempotencyKey);
  if (!created?.id) {
    const settlement = await persistPlatformFeeSettlement(repo, offrampId, 'COMPLETED', fees, {
      status: 'failed',
      notes: ['Palremit withdrawal request failed'],
      attemptedAt,
    });
    logger.error({ offrampId, clientReference }, 'offramp platform fee settlement withdrawal failed');
    return { outcome: 'skipped', settlement };
  }

  const settlement = await persistPlatformFeeSettlement(repo, offrampId, 'COMPLETED', fees, {
    status: 'processing',
    withdrawalId: created.id,
    attemptedAt,
  });
  logger.info(
    { offrampId, withdrawalId: created.id, clientReference, amount: settlementAmount },
    'offramp platform fee settlement initiated'
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

export async function applyOfframpPlatformFeeWithdrawalWebhook(
  repo: SettleOfframpPlatformFeeRepo,
  parentTxnRef: string,
  withdrawal: Record<string, unknown>,
  terminal: 'completed' | 'failed',
  failureNote?: string
): Promise<boolean> {
  const offramp = await repo.findOfframpByTxnRef(parentTxnRef);
  if (!offramp) return false;

  const fees = parseFees(offramp.fees);
  const settlement = fees?.platformFee?.settlement;
  if (!settlement || settlement.status !== 'processing') return false;

  const wid = typeof withdrawal.id === 'string' ? withdrawal.id.trim() : '';
  if (settlement.withdrawalId && wid && settlement.withdrawalId !== wid) {
    return false;
  }

  const completedAt = new Date().toISOString();
  if (terminal === 'completed') {
    const txHash = withdrawalSettlementHash(withdrawal);
    await persistPlatformFeeSettlement(repo, offramp.id, 'COMPLETED', fees, {
      status: 'completed',
      withdrawalId: wid || settlement.withdrawalId,
      transactionHash: txHash,
      completedAt,
    });
    return true;
  }

  await persistPlatformFeeSettlement(repo, offramp.id, 'COMPLETED', fees, {
    status: 'failed',
    withdrawalId: wid || settlement.withdrawalId,
    notes: [failureNote ?? 'fee settlement withdrawal failed'],
    completedAt,
  });
  return true;
}
