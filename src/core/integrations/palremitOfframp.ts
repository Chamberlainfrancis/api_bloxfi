/**
 * Palremit offramp: provision crypto address via /v1/provisioned-accounts; fiat payout via /v1/withdrawals.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  createPalremitWithdrawalDetailed,
  getPalremitProvisionedAccount,
  listPalremitProvisionedAccounts,
  provisionPalremitDepositAccount,
  type PalremitDepositInstructions,
} from '@/core/integrations/palremitLiquidity';
import type { CreateOfframpRequest } from '@/types/offramp';
import type { DepositInstructions } from '@/types/offramp';
import { normalizePalremitDestination } from '@/core/accounts/normalizePalremitDestination';
import { parseProviderPayout } from '@/core/accounts/providerPayoutHelpers';
import {
  usdOfframpOptionalMetadataSchema,
  usdPalremitTransferPurposeSchema,
} from '@/schemas/usdGlobalBank.zod';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function mapCryptoInstructionsToDepositInstructions(
  instr: PalremitDepositInstructions,
  amount: number,
  depositBy: string,
  currencyUpper: string
): DepositInstructions | null {
  if (instr.kind !== 'crypto_address' || !instr.address) return null;
  return {
    address: instr.address,
    amount: String(amount),
    currency: currencyUpper,
    network: String(instr.network ?? ''),
    depositBy,
    instruction: `Send exactly ${amount} ${currencyUpper} on ${instr.network} to the address above by ${depositBy}`,
  };
}

/** Names for Palremit crypto provision `kyc_input.provider_extras`. */
function namesForPalremitCryptoProvision(ctx: {
  businessInfo: unknown;
  legalRepresentative: unknown;
}): { first_name: string; last_name: string } {
  const lr =
    ctx.legalRepresentative != null &&
    typeof ctx.legalRepresentative === 'object' &&
    !Array.isArray(ctx.legalRepresentative)
      ? (ctx.legalRepresentative as Record<string, unknown>)
      : undefined;
  if (lr) {
    const fn = (lr.firstName as string) ?? (lr.first_name as string);
    const ln = (lr.lastName as string) ?? (lr.last_name as string);
    if (fn?.trim() && ln?.trim()) {
      return { first_name: fn.trim(), last_name: ln.trim() };
    }
    if (fn?.trim()) return { first_name: fn.trim(), last_name: fn.trim() };
  }
  const bi =
    ctx.businessInfo != null && typeof ctx.businessInfo === 'object' && !Array.isArray(ctx.businessInfo)
      ? (ctx.businessInfo as Record<string, unknown>)
      : undefined;
  if (bi) {
    const fn = (bi.firstName as string) ?? (bi.first_name as string);
    const ln = (bi.lastName as string) ?? (bi.last_name as string);
    if (fn?.trim() && ln?.trim()) {
      return { first_name: fn.trim(), last_name: ln.trim() };
    }
    const legal =
      (bi.legalName as string) ?? (bi.tradingName as string) ?? (bi.businessName as string) ?? '';
    const parts = legal.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
    }
    if (parts.length === 1) return { first_name: parts[0], last_name: parts[0] };
  }
  return { first_name: 'Customer', last_name: 'User' };
}

async function pollProvisionedUntilActiveOrFailed(
  request: PalremitLiquidityRequestFn,
  accountId: string,
  opts: { maxAttempts: number; delayMs: number }
): Promise<{ account: Awaited<ReturnType<typeof getPalremitProvisionedAccount>>; failed: boolean }> {
  for (let i = 0; i < opts.maxAttempts; i++) {
    const acc = await getPalremitProvisionedAccount(request, accountId);
    const st = acc?.state?.toLowerCase() ?? '';
    if (st === 'active') return { account: acc, failed: false };
    if (st === 'failed') return { account: acc, failed: true };
    await sleep(opts.delayMs);
  }
  const last = await getPalremitProvisionedAccount(request, accountId);
  return { account: last, failed: last?.state?.toLowerCase() === 'failed' };
}

export interface PalremitOfframpDepositResult {
  correlationId: string;
  depositInstructions: DepositInstructions;
  providerRefs: Record<string, unknown>;
}

/**
 * `client_reference` is BloxFi txnRef (OFF-…) so webhooks correlate to a single offramp.
 */
