/**
 * One-off ops: issue Graph named USD VA for an existing onramp Account and
 * persist providerIssuance* fields.
 *
 * Usage:
 *   PALREMIT_LIQUIDITY_URL=https://liquidity.palremit.com \
 *     pnpm exec ts-node -r tsconfig-paths/register scripts/issue-graph-account.ts <accountId>
 */

import { issueGraphNamedDepositAccount } from '@/core/accounts/graphAccountIssuance';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  findAccountById,
  updateAccountProviderIssuance,
} from '@/db/repositories/account.repo';
import { prisma } from '@/db/prisma/client';
import { palremitLiquidityRequest } from '@/services/palremitClient';

/** Graph KYC + VA provision routinely exceeds the default 15s client timeout. */
const OPS_TIMEOUT_MS = 120_000;

function createOpsLiquidityAdapter(): PalremitLiquidityRequestFn {
  return async <T>(
    path: string,
    options?: { method?: string; body?: unknown; headers?: Record<string, string> }
  ) => {
    const r = await palremitLiquidityRequest<T>(path, {
      method: (options?.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') ?? 'GET',
      body: options?.body,
      headers: options?.headers,
      timeoutMs: OPS_TIMEOUT_MS,
    });
    return { status: r.status, data: r.data };
  };
}

async function main(): Promise<void> {
  const accountId = process.argv[2]?.trim();
  if (!accountId) {
    console.error('Usage: issue-graph-account.ts <accountId>');
    process.exit(1);
  }

  const account = await findAccountById(accountId);
  if (!account) {
    console.error(`Account not found: ${accountId}`);
    process.exit(1);
  }
  if (account.railType !== 'onramp') {
    console.error(`Account ${accountId} railType=${account.railType} (expected onramp)`);
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        accountId: account.id,
        userId: account.userId,
        holderEmail: (account.accountHolder as { email?: string } | null)?.email,
        liquidityUrl: process.env.PALREMIT_LIQUIDITY_URL,
      },
      null,
      2
    )
  );

  const liquidity = createOpsLiquidityAdapter();
  const issued = await issueGraphNamedDepositAccount(
    liquidity,
    {
      id: account.id,
      userId: account.userId,
      accountHolder: account.accountHolder,
      sofQuestionnaire: account.sofQuestionnaire,
      metadata: account.metadata,
    },
    // New key each ops retry so we do not replay a prior failed provision.
    { idempotencyKey: `account-graph-prov:${account.id}:retry:${Date.now()}` }
  );

  const updated = await updateAccountProviderIssuance(account.id, {
    providerIssuanceStatus: issued.providerIssuanceStatus,
    provisionedAccountId: issued.provisionedAccountId,
    depositDetails: issued.depositDetails,
    providerIssuanceFailureReason: issued.providerIssuanceFailureReason,
  });

  console.log(
    JSON.stringify(
      {
        providerIssuanceStatus: updated.providerIssuanceStatus,
        provisionedAccountId: updated.provisionedAccountId,
        providerIssuanceFailureReason: updated.providerIssuanceFailureReason,
        depositDetails: updated.depositDetails,
      },
      null,
      2
    )
  );

  if (issued.providerIssuanceStatus === 'failed') {
    process.exit(2);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
