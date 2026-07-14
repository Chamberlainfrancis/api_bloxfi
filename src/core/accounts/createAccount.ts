/**
 * Core: create fiat account. Offramp: payout bank account via Palremit corridor + destination
 * (Spec §3.1). Onramp: SwipeLux beneficiary via Sumsub share-token KYC import (flag-gated).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  buildValidatedProviderPayout,
  rethrowPalremitCorridorError,
} from '@/core/accounts/providerPayoutBuild';
import { isSwipeluxBeneficiaryKycImportEnabled } from '@/core/beneficiaries/flag';
import type { importSwipeluxBeneficiaryKyc } from '@/core/integrations/palremitSwipeluxKycImport';
import type { findAccountByCreationRequestId, updateAccountKycImport } from '@/db/repositories/account.repo';
import type {
  CreateAccountRequest,
  CreateAccountResponse,
  RailType,
} from '@/types/account';

export interface AccountRepoCreate {
  createAccount(data: {
    userId: string;
    railType: RailType;
    currency?: string | null;
    paymentRail?: string | null;
    accountType: string;
    accountHolder: object;
    providerPayout?: object | null;
    swipeluxCustomerId?: string | null;
    kycImportStatus?: string | null;
    creationRequestId?: string | null;
  }): Promise<{
    id: string;
    userId: string;
    railType: string;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: unknown;
    providerPayout: unknown;
    swipeluxCustomerId: string | null;
    kycImportStatus: string | null;
    creationRequestId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForAccount {
  // widened return type — was { id: string; kybStatus: string } — metadata is a harmless
  // additive field on the same already-fetched row, no second query needed.
  findUserById(id: string): Promise<{ id: string; kybStatus: string; metadata: unknown } | null>;
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
  accountRepo: AccountRepoCreate & {
    findByCreationRequestId: typeof findAccountByCreationRequestId;
    updateKycImport: typeof updateAccountKycImport;
  },
  userRepo: UserRepoForAccount,
  kybRepo: KybRepoForAccount,
  userId: string,
  data: CreateAccountRequest,
  options: CreateAccountOptions & { requestId: string; importKyc: typeof importSwipeluxBeneficiaryKyc }
): Promise<CreateAccountResponse> {
  const user = await userRepo.findUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  if (data.rail === 'onramp') {
    if (data.accountHolder.type !== 'individual') {
      throw new Error('INVALID_ACCOUNT: onramp accounts support customer_type individual only in v1');
    }
    if (!isSwipeluxBeneficiaryKycImportEnabled(user.metadata)) {
      throw new Error('SWIPELUX_BENEFICIARY_KYC_IMPORT_DISABLED'); // controller maps to 403 — see Task 7
    }

    const existing = await accountRepo.findByCreationRequestId(options.requestId);
    if (existing) return { status: 'ACTIVE', message: 'Account already exists', id: existing.id }; // soft replay, no re-import

    const created = await accountRepo.createAccount({
      userId,
      railType: 'onramp',
      currency: null,
      paymentRail: null,
      accountType: data.type,
      accountHolder: data.accountHolder as object,
      providerPayout: null,
      swipeluxCustomerId: null,
      kycImportStatus: 'pending_import',
      creationRequestId: options.requestId,
    });

    // firstName/lastName are required by the Task 7 zod schema whenever rail='onramp' — never
    // derived by splitting accountHolder.name (unreliable for compound surnames).
    const imported = await options.importKyc(options.palremitLiquidityRequest, {
      clientReference: created.id,
      importToken: data.sumsubShareToken!, // never persisted — passed straight through
      kycInput: {
        customer_type: 'individual',
        email: data.accountHolder.email!,
        first_name: data.accountHolder.firstName!,
        last_name: data.accountHolder.lastName!,
        phone: data.accountHolder.phone!,
      },
    });

    if (!imported.ok) {
      await accountRepo.updateKycImport(created.id, { kycImportStatus: 'failed' });
      // Preserve retryable-vs-permanent through to the controller (Task 7) — do NOT collapse
      // this into one generic error string, or the controller has nothing to map 422 vs 502 from.
      throw new Error(
        imported.status >= 500
          ? 'PALREMIT_SWIPELUX_KYC_IMPORT_TRANSIENT' // controller maps to 502
          : 'PALREMIT_SWIPELUX_KYC_IMPORT_PERMANENT', // controller maps to 422
      );
    }
    await accountRepo.updateKycImport(created.id, {
      kycImportStatus: imported.value.status,
      swipeluxCustomerId: imported.value.channel_customer_id,
    });
    return { status: 'ACTIVE', message: 'Account created successfully', id: created.id };
  }

  // --- existing offramp logic below, unchanged ---
  const accountType = data.type.trim();
  if (!accountType) {
    throw new Error('INVALID_ACCOUNT: type is required');
  }

  // corridor/destination are optional on CreateAccountRequest to accommodate the onramp path
  // (Task 6); this function is still offramp-only below this point, so both remain required here.
  if (!data.corridor || !data.destination) {
    throw new Error('INVALID_ACCOUNT: corridor and destination are required');
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
