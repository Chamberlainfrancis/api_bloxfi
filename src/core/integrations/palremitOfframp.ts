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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function mapCryptoInstructionsToDepositInstructions(
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

/** Build NGN bank payout destination for orchestrator `bank_account` withdrawals. */
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
  const country =
    typeof region.country === 'string' && region.country.length >= 2
      ? String(region.country).slice(0, 2).toUpperCase()
      : 'NG';
  return {
    account_unique: accountNumber,
    account_name: accountName,
    provider_name: bankName,
    provider_code: bankCode,
    country,
  };
}

export async function createPalremitOfframpFiatWithdrawal(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: {
    txnRef: string;
    destinationAmount: number;
    destinationCurrency: string;
    destinationInformation: Record<string, string>;
  }
): Promise<{ withdrawalId: string; rawRequest: Record<string, unknown>; rawResponse: unknown } | null> {
  const bankCode = params.destinationInformation.provider_code?.trim();
  const accountNumber = params.destinationInformation.account_unique?.trim();
  if (!bankCode || !accountNumber) return null;

  const asset = params.destinationCurrency.trim().toUpperCase();
  const body: Record<string, unknown> = {
    client_reference: params.txnRef.trim(),
    asset,
    amount: params.destinationAmount,
    destination_type: 'bank_account',
    destination: {
      bank_code: bankCode,
      account_number: accountNumber,
    },
  };

  const idempotencyKey = `offramp-fiat-wd:${params.txnRef.trim()}`;
  const created = await createPalremitWithdrawal(liquidityRequest, body, idempotencyKey);
  if (!created?.id) return null;

  return {
    withdrawalId: created.id,
    rawRequest: body,
    rawResponse: created.raw,
  };
}
