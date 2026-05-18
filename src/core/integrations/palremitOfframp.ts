/**
 * Palremit offramp: provision crypto address via /v1/provisioned-accounts; fiat payout via /v1/withdrawals.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  createPalremitWithdrawal,
  getPalremitProvisionedAccount,
  listPalremitProvisionedAccounts,
  provisionPalremitDepositAccount,
  type PalremitDepositInstructions,
} from '@/core/integrations/palremitLiquidity';
import type { CreateOfframpRequest } from '@/types/offramp';
import type { DepositInstructions } from '@/types/offramp';
import { isHttpError } from '@/services/http';
import {
  palremitUsdGlobalBankDestinationSchema,
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

/**
 * Liquidity withdrawal payloads expect a 2-letter country code when present.
 * Accepts any stored `details.country` / `details.bankCountry`; only obvious ISO2 is forwarded as-is.
 */
function countryCodeForLiquidityWithdrawal(country: unknown, bankCountry: unknown): string {
  for (const raw of [country, bankCountry]) {
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  }
  return 'NG';
}

/** Build bank payout destination for orchestrator `bank_account` withdrawals. */
export function buildPalremitFiatDestinationInformation(
  accountHolder: unknown,
  regionDetails: unknown
): Record<string, string> {
  const holder =
    accountHolder && typeof accountHolder === 'object'
      ? (accountHolder as Record<string, unknown>)
      : {};
  const region =
    regionDetails && typeof regionDetails === 'object'
      ? (regionDetails as Record<string, unknown>)
      : {};
  const accountNumber =
    (region.accountNumber as string) ?? (region.account_number as string) ?? '';
  const bankName = (region.bankName as string) ?? (region.bank_name as string) ?? 'Bank';
  const bankCode = (region.bankCode as string) ?? (region.bank_code as string) ?? '00';
  const accountName =
    (holder.name as string) ?? (holder.account_name as string) ?? 'Account Holder';
  const country = countryCodeForLiquidityWithdrawal(region.country, region.bankCountry);
  return {
    account_unique: accountNumber,
    account_name: accountName,
    provider_name: bankName,
    provider_code: bankCode,
    country,
  };
}

const PALREMIT_USD_GLOBAL_DESTINATION_KEYS = new Set([
  'country',
  'payout_rail',
  'account_number',
  'bank_code',
  'bank_name',
  'account_holder_name',
  'beneficiary',
  'extras',
]);

const METADATA_SKIP_KEYS = new Set([
  'transferPurpose',
  'isSelfTransfer',
  'transfer_purpose',
  'is_self_transfer',
]);

const API_ROOT_TO_PALREMIT: Record<string, string> = {
  payoutRail: 'payout_rail',
  accountNumber: 'account_number',
  bankCode: 'bank_code',
  bankName: 'bank_name',
  accountHolderName: 'account_holder_name',
  country: 'country',
  beneficiary: 'beneficiary',
  extras: 'extras',
};

function mapBeneficiaryApiToPalremit(
  ben: unknown,
  fallbackHolderType?: 'business' | 'individual'
): Record<string, unknown> | null {
  if (!ben || typeof ben !== 'object' || Array.isArray(ben)) return null;
  const b = ben as Record<string, unknown>;
  const addr = b.address as Record<string, unknown> | undefined;
  if (!addr) return null;
  const state = addr.stateProvince ?? addr.state_province;
  const postal = addr.postalCode ?? addr.postal_code;
  const typeRaw = b.type ?? fallbackHolderType;
  if (typeRaw !== 'individual' && typeRaw !== 'business') return null;
  return {
    name: b.name,
    type: typeRaw,
    address: {
      street: addr.street,
      city: addr.city,
      state_province: String(state ?? ''),
      postal_code: String(postal ?? ''),
      country: String(addr.country ?? '')
        .trim()
        .toUpperCase(),
    },
  };
}

/** Partial `extras` overlay from client `metadata.extras` (optional `transfer_purpose` override). */
function mapExtrasApiToPalremit(ex: unknown): Record<string, unknown> | null {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) return null;
  const e = ex as Record<string, unknown>;
  const tp = e.transferPurpose ?? e.transfer_purpose;
  const st = e.isSelfTransfer ?? e.is_self_transfer;
  const out: Record<string, unknown> = {};
  if (typeof tp === 'string' && tp.trim()) out.transfer_purpose = tp.trim();
  if (typeof st === 'boolean') out.is_self_transfer = st;
  return Object.keys(out).length ? out : null;
}

