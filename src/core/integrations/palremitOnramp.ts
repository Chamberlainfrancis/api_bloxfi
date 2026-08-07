/**
 * Palremit onramp: provision fiat VA via /v1/provisioned-accounts; payout crypto via /v1/withdrawals.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  getPalremitProvisionedAccount,
  provisionPalremitDepositAccount,
  createPalremitWithdrawal,
  type PalremitDepositInstructions,
} from '@/core/integrations/palremitLiquidity';
import type { CreateOnrampRequest } from '@/types/onramp';
import type { DepositInfo } from '@/types/onramp';
import {
  buildStaticFallbackDepositInfo,
  isPreferredStaticDepositCurrency,
} from '@/core/onramps/staticDepositAccounts';
import {
  NGN_POOLED_KUDA_ACCOUNT_NAME,
  POOLED_PLATFORM_ACCOUNT_NAME,
  dynamicDepositAccountStyle,
} from '@/core/onramps/depositAccountStyle';
import {
  buildGraphBusinessKycInput,
  type GraphOnrampKycSource,
} from '@/core/integrations/graphOnrampKyc';

/** Prisma User.id for Briana Payments — Graph named USD VA; no OwlPay failover. */
export const BRIANA_BUSINESS_REFERENCE = '9eea8cbd-e545-4d15-85cd-90690ede4b0c';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Palremit may echo a virtual-account label (e.g. `Palremit-ON-<hex>`) as `account_holder_name`;
 * that is not the end-user's name. Do not treat other `Palremit-…` strings (e.g. partner test names) as synthetic.
 */
function isPalremitSyntheticHolderName(name: string): boolean {
  return /^Palremit-(ON|OFF)-[a-f0-9]+$/i.test(name.trim());
}

/**
 * Deposit beneficiary must match what the bank expects on the wire.
 * Prefer liquidity's account_holder_name (e.g. SwipeLux "Veem", Kuda "Palremit LTD").
 * Fallback when missing/synthetic depends on deposit style:
 *   pooled → platform name (never the end customer)
 *   named  → KYC/business display
 */
function resolveFiatBeneficiaryName(
  instructions: PalremitDepositInstructions,
  preferredFallback?: string
): string {
  if (instructions.kind === 'fiat_account') {
    const fromOrchestrator = String(instructions.account_holder_name ?? '').trim();
    if (fromOrchestrator && !isPalremitSyntheticHolderName(fromOrchestrator)) {
      return fromOrchestrator;
    }
  }
  const pref = preferredFallback?.trim() ?? '';
  if (pref) return pref;
  return 'Beneficiary';
}

/**
 * KYC/business display for named deposit accounts. Prefer business legal/trading
 * name over legal-representative person name.
 */