export async function createOfframpPalremitCryptoDeposit(
  liquidityRequest: PalremitLiquidityRequestFn,
  ctx: {
    businessInfo: unknown;
    legalRepresentative: unknown;
    email: string;
  },
  body: Omit<CreateOfframpRequest, 'requestId'>,
  _requestId: string,
  depositBy: string,
  txnRef: string
): Promise<PalremitOfframpDepositResult | null> {
  const fromCurrency = body.source.currency.trim().toUpperCase();
  const sourceNetwork = body.source.chain.trim();
  const clientRef = txnRef.trim();

  const existing = await listPalremitProvisionedAccounts(liquidityRequest, {
    client_reference: clientRef,
    asset: fromCurrency,
    mode: 'CRYPTO_DEPOSIT',
    state: 'active',
  });
  const hit = existing?.find(
    (a) =>
      a.network?.toUpperCase() === sourceNetwork.toUpperCase() &&
      a.deposit_instructions &&
      (a.deposit_instructions as PalremitDepositInstructions).kind === 'crypto_address'
  );
  if (hit?.deposit_instructions) {
    const di = mapCryptoInstructionsToDepositInstructions(
      hit.deposit_instructions as PalremitDepositInstructions,
      body.source.amount,
      depositBy,
      fromCurrency
    );
    if (!di) return null;
    return {
      correlationId: txnRef,
      depositInstructions: di,
      providerRefs: {
        palremitOrchestrator: {
          provisionedAccountId: hit.id,
          clientReference: hit.client_reference,
          depositAsset: fromCurrency,
          withdrawalAsset: body.destination.currency.trim().toUpperCase(),
          network: sourceNetwork,
          depositStatus: hit.state,
          withdrawalStatus: null,
          reusedExistingProvision: true,
        },
      },
    };
  }

  const names = namesForPalremitCryptoProvision(ctx);
  const reqBody: Record<string, unknown> = {
    asset: fromCurrency,
    mode: 'CRYPTO_DEPOSIT',
    network: sourceNetwork,
    client_reference: clientRef,
    kyc_input: {
      provider_extras: {
        first_name: names.first_name,
        last_name: names.last_name,
        email: ctx.email.trim(),
      },
    },
  };

  const idempotencyKey = `offramp-crypto-prov:${clientRef}:${fromCurrency}:${sourceNetwork}`;
  const rawRequest = { ...reqBody };
  const prov = await provisionPalremitDepositAccount(liquidityRequest, reqBody, idempotencyKey);
  if (!prov) return null;

  let account = prov.account;
  const rawProvisionResponse = { ...account };

  if (account.state?.toLowerCase() === 'pending' || account.state?.toLowerCase() === 'kyc_pending') {
    const polled = await pollProvisionedUntilActiveOrFailed(liquidityRequest, account.id, {
      maxAttempts: 20,
      delayMs: 2000,
    });
    if (polled.failed || !polled.account) return null;
    account = polled.account;
  }

  if (account.state?.toLowerCase() !== 'active' || !account.deposit_instructions) {
    return null;
  }

  const instr = account.deposit_instructions as PalremitDepositInstructions;
  const di = mapCryptoInstructionsToDepositInstructions(instr, body.source.amount, depositBy, fromCurrency);
  if (!di) return null;

  return {
    correlationId: txnRef,
    depositInstructions: di,
    providerRefs: {
      palremitOrchestrator: {
        provisionedAccountId: account.id,
        clientReference: account.client_reference,
        depositAsset: fromCurrency,
        withdrawalAsset: body.destination.currency.trim().toUpperCase(),
        network: sourceNetwork,
        depositStatus: account.state,
        withdrawalStatus: null,
        rawProvisionRequest: rawRequest,
        rawProvisionResponse,
      },
    },
  };
}

export interface WithdrawalFromAccountInput {
  txnRef: string;
  destinationAmount: number;
  providerPayout: unknown;
  purposeOfPayment?: string;
  metadata?: Record<string, unknown>;
  /** Business's stable Palremit channel user id — required by the orchestrator
   * for withdrawals routed to OwlPay/Yativo; harmlessly ignored for other
   * corridors (e.g. NGN/palmpay). Omit only if genuinely unavailable. */
  businessReference?: string;
  /** Fallback for destination.beneficiary.email when providerPayout omitted it. */
  accountHolderEmail?: string;
  /** Locked quote sendNet — Palremit's max funding-leg spend. */
  sourceAmountCap?: string;
}

