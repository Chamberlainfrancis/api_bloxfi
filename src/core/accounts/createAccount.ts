/**
 * Core: create offramp payout bank account via Palremit corridor + destination. Spec §3.1.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  buildValidatedProviderPayout,
  rethrowPalremitCorridorError,
} from '@/core/accounts/providerPayoutBuild';
import type {
  CreateAccountRequest,
  CreateAccountResponse,
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

  let providerPayout;
  try {
    providerPayout = await buildValidatedProviderPayout(
      options.palremitLiquidityRequest,
      data.corridor,
      data.destination
    );
  } catch (e) {
    rethrowPalremitCorridorError(e);
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
