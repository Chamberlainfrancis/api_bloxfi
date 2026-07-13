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

function resolveFiatBeneficiaryName(
  instructions: PalremitDepositInstructions,
  preferredFromKyc?: string
): string {
  const pref = preferredFromKyc?.trim() ?? '';
  if (pref) return pref;
  if (instructions.kind !== 'fiat_account') return 'Beneficiary';
  const fromOrchestrator = String(instructions.account_holder_name ?? '').trim();
  if (fromOrchestrator && !isPalremitSyntheticHolderName(fromOrchestrator)) {
    return fromOrchestrator;
  }
  return 'Beneficiary';
}

/** Build display name from persisted onramp `source.user` (KYC + businessName). */
export function beneficiaryDisplayNameFromOnrampSource(source: unknown): string | undefined {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const u = (source as { user?: Record<string, unknown> }).user;
  if (!u || typeof u !== 'object') return undefined;
  const fn = typeof u.firstName === 'string' ? u.firstName.trim() : '';
  const ln = typeof u.lastName === 'string' ? u.lastName.trim() : '';
  const joined = [fn, ln].filter(Boolean).join(' ').trim();
  if (joined) return joined;
  const biz = typeof u.businessName === 'string' ? u.businessName.trim() : '';
  if (biz) return biz;
  return undefined;
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
  }
): Promise<{ depositInfo: DepositInfo; providerRefs: Record<string, unknown> } | null> {
  const asset = params.currency.trim().toUpperCase();
  // NGN (Kuda) and USD (SwipeLux) both onboard identity out of band — Kuda
  // has no KYC concept at all; SwipeLux resolves a pre-vetted provider
  // customer via business_reference (ops-managed, see
  // business_provider_customers on the orchestrator side). Every other
  // currency still uses the orchestrator-driven KYC path.
  const mode: 'FIAT_DEPOSIT_NO_KYC' | 'FIAT_DEPOSIT_KYC' =
    asset === 'NGN' || asset === 'USD' ? 'FIAT_DEPOSIT_NO_KYC' : 'FIAT_DEPOSIT_KYC';

  const body: Record<string, unknown> = {
    asset,
    mode,
    client_reference: params.txnRef.trim(),
    business_reference: params.businessReference,
  };

  if (mode === 'FIAT_DEPOSIT_KYC') {
    body.kyc_input = {
      first_name: params.firstName,
      last_name: params.lastName,
      email: params.email,
    };
  }

  const idempotencyKey = `onramp-fiat-prov:${params.txnRef.trim()}`;
  const rawRequest = { ...body };
  const prov = await provisionPalremitDepositAccount(liquidityRequest, body, idempotencyKey);
  if (!prov) return null;

  let account = prov.account;
  const rawProvisionResponse = { ...account };

  if (!account.deposit_instructions && account.state?.toLowerCase() !== 'failed') {
    const polled = await pollProvisionedUntilInstructionsOrFailed(liquidityRequest, account.id, {
      maxAttempts: 20,
      delayMs: 2000,
    });
    if (polled.failed || !polled.account) return null;
    account = polled.account;
  }

  // NOT gated on state === 'active' — for providers like SwipeLux,
  // instructions are correctly available while the row is still `pending`
  // (funds not yet confirmed; see pollProvisionedUntilInstructionsOrFailed's
  // doc comment). deposit_instructions being present is the actual signal.
  if (!account.deposit_instructions) {
    return null;
  }

  const instr = account.deposit_instructions as PalremitDepositInstructions;
  if (instr.kind !== 'fiat_account') return null;

  const preferredBeneficiaryName = [params.firstName, params.lastName]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .trim();

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