/** Maps client `metadata` (camelCase; optional legacy snake) to Palremit `destination` fragment. Skips keys consumed elsewhere (`transferPurpose`, `isSelfTransfer`, …). */
function mapUsdDestinationMetadataApiToPalremit(
  metadata: Record<string, unknown> | undefined,
  accountHolder?: Record<string, unknown>
): Record<string, unknown> {
  const holderType =
    accountHolder &&
    typeof accountHolder.type === 'string' &&
    (accountHolder.type === 'individual' || accountHolder.type === 'business')
      ? (accountHolder.type as 'individual' | 'business')
      : undefined;
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (METADATA_SKIP_KEYS.has(k)) continue;
    const palKey = API_ROOT_TO_PALREMIT[k] ?? (PALREMIT_USD_GLOBAL_DESTINATION_KEYS.has(k) ? k : null);
    if (!palKey) continue;
    if (palKey === 'beneficiary') {
      const m = mapBeneficiaryApiToPalremit(v, holderType);
      if (m) out[palKey] = m;
    } else if (palKey === 'extras') {
      const m = mapExtrasApiToPalremit(v);
      if (m) out[palKey] = m;
    } else {
      out[palKey] = v;
    }
  }
  return out;
}

function deepMergeRecords(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (
      v != null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      out[k] != null &&
      typeof out[k] === 'object' &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMergeRecords(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface MapStoredUsdAccountToPalremitGlobalBankDestinationInput {
  regionDetails: unknown;
  accountHolder: unknown;
  /** BloxFi `destination.purposeOfPayment` → Palremit `destination.extras.transfer_purpose`. */
  purposeOfPayment: string;
  /** Per-offramp: `isSelfTransfer` and optional Palremit `destination` overrides (camelCase). */
  metadata?: Record<string, unknown>;
}

/**
 * Merge saved USD account (`details` + `transferDetails`) with offramp fields into Palremit
 * `destination` for `destination_type: global_bank_account`.
 */
export function mapStoredUsdAccountToPalremitGlobalBankDestination(
  input: MapStoredUsdAccountToPalremitGlobalBankDestinationInput
): Record<string, unknown> | null {
  const purposeParsed = usdPalremitTransferPurposeSchema.safeParse(input.purposeOfPayment.trim());
  if (!purposeParsed.success) return null;

  const metaParsed = usdOfframpOptionalMetadataSchema.safeParse(input.metadata ?? {});
  if (!metaParsed.success) return null;

  const region =
    input.regionDetails && typeof input.regionDetails === 'object' && !Array.isArray(input.regionDetails)
      ? (input.regionDetails as Record<string, unknown>)
      : {};
  const gbp = region.transferDetails;
  if (!gbp || typeof gbp !== 'object' || Array.isArray(gbp)) return null;
  const g = gbp as Record<string, unknown>;

  const accountNumber = String(region.accountNumber ?? region.account_number ?? '')
    .trim()
    .replace(/\s+/g, '');
  const bankCode = String(region.bankCode ?? region.bank_code ?? '')
    .trim()
    .replace(/\s+/g, '');
  const bankName = String(region.bankName ?? region.bank_name ?? '').trim();
  const ben = g.beneficiary as Record<string, unknown> | undefined;
  const benAddr =
    ben?.address && typeof ben.address === 'object' && !Array.isArray(ben.address)
      ? (ben.address as Record<string, unknown>)
      : undefined;
  const benCountry = String(benAddr?.country ?? '').trim().toUpperCase();
  const country = String(region.country ?? region.bankCountry ?? (benCountry || 'US'))
    .trim()
    .toUpperCase();

  const holder =
    input.accountHolder && typeof input.accountHolder === 'object' && !Array.isArray(input.accountHolder)
      ? (input.accountHolder as Record<string, unknown>)
      : {};
  const rawHolderName = String(
    g.accountHolderName ?? g.account_holder_name ?? ''
  ).trim();
  const accountHolderName =
    rawHolderName || (typeof holder.name === 'string' ? holder.name.trim() : '') || '';

  const payoutRail = String(g.payoutRail ?? g.payout_rail ?? '')
    .trim()
    .toUpperCase();

  const holderType =
    typeof holder.type === 'string' && (holder.type === 'individual' || holder.type === 'business')
      ? (holder.type as 'individual' | 'business')
      : undefined;

  const beneficiaryPalremit = mapBeneficiaryApiToPalremit(g.beneficiary, holderType);
  if (!beneficiaryPalremit) return null;

  const base: Record<string, unknown> = {
    country,
    payout_rail: payoutRail,
    account_number: accountNumber,
    bank_code: bankCode,
    bank_name: bankName,
    account_holder_name: accountHolderName,
    beneficiary: beneficiaryPalremit,
    extras: {
      transfer_purpose: purposeParsed.data,
      is_self_transfer: metaParsed.data.isSelfTransfer,
    },
  };

  const overlay = mapUsdDestinationMetadataApiToPalremit(input.metadata, holder);
  const merged = deepMergeRecords(base, overlay);
  const parsed = palremitUsdGlobalBankDestinationSchema.safeParse(merged);
  if (!parsed.success) return null;
  return parsed.data as unknown as Record<string, unknown>;
}

export type PalremitOfframpFiatWithdrawalParams =
  | {
      payoutKind: 'local_bank_account';
      txnRef: string;
      destinationAmount: number;
      destinationCurrency: string;
      destinationInformation: Record<string, string>;
    }
  | {
      payoutKind: 'global_bank_account';
      txnRef: string;
      destinationAmount: number;
      asset: string;
      destination: Record<string, unknown>;
    };

/** Builds POST /v1/withdrawals JSON for offramp fiat payout (local NGN bank vs global USD bank). */
export function buildPalremitOfframpFiatWithdrawalBody(
  params: PalremitOfframpFiatWithdrawalParams
): Record<string, unknown> | null {
  if (params.payoutKind === 'local_bank_account') {
    const bankCode = params.destinationInformation.provider_code?.trim();
    const accountNumber = params.destinationInformation.account_unique?.trim();
    if (!bankCode || !accountNumber) return null;
    const asset = params.destinationCurrency.trim().toUpperCase();
    return {
      client_reference: params.txnRef.trim(),
      asset,
      amount: params.destinationAmount,
      destination_type: 'bank_account',
      destination: {
        bank_code: bankCode,
        account_number: accountNumber,
      },
    };
  }

  const asset = params.asset.trim().toUpperCase();
  const dest = params.destination;
  if (!dest || typeof dest !== 'object') return null;
  const d = dest as Record<string, unknown>;
  const accountNumber = typeof d.account_number === 'string' ? d.account_number.trim() : '';
  const bankCode = typeof d.bank_code === 'string' ? d.bank_code.trim() : '';
  if (!accountNumber || !bankCode) return null;

  return {
    client_reference: params.txnRef.trim(),
    asset,
    amount: params.destinationAmount,
    destination_type: 'global_bank_account',
    destination: params.destination,
  };
}

export async function createPalremitOfframpFiatWithdrawal(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: PalremitOfframpFiatWithdrawalParams,
  context?: { offrampId?: string }
): Promise<{ withdrawalId: string; rawRequest: Record<string, unknown>; rawResponse: unknown } | null> {
  const body = buildPalremitOfframpFiatWithdrawalBody(params);
  if (!body) return null;

  const idempotencyKey = `offramp-fiat-wd:${params.txnRef.trim()}`;
  try {
    const created = await createPalremitWithdrawal(liquidityRequest, body, idempotencyKey);
    if (!created?.id) return null;

    return {
      withdrawalId: created.id,
      rawRequest: body,
      rawResponse: created.raw,
    };
  } catch (e) {
    const ctx =
      context?.offrampId != null && context.offrampId.trim() !== ''
        ? ` offrampId=${context.offrampId.trim()}`
        : '';
    const upstream =
      isHttpError(e) && e.data !== undefined
        ? typeof e.data === 'string'
          ? e.data
          : JSON.stringify(e.data)
        : '';
    console.error(
      `[Palremit offramp fiat withdrawal]${ctx} POST /v1/withdrawals failed; request body:\n${JSON.stringify(
        body,
        null,
        2
      )}${isHttpError(e) ? `\nHTTP ${e.status}; upstream: ${upstream || '(no body)'}` : ''}`
    );
    throw e;
  }
}