export function preferredBeneficiaryDisplayName(input: {
  businessName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | undefined {
  const biz = typeof input.businessName === 'string' ? input.businessName.trim() : '';
  if (biz) return biz;
  const joined = [input.firstName, input.lastName]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
  return joined || undefined;
}

/**
 * Fallback beneficiary when the orchestrator holder is missing/synthetic.
 * Pooled → Palremit LTD; named → business/person from KYC.
 */
export function preferredDepositBeneficiaryFallback(input: {
  currency: string;
  businessName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): string | undefined {
  if (dynamicDepositAccountStyle(input.currency) === 'pooled') {
    return POOLED_PLATFORM_ACCOUNT_NAME;
  }
  return preferredBeneficiaryDisplayName(input);
}

/** Build display-name fallback from persisted onramp `source` + currency. */
export function beneficiaryDisplayNameFromOnrampSource(
  source: unknown,
  currency?: string
): string | undefined {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const u = (source as { user?: Record<string, unknown> }).user;
  if (!u || typeof u !== 'object') return undefined;
  const names = {
    businessName: typeof u.businessName === 'string' ? u.businessName : undefined,
    firstName: typeof u.firstName === 'string' ? u.firstName : undefined,
    lastName: typeof u.lastName === 'string' ? u.lastName : undefined,
  };
  const asset =
    (typeof currency === 'string' && currency.trim() !== ''
      ? currency
      : typeof (source as { currency?: unknown }).currency === 'string'
        ? (source as { currency: string }).currency
        : '') || '';
  if (asset) return preferredDepositBeneficiaryFallback({ currency: asset, ...names });
  return preferredBeneficiaryDisplayName(names);
}

/** Map orchestrator `deposit_instructions` (fiat_account) → BloxFi DepositInfo. */
export function mapOrchestratorFiatInstructionsToDepositInfo(
  instructions: PalremitDepositInstructions,
  bloxRequestId: string,
  depositByIso: string,
  sourceAmount: number,
  sourceCurrencyUpper: string,
  preferredBeneficiaryName?: string
): DepositInfo {
  if (instructions.kind !== 'fiat_account') {
    return {
      bankName: 'Bank',
      beneficiary: { name: 'Beneficiary', address: '' },
      reference: bloxRequestId,
      depositBy: depositByIso,
      instruction: `Fiat deposit pending. Reference ${bloxRequestId}.`,
    };
  }
  const accountNumber = String(instructions.account_number ?? '');
  const bankCode = String(instructions.bank_code ?? '');
  const inst = instructions as Record<string, unknown>;
  const rawCountry =
    [inst.country, inst.country_code, inst.bank_country]
      .find((v) => typeof v === 'string' && String(v).trim() !== '') ?? '';
  const country = typeof rawCountry === 'string' ? rawCountry.trim() : '';
  // Prefer the orchestrator's own reference when present — required for
  // pooled-payin providers (e.g. SwipeLux), where account_number is
  // shared across many depositors and only this reference disambiguates
  // an incoming wire. Fabricating our own reference here would mean the
  // depositor is shown a value the provider can never match to anything.
  const providerReference =
    typeof inst.reference === 'string' && inst.reference.trim() !== '' ? inst.reference.trim() : null;
  const ref =
    providerReference ?? ([accountNumber, bankCode].filter(Boolean).join('-') || bloxRequestId);
  return {
    bankName: String(instructions.bank_name ?? 'Bank'),
    beneficiary: {
      name: resolveFiatBeneficiaryName(instructions, preferredBeneficiaryName),
      address: '',
      ...(country ? { country } : {}),
    },
    ach: undefined,
    wire: { routingNumber: bankCode, accountNumber },
    pix: undefined,
    reference: ref,
    depositBy: depositByIso,
    instruction: `Deposit ${sourceAmount} ${sourceCurrencyUpper} to the account above using reference ${ref} before ${depositByIso}. Crypto is sent after your fiat deposit is confirmed.`,
  };
}

/**
 * Poll until deposit instructions are usable or the account fails.
 *
 * NOT the same as "poll until active". For providers whose deposit
 * instructions are only confirmed-funds-safe once settlement lands
 * (SwipeLux), `active` is reached only after the depositor's money is
 * actually confirmed — which can take far longer than a synchronous poll
 * window. Instructions themselves are available earlier, while the row is
 * still `pending` (see the orchestrator's provider_context.provider_substate
 * design). Stop as soon as `deposit_instructions` is non-null, regardless
 * of state — that's the signal this function's caller actually needs.
 */
async function pollProvisionedUntilInstructionsOrFailed(
  request: PalremitLiquidityRequestFn,
  accountId: string,
  opts: { maxAttempts: number; delayMs: number }
): Promise<{ account: Awaited<ReturnType<typeof getPalremitProvisionedAccount>>; failed: boolean }> {
  for (let i = 0; i < opts.maxAttempts; i++) {
    const acc = await getPalremitProvisionedAccount(request, accountId);
    const st = acc?.state?.toLowerCase() ?? '';
    if (st === 'failed') return { account: acc, failed: true };
    if (acc?.deposit_instructions) return { account: acc, failed: false };
    await sleep(opts.delayMs);
  }
  const last = await getPalremitProvisionedAccount(request, accountId);
  return { account: last, failed: last?.state?.toLowerCase() === 'failed' };
}

function staticFallbackDepositResult(params: {
  currency: string;
  amount: number;
  txnRef: string;
  depositByIso: string;
  reason: string;
}): { depositInfo: DepositInfo; providerRefs: Record<string, unknown> } | null {
  const asset = params.currency.trim().toUpperCase();
  const depositInfo = buildStaticFallbackDepositInfo({
    currency: asset,
    amount: params.amount,
    txnRef: params.txnRef,
    depositByIso: params.depositByIso,
  });
  if (!depositInfo) return null;
  return {
    depositInfo,
    providerRefs: {
      palremitOrchestrator: {
        providerName: 'static_fallback',
        clientReference: params.txnRef.trim(),
        asset,
        mode: 'STATIC_FALLBACK',
        depositAsset: asset,
        withdrawalAsset: null,
        network: null,
        depositStatus: 'awaiting_manual_credit',
        withdrawalStatus: null,
        provisionedAccountId: null,
        staticFallbackReason: params.reason,
      },
    },
  };
}

export async function createOnrampPalremitFiatDeposit(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: {
    firstName: string;
    lastName: string;
    email: string;
    currency: string;
    amount: number;
    bloxRequestId: string;
    depositByIso: string;
    txnRef: string;
    businessReference: string;
    /** Business legal/trading name — preferred over person name for beneficiary.label. */
    businessName?: string;
    /**
     * Prisma Account.id, sent as `account_reference` so SwipeLux customer
     * identity resolves per account rather than per business. Omitted when
     * inference could not settle on one account (see inferOnrampAccount) —
     * the orchestrator then falls back to its per-business path.
     */
    accountReference?: string;
    /** Account contact email — seeds the orchestrator's one-time SwipeLux lookup. */
    contactEmail?: string;
    /** SwipeLux customer type; cannot be derived from User.type. */
    customerType?: 'individual' | 'business';
    /**
     * Briana USD → Graph: User fields + Graph extras (documents / background / UBO id).
     * Required for Briana USD; builder fails closed if Graph-required fields are missing.
     */
    graphKyc?: GraphOnrampKycSource;
  }
): Promise<{ depositInfo: DepositInfo; providerRefs: Record<string, unknown> } | null> {
  const asset = params.currency.trim().toUpperCase();
  const isBrianaUsd =
    asset === 'USD' && params.businessReference === BRIANA_BUSINESS_REFERENCE;

  const fallback = (reason: string) => {
    // Briana Graph path: never silent OwlPay/SwipeLux/static house fallback.
    if (isBrianaUsd) {
      throw new Error('PALREMIT_FIAT_DEPOSIT_FAILED');
    }
    return staticFallbackDepositResult({
      currency: asset,
      amount: params.amount,
      txnRef: params.txnRef,
      depositByIso: params.depositByIso,
      reason,
    });
  };

  // GBP / GHS / NGN: prefer platform receiving accounts for now (ops manual credit).
  // NGN PalmPay is temporary — remove from preferred static when Kuda VAs return.
  // Skip orchestrator provision entirely so we always return bank details.
  if (isPreferredStaticDepositCurrency(asset)) {
    return fallback('preferred_static');
  }

  // NGN (Kuda) and non-Briana USD (SwipeLux) onboard identity out of band.
  // Briana USD uses Graph named VA via FIAT_DEPOSIT_KYC. Other currencies
  // still use the orchestrator-driven KYC path.
  const mode: 'FIAT_DEPOSIT_NO_KYC' | 'FIAT_DEPOSIT_KYC' = isBrianaUsd
    ? 'FIAT_DEPOSIT_KYC'
    : asset === 'NGN' || asset === 'USD'
      ? 'FIAT_DEPOSIT_NO_KYC'
      : 'FIAT_DEPOSIT_KYC';

  const body: Record<string, unknown> = {
    asset,
    mode,
    client_reference: params.txnRef.trim(),
    business_reference: params.businessReference,
  };

  // Deposit naming: pooled vs named (static is handled above / on fallback).
  // - NGN (Kuda): account_name "LTD." → issued holder "Palremit-LTD."
  //   (Kuda merchant-prefixes "Palremit-"; do not send "Palremit LTD").
  // - Non-Briana USD (SwipeLux): amount-scoped pooled pay-ins.
  // - Briana USD (Graph): named VA — no amount extras; full kyc_input below.
  if (asset === 'NGN') {
    body.provider_extras = { account_name: NGN_POOLED_KUDA_ACCOUNT_NAME };
  } else if (asset === 'USD' && !isBrianaUsd) {
    const providerExtras: Record<string, unknown> = { amount: String(params.amount) };
    // Per-account SwipeLux identity. account_reference switches the
    // orchestrator from per-business to per-account resolution; contact_email
    // seeds its one-time lookup and customer_type disambiguates when the
    // address maps to several SwipeLux customers. All three are omitted
    // together when inference could not settle on an account.
    if (params.accountReference) {
      body.account_reference = params.accountReference;
      if (params.contactEmail) providerExtras.contact_email = params.contactEmail;
      if (params.customerType) providerExtras.customer_type = params.customerType;
    }
    body.provider_extras = providerExtras;
  } else if (isBrianaUsd) {
    // Bancara: Graph only — no SwipeLux/OwlPay/static fallthrough.
    body.allow_provider_failover = false;
    body.preferred_provider = 'graph';
    body.kyc_input = buildGraphBusinessKycInput(params.graphKyc ?? {});
  }

  if (mode === 'FIAT_DEPOSIT_KYC' && !isBrianaUsd) {
    body.kyc_input = {
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
    };
  }

  const idempotencyKey = `onramp-fiat-prov:${params.txnRef.trim()}`;
  const rawRequest = { ...body };
  let prov: Awaited<ReturnType<typeof provisionPalremitDepositAccount>>;
  try {
    prov = await provisionPalremitDepositAccount(liquidityRequest, body, idempotencyKey);
  } catch (e) {
    // Briana Graph: fail closed (no static/OwlPay house). Non-Briana rethrows
    // so existing HTTP-adapter → null → static-fallback behavior is unchanged
    // when provisionPalremitDepositAccount surfaces a non-HTTP error.
    if (isBrianaUsd) throw new Error('PALREMIT_FIAT_DEPOSIT_FAILED');
    throw e;
  }
  if (!prov) return fallback('provision_failed');

  let account = prov.account;
  const rawProvisionResponse = { ...account };

  if (!account.deposit_instructions && account.state?.toLowerCase() !== 'failed') {
    const polled = await pollProvisionedUntilInstructionsOrFailed(liquidityRequest, account.id, {
      maxAttempts: 20,
      delayMs: 2000,
    });
    if (polled.failed || !polled.account) {
      return fallback(polled.failed ? 'provision_state_failed' : 'provision_poll_empty');
    }
    account = polled.account;
  }

  // NOT gated on state === 'active' — for providers like SwipeLux,
  // instructions are correctly available while the row is still `pending`
  // (funds not yet confirmed; see pollProvisionedUntilInstructionsOrFailed's
  // doc comment). deposit_instructions being present is the actual signal.
  if (!account.deposit_instructions) {
    return fallback(
      account.state?.toLowerCase() === 'failed' ? 'provision_state_failed' : 'no_deposit_instructions'
    );
  }

  const instr = account.deposit_instructions as PalremitDepositInstructions;
  if (instr.kind !== 'fiat_account') return fallback('unsupported_instruction_kind');

  const preferredBeneficiaryName = preferredDepositBeneficiaryFallback({
    currency: asset,
    businessName: params.businessName,
    firstName: params.firstName,
    lastName: params.lastName,
  });

  const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
    instr,
    params.bloxRequestId,
    params.depositByIso,
    params.amount,
    asset,
    preferredBeneficiaryName
  );

  return {
    depositInfo,
    providerRefs: {
      palremitOrchestrator: {
        provisionedAccountId: account.id,
        clientReference: account.client_reference,
        asset,
        mode,
        providerName:
          typeof account.provider_name === 'string' ? account.provider_name : undefined,
        depositAsset: asset,
        withdrawalAsset: null,
        network: null,
        depositStatus: account.state,
        withdrawalStatus: null,
        rawProvisionRequest: rawRequest,
        rawProvisionResponse,
      },
    },
  };
}

export interface PalremitOnrampWithdrawResult {
  withdrawalId: string;
  clientReference: string;
  rawWithdrawalRequest: Record<string, unknown>;
  rawWithdrawalResponse: unknown;
}

export async function executePalremitOnrampCryptoWithdrawal(
  liquidityRequest: PalremitLiquidityRequestFn,
  body: Omit<CreateOnrampRequest, 'requestId'>,
  _requestId: string,
  receiveNetCryptoAmount: number,
  destinationAddress: string,
  txnRef: string,
  destinationMemo?: string | null
): Promise<PalremitOnrampWithdrawResult | null> {
  const destCurrency = body.destination.currency.trim().toUpperCase();
  const destNetwork = body.destination.chain.trim();

  /** Net crypto to user wallet (fee already applied in quote). */
  const sendAmount = Math.max(receiveNetCryptoAmount, 0);

  const memoTrim =
    typeof destinationMemo === 'string' && destinationMemo.trim() !== ''
      ? destinationMemo.trim()
      : undefined;

  const destination: Record<string, unknown> = {
    address: destinationAddress.trim(),
    ...(memoTrim !== undefined ? { memo: memoTrim } : {}),
  };

  const withdrawalBody: Record<string, unknown> = {
    client_reference: txnRef.trim(),
    asset: destCurrency,
    amount: sendAmount,
    destination_type: 'crypto_address',
    network: destNetwork,
    destination,
  };

  const idempotencyKey = `onramp-crypto-wd:${txnRef.trim()}`;
  const created = await createPalremitWithdrawal(liquidityRequest, withdrawalBody, idempotencyKey);
  if (!created?.id) return null;

  return {
    withdrawalId: created.id,
    clientReference: created.client_reference,
    rawWithdrawalRequest: withdrawalBody,
    rawWithdrawalResponse: created.raw,
  };
}
