/**
 * Provision Graph named USD VA at onramp Account create time.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  getPalremitProvisionedAccount,
  provisionPalremitDepositAccount,
  type PalremitDepositInstructions,
} from '@/core/integrations/palremitLiquidity';
import {
  buildGraphIndividualKycInput,
} from '@/core/integrations/graphOnrampKyc';
import { logger } from '@/lib/logger';
import type {
  AccountDepositDetails,
  AccountMetadata,
  ProviderIssuanceStatus,
} from '@/types/account';

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function depositDetailsFromInstructions(
  instructions: PalremitDepositInstructions
): AccountDepositDetails | null {
  if (instructions.kind !== 'fiat_account') return null;
  const inst = instructions as Record<string, unknown>;
  const accountNumber = String(instructions.account_number ?? '').trim();
  const routingNumber = String(instructions.bank_code ?? '').trim();
  if (!accountNumber) return null;
  const rawCountry = [inst.country, inst.country_code, inst.bank_country].find(
    (v) => typeof v === 'string' && String(v).trim() !== ''
  );
  const reference =
    typeof inst.reference === 'string' && inst.reference.trim() !== ''
      ? inst.reference.trim()
      : null;
  return {
    bankName: String(instructions.bank_name ?? 'Bank'),
    accountNumber,
    routingNumber,
    accountHolderName: String(instructions.account_holder_name ?? '').trim() || 'Account Holder',
    reference,
    ...(typeof rawCountry === 'string' && rawCountry.trim()
      ? { country: rawCountry.trim() }
      : {}),
  };
}

async function pollUntilInstructionsOrFailed(
  request: PalremitLiquidityRequestFn,
  provisionedAccountId: string,
  opts: { maxAttempts: number; delayMs: number }
): Promise<{
  account: Awaited<ReturnType<typeof getPalremitProvisionedAccount>>;
  failed: boolean;
}> {
  for (let i = 0; i < opts.maxAttempts; i++) {
    const acc = await getPalremitProvisionedAccount(request, provisionedAccountId);
    const st = acc?.state?.toLowerCase() ?? '';
    if (st === 'failed') return { account: acc, failed: true };
    if (acc?.deposit_instructions) return { account: acc, failed: false };
    await sleep(opts.delayMs);
  }
  const last = await getPalremitProvisionedAccount(request, provisionedAccountId);
  return { account: last, failed: last?.state?.toLowerCase() === 'failed' };
}

export type GraphIssuanceResult = {
  providerIssuanceStatus: ProviderIssuanceStatus;
  provisionedAccountId: string | null;
  depositDetails: AccountDepositDetails | null;
  providerIssuanceFailureReason: string | null;
};

export type GraphIssuanceAccountSource = {
  id: string;
  userId: string;
  accountHolder: unknown;
  sofQuestionnaire: unknown;
  metadata: unknown;
};

/**
 * Build KYC + provision Graph. Throws GraphOnrampKycError if KYC incomplete.
 * Returns pending/active/failed without throwing on orchestrator transport errors.
 *
 * @param options.idempotencyKey — override for retries after a failed provision
 *   (default `account-graph-prov:{accountId}` is stable for first create).
 */
export async function issueGraphNamedDepositAccount(
  liquidityRequest: PalremitLiquidityRequestFn,
  account: GraphIssuanceAccountSource,
  options?: { idempotencyKey?: string }
): Promise<GraphIssuanceResult> {
  const meta = account.metadata as AccountMetadata | null | undefined;
  const kycInput = buildGraphIndividualKycInput({
    accountHolder: account.accountHolder,
    sofQuestionnaire: account.sofQuestionnaire,
    documents: meta?.documents,
  });

  const body: Record<string, unknown> = {
    asset: 'USD',
    mode: 'FIAT_DEPOSIT_KYC',
    client_reference: account.id,
    business_reference: account.userId,
    account_reference: account.id,
    preferred_provider: 'graph',
    allow_provider_failover: false,
    kyc_input: kycInput,
  };

  const idempotencyKey = options?.idempotencyKey ?? `account-graph-prov:${account.id}`;
  let prov: Awaited<ReturnType<typeof provisionPalremitDepositAccount>>;
  try {
    prov = await provisionPalremitDepositAccount(liquidityRequest, body, idempotencyKey);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'GRAPH_PROVISION_FAILED';
    logger.error({ err: e, accountId: account.id }, 'graph account provision request failed');
    return {
      providerIssuanceStatus: 'failed',
      provisionedAccountId: null,
      depositDetails: null,
      providerIssuanceFailureReason: message,
    };
  }

  if (!prov?.account?.id) {
    return {
      providerIssuanceStatus: 'failed',
      provisionedAccountId: null,
      depositDetails: null,
      providerIssuanceFailureReason: 'GRAPH_PROVISION_EMPTY_RESPONSE',
    };
  }

  const provisionedAccountId = prov.account.id;
  let status: ProviderIssuanceStatus = 'pending';
  let depositDetails: AccountDepositDetails | null = null;
  let failureReason: string | null = null;

  if (prov.account.state?.toLowerCase() === 'failed') {
    status = 'failed';
    failureReason = 'GRAPH_PROVISION_STATE_FAILED';
  } else if (prov.account.deposit_instructions) {
    depositDetails = depositDetailsFromInstructions(prov.account.deposit_instructions);
    if (depositDetails) status = 'active';
  } else {
    const polled = await pollUntilInstructionsOrFailed(liquidityRequest, provisionedAccountId, {
      maxAttempts: 10,
      delayMs: 2000,
    });
    if (polled.failed) {
      status = 'failed';
      failureReason = 'GRAPH_PROVISION_STATE_FAILED';
    } else if (polled.account?.deposit_instructions) {
      depositDetails = depositDetailsFromInstructions(polled.account.deposit_instructions);
      if (depositDetails) status = 'active';
    }
  }

  return {
    providerIssuanceStatus: status,
    provisionedAccountId,
    depositDetails,
    providerIssuanceFailureReason: failureReason,
  };
}
