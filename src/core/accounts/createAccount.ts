/**
 * Core: create offramp payout bank account via Palremit corridor + destination. Spec §3.1.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { getPalremitWithdrawalCorridorDetail } from '@/core/integrations/palremitCorridors';
import { validateDestinationAgainstCorridorFields } from '@/core/integrations/palremitCorridorValidate';
import type {
  CreateAccountRequest,
  CreateAccountResponse,
  ProviderPayout,
  RailType,
} from '@/types/account';

export interface AccountRepoCreate {
  createAccount(data: {
    userId: string;
    railType: RailType;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: object;
    providerPayout: object;
  }): Promise<{
    id: string;
    userId: string;
    railType: string;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: unknown;
    providerPayout: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForAccount {
  findUserById(id: string): Promise<{ id: string; kybStatus: string } | null>;
}

export interface KybRepoForAccount {
  getKybRailStatuses(
    userId: string,
    railsFilter?: string[]
  ): Promise<Array<{ rail: string; status: string; capabilities: string[] }>>;
}

export interface CreateAccountOptions {
  palremitLiquidityRequest: PalremitLiquidityRequestFn;
}

async function buildProviderPayout(
  liquidityRequest: PalremitLiquidityRequestFn,
  data: CreateAccountRequest
): Promise<ProviderPayout> {
  const corridor = data.corridor;
  const destination = { ...data.destination };

  const ben = destination.beneficiary;
  if (ben != null && typeof ben === 'object' && !Array.isArray(ben)) {
    const b = ben as Record<string, unknown>;
    if (b.type == null || b.type === '') {
      b.type = corridor.beneficiaryType;
    }
  }

  const detail = await getPalremitWithdrawalCorridorDetail(liquidityRequest, {
    asset: corridor.asset,
    country: corridor.country,
    destinationType: corridor.destinationType,
    beneficiaryType: corridor.beneficiaryType,
  });

  const validation = validateDestinationAgainstCorridorFields(
    destination,
    detail.destination_fields
  );
  if (!validation.valid) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`INVALID_ACCOUNT: ${msg}`);
  }

  return {
    provider: 'palremit',
    schemaVersion: 2,
    corridor: {
      asset: corridor.asset,
      country: corridor.country,
      destinationType: corridor.destinationType,
      beneficiaryType: corridor.beneficiaryType,
    },
    destination,
    requirementsSnapshot: {
      fetchedAt: new Date().toISOString(),
      corridor: detail.corridor as unknown as Record<string, unknown>,
      destinationFields: detail.destination_fields,
    },
  };
}

export async function createAccount(
  accountRepo: AccountRepoCreate,
  userRepo: UserRepoForAccount,
  kybRepo: KybRepoForAccount,
  userId: string,
  data: CreateAccountRequest,
  options: CreateAccountOptions
): Promise<CreateAccountResponse> {
  const accountType = data.type.trim();
  if (!accountType) {
    throw new Error('INVALID_ACCOUNT: type is required');
  }

  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  let providerPayout: ProviderPayout;
  try {
    providerPayout = await buildProviderPayout(options.palremitLiquidityRequest, data);
  } catch (e) {
    if (e instanceof Error) {
      if (e.message === 'PALREMIT_CORRIDOR_UNSUPPORTED') {
        throw new Error('INVALID_ACCOUNT: payout corridor not supported');
      }
      if (
        e.message === 'PALREMIT_CORRIDORS_UNAVAILABLE' ||
        e.message === 'PALREMIT_CORRIDOR_INVALID_RESPONSE'
      ) {
        throw new Error('PALREMIT_CORRIDORS_UNAVAILABLE');
      }
      if (e.message.startsWith('INVALID_ACCOUNT:')) throw e;
    }
    throw e;
  }

  const currency = providerPayout.corridor.asset.trim().toLowerCase();
  const paymentRail = providerPayout.corridor.destinationType.toLowerCase();
  const railCurrency = providerPayout.corridor.asset.trim().toUpperCase();

  const railStatuses = await kybRepo.getKybRailStatuses(userId, [railCurrency]);
  const railApproved = railStatuses.some((r) => r.status === 'approved');
  const userApproved = user.kybStatus === 'approved';
  if (!userApproved && !railApproved) {
    throw new Error('USER_NOT_KYB_VERIFIED');
  }

  const account = await accountRepo.createAccount({
    userId,
    railType: data.rail,
    currency,
    paymentRail,
    accountType,
    accountHolder: data.accountHolder as object,
    providerPayout: providerPayout as object,
  });

  return {
    status: 'ACTIVE',
    message: 'Account created successfully',
    id: account.id,
  };
}
