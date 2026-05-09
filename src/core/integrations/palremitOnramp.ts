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

/** Map orchestrator `deposit_instructions` (fiat_account) → BloxFi DepositInfo. */
export function mapOrchestratorFiatInstructionsToDepositInfo(
  instructions: PalremitDepositInstructions,
  bloxRequestId: string,
  depositByIso: string,
  sourceAmount: number,
  sourceCurrencyUpper: string
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
  const ref =
    [accountNumber, bankCode].filter(Boolean).join('-') || bloxRequestId;
  return {
    bankName: String(instructions.bank_name ?? 'Bank'),
    beneficiary: {
      name: String(instructions.account_holder_name ?? 'Beneficiary'),
      address: '',
    },
    ach: undefined,
    wire: { routingNumber: bankCode, accountNumber },
    pix: undefined,
    reference: ref,
    depositBy: depositByIso,
    instruction: `Deposit ${sourceAmount} ${sourceCurrencyUpper} to the account above using reference ${ref} before ${depositByIso}. Crypto is sent after your fiat deposit is confirmed.`,
  };
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
  }
): Promise<{ depositInfo: DepositInfo; providerRefs: Record<string, unknown> } | null> {
  const asset = params.currency.trim().toUpperCase();
  const mode: 'FIAT_DEPOSIT_NO_KYC' | 'FIAT_DEPOSIT_KYC' =
    asset === 'NGN' ? 'FIAT_DEPOSIT_NO_KYC' : 'FIAT_DEPOSIT_KYC';

  const body: Record<string, unknown> = {
    asset,
    mode,
    client_reference: params.txnRef.trim(),
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
  if (instr.kind !== 'fiat_account') return null;

  const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
    instr,
    params.bloxRequestId,
    params.depositByIso,
    params.amount,
    asset
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
  txnRef: string
): Promise<PalremitOnrampWithdrawResult | null> {
  const destCurrency = body.destination.currency.trim().toUpperCase();
  const destNetwork = body.destination.chain.trim();

  /** Net crypto to user wallet (fee already applied in quote). */
  const sendAmount = Math.max(receiveNetCryptoAmount, 0);

  const withdrawalBody: Record<string, unknown> = {
    client_reference: txnRef.trim(),
    asset: destCurrency,
    amount: sendAmount,
    destination_type: 'crypto_address',
    network: destNetwork,
    destination: {
      address: destinationAddress.trim(),
      memo: null,
    },
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