function mergeOfframpExtrasIntoDestination(
  destination: Record<string, unknown>,
  purposeOfPayment?: string,
  metadata?: Record<string, unknown>
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(destination)) as Record<string, unknown>;
  const extras =
    out.extras != null && typeof out.extras === 'object' && !Array.isArray(out.extras)
      ? { ...(out.extras as Record<string, unknown>) }
      : {};

  if (purposeOfPayment?.trim()) {
    const pp = usdPalremitTransferPurposeSchema.safeParse(purposeOfPayment.trim());
    if (pp.success && extras.transfer_purpose == null) {
      extras.transfer_purpose = pp.data;
    }
  }
  const metaParsed = usdOfframpOptionalMetadataSchema.safeParse(metadata ?? {});
  if (metaParsed.success && extras.is_self_transfer == null) {
    extras.is_self_transfer = metaParsed.data.isSelfTransfer;
  }
  if (Object.keys(extras).length > 0) out.extras = extras;
  return out;
}

function ensureBeneficiaryEmail(
  destination: Record<string, unknown>,
  accountHolderEmail?: string
): void {
  const email = accountHolderEmail?.trim();
  if (!email) return;
  const ben =
    destination.beneficiary != null &&
    typeof destination.beneficiary === 'object' &&
    !Array.isArray(destination.beneficiary)
      ? (destination.beneficiary as Record<string, unknown>)
      : null;
  if (!ben) return;
  const existing = typeof ben.email === 'string' ? ben.email.trim() : '';
  if (!existing) ben.email = email;
}

/** Build POST /v1/withdrawals body from account `providerPayout`. */
export function buildWithdrawalFromAccount(
  input: WithdrawalFromAccountInput
): Record<string, unknown> | null {
  const pp = parseProviderPayout(input.providerPayout);
  if (!pp) return null;

  const destination = mergeOfframpExtrasIntoDestination(
    normalizePalremitDestination(pp.destination),
    input.purposeOfPayment,
    input.metadata
  );
  ensureBeneficiaryEmail(destination, input.accountHolderEmail);
  return {
    client_reference: input.txnRef.trim(),
    asset: pp.corridor.asset.trim().toUpperCase(),
    country: pp.corridor.country.trim().toUpperCase(),
    amount: input.destinationAmount,
    destination_type: pp.corridor.destinationType,
    destination,
    ...(input.businessReference?.trim() ? { business_reference: input.businessReference.trim() } : {}),
    ...(input.sourceAmountCap?.trim() ? { source_amount_cap: input.sourceAmountCap.trim() } : {}),
  };
}

/** Whether account has corridor-backed payout data for offramp fiat withdrawal. */
export function isAccountReadyForOfframp(input: { providerPayout: unknown }): boolean {
  return parseProviderPayout(input.providerPayout) != null;
}

export function mergeSourceAmountCapIntoProviderRefs(
  refs: Record<string, unknown>,
  cap: string | undefined
): Record<string, unknown> {
  const trimmed = cap?.trim();
  if (!trimmed) return refs;
  const orch =
    refs.palremitOrchestrator != null &&
    typeof refs.palremitOrchestrator === 'object' &&
    !Array.isArray(refs.palremitOrchestrator)
      ? (refs.palremitOrchestrator as Record<string, unknown>)
      : {};
  return {
    ...refs,
    palremitOrchestrator: { ...orch, sourceAmountCap: trimmed },
  };
}

export function sourceAmountCapFromProviderRefs(refs: unknown): string | undefined {
  if (refs == null || typeof refs !== 'object' || Array.isArray(refs)) return undefined;
  const orch = (refs as Record<string, unknown>).palremitOrchestrator;
  if (orch == null || typeof orch !== 'object' || Array.isArray(orch)) return undefined;
  const cap = (orch as Record<string, unknown>).sourceAmountCap;
  return typeof cap === 'string' && cap.trim() ? cap.trim() : undefined;
}

export type PalremitOfframpFiatWithdrawalResult =
  | { ok: true; withdrawalId: string; rawRequest: Record<string, unknown>; rawResponse: unknown }
  | { ok: false; error: string; httpStatus: number; rawResponse?: unknown };

export async function createPalremitOfframpFiatWithdrawal(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: { body: Record<string, unknown>; txnRef: string }
): Promise<PalremitOfframpFiatWithdrawalResult | null> {
  const body = params.body;
  const txnRef = params.txnRef;
  if (!body) return null;

  const idempotencyKey = `offramp-fiat-wd:${txnRef.trim()}`;
  const created = await createPalremitWithdrawalDetailed(liquidityRequest, body, idempotencyKey);
  if (!created.ok) {
    return {
      ok: false,
      error: created.message,
      httpStatus: created.httpStatus,
      rawResponse: created.raw,
    };
  }

  return {
    ok: true,
    withdrawalId: created.id,
    rawRequest: body,
    rawResponse: created.raw,
  };
}
