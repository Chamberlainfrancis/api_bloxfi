/**
 * Core: create fiat account. Offramp: payout bank account via Palremit corridor + destination
 * (Spec §3.1). Onramp: store account; Graph named-VA issuance when eligible; optionally
 * SwipeLux KYC import when `swipeluxBeneficiaryKycImport` is enabled (non-Graph).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  buildValidatedProviderPayout,
  rethrowPalremitCorridorError,
} from '@/core/accounts/providerPayoutBuild';
import { issueGraphNamedDepositAccount } from '@/core/accounts/graphAccountIssuance';
import { isSwipeluxBeneficiaryKycImportEnabled } from '@/core/beneficiaries/flag';
import {
  copyRemoteDocumentToS3,
  RemoteDocumentError,
} from '@/core/files/copyRemoteDocument';
import { assertGraphUsdAccountCreatePayload } from '@/core/integrations/graphOnrampKyc';
import { isGraphUsdBusiness } from '@/core/integrations/palremitOnramp';
import type { importSwipeluxBeneficiaryKyc } from '@/core/integrations/palremitSwipeluxKycImport';
import type {
  findAccountByCreationRequestId,
  updateAccountKycImport,
  updateAccountProviderIssuance,
} from '@/db/repositories/account.repo';
import { accountCreationPayloadsMatch } from '@/db/repositories/accountCreationPayload';
import { CreateAccountConflictError } from '@/types/createAccountConflict';
import type {
  AccountDepositDetails,
  AccountMetadata,
  CreateAccountRequest,
  CreateAccountResponse,
  ProviderIssuanceStatus,
  RailType,
} from '@/types/account';

// Mirrors user.repo.ts's isPrismaUniqueError — kept local (not imported) since account.repo.ts's
// createAccount is called here through an injected interface, not raw Prisma.
function isPrismaUniqueError(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e && (e as { code: string }).code === 'P2002';
}

function resolveSourceOfFundsDocumentUrl(data: CreateAccountRequest): string {
  const fromTop = data.sourceOfFundsDocument?.trim();
  if (fromTop) return fromTop;
  const nested = data.sofQuestionnaire?.sourceOfFundsDocument;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  throw new Error('INVALID_ACCOUNT: sourceOfFundsDocument URL is required');
}

function issuanceResponseFields(row: {
  providerIssuanceStatus?: string | null;
  provisionedAccountId?: string | null;
  depositDetails?: unknown;
  providerIssuanceFailureReason?: string | null;
}): Partial<
  Pick<
    CreateAccountResponse,
    | 'providerIssuanceStatus'
    | 'provisionedAccountId'
    | 'depositDetails'
    | 'providerIssuanceFailureReason'
  >
> {
  if (row.providerIssuanceStatus == null) return {};
  return {
    providerIssuanceStatus: row.providerIssuanceStatus as ProviderIssuanceStatus,
    provisionedAccountId: row.provisionedAccountId ?? null,
    depositDetails: (row.depositDetails as AccountDepositDetails | null) ?? null,
    providerIssuanceFailureReason: row.providerIssuanceFailureReason ?? null,
  };
}

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
    sofQuestionnaire?: object | null;
    sourceOfFundsDocumentPath?: string | null;
    metadata?: object | null;
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
    sofQuestionnaire?: unknown;
    sourceOfFundsDocumentPath?: string | null;
    metadata?: unknown;
    providerIssuanceStatus?: string | null;
    provisionedAccountId?: string | null;
    depositDetails?: unknown;
    providerIssuanceFailureReason?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  updateProviderIssuance: typeof updateAccountProviderIssuance;
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
  /** Injectable for tests; defaults to copyRemoteDocumentToS3. */
  copySourceOfFundsDocument?: typeof copyRemoteDocumentToS3;
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
    const useGraph =
      data.type.trim().toLowerCase() === 'usd' && isGraphUsdBusiness(userId, user.metadata);
    const kycImportEnabled =
      !useGraph && isSwipeluxBeneficiaryKycImportEnabled(user.metadata);
    if (kycImportEnabled && !data.accountHolder.taxId?.trim()) {
      throw new Error('INVALID_ACCOUNT: taxId is required when beneficiary KYC import is enabled');
    }

    // Fail closed before persist when Graph KYC is incomplete / payload invalid.
    if (useGraph) {
      assertGraphUsdAccountCreatePayload({
        accountHolder: data.accountHolder,
        sofQuestionnaire: data.sofQuestionnaire,
        documents: data.metadata?.documents,
      });
    }

    const existing = await accountRepo.findByCreationRequestId(options.requestId);
    if (existing) {
      // creationRequestId is globally unique (not scoped by userId) — a bare hit is not proof
      // this row belongs to this caller. Mirror user.repo.ts's createUser/userCreationPayloadsMatch:
      // corroborate userId + identity before replaying, else throw a distinct conflict error.
      if (!accountCreationPayloadsMatch(existing, userId, data)) {
        throw new CreateAccountConflictError(
          'REQUEST_ID_MISMATCH',
          'requestId was already used to create an onramp account with different data'
        );
      }
      return {
        status: 'ACTIVE',
        message: 'Account already exists',
        id: existing.id,
        ...issuanceResponseFields(existing),
      };
    }

    const documentUrl = resolveSourceOfFundsDocumentUrl(data);
    const copyDoc = options.copySourceOfFundsDocument ?? copyRemoteDocumentToS3;
    let stored;
    try {
      stored = await copyDoc(documentUrl);
    } catch (e) {
      if (e instanceof RemoteDocumentError) {
        throw new Error(`INVALID_ACCOUNT: ${e.message}`);
      }
      throw e;
    }

    let created;
    try {
      created = await accountRepo.createAccount({
        userId,
        railType: 'onramp',
        currency: null,
        paymentRail: null,
        accountType: data.type,
        accountHolder: data.accountHolder as object,
        providerPayout: null,
        swipeluxCustomerId: null,
        kycImportStatus: kycImportEnabled ? 'pending_import' : null,
        creationRequestId: options.requestId,
        sofQuestionnaire: (data.sofQuestionnaire ?? null) as object | null,
        sourceOfFundsDocumentPath: stored.storagePath,
        metadata: (data.metadata ?? null) as object | null,
      });
    } catch (e) {
      if (!isPrismaUniqueError(e)) throw e;
      // Concurrent double-submit on the same creationRequestId: the other request won the
      // unique-constraint race. Mirror user.repo.ts's createUser — collapse the P2002 into a
      // lookup-and-return instead of propagating the uncaught DB error.
      const raced = await accountRepo.findByCreationRequestId(options.requestId);
      if (!raced) throw e;
      if (!accountCreationPayloadsMatch(raced, userId, data)) {
        throw new CreateAccountConflictError(
          'REQUEST_ID_MISMATCH',
          'requestId was already used to create an onramp account with different data'
        );
      }
      return {
        status: 'ACTIVE',
        message: 'Account already exists',
        id: raced.id,
        ...issuanceResponseFields(raced),
      };
    }

    if (useGraph) {
      const issued = await issueGraphNamedDepositAccount(options.palremitLiquidityRequest, {
        id: created.id,
        userId,
        accountHolder: data.accountHolder,
        sofQuestionnaire: data.sofQuestionnaire,
        metadata: data.metadata as AccountMetadata | undefined,
      });
      const updated = await accountRepo.updateProviderIssuance(created.id, {
        providerIssuanceStatus: issued.providerIssuanceStatus,
        provisionedAccountId: issued.provisionedAccountId,
        depositDetails: issued.depositDetails,
        providerIssuanceFailureReason: issued.providerIssuanceFailureReason,
      });
      return {
        status: 'ACTIVE',
        message: 'Account created successfully',
        id: created.id,
        ...issuanceResponseFields(updated),
      };
    }

    // Flag off: persist account only — no Sumsub share-token / SwipeLux KYC.
    if (!kycImportEnabled) {
      return { status: 'ACTIVE', message: 'Account created successfully', id: created.id };
    }

    // firstName/lastName are required by the Task 7 zod schema whenever rail='onramp' — never
    // derived by splitting accountHolder.name (unreliable for compound surnames).
    const shareToken = data.sumsubShareToken?.trim();
    const imported = await options.importKyc(options.palremitLiquidityRequest, {
      clientReference: created.id,
      ...(shareToken ? { importToken: shareToken } : {}), // never persisted — passed straight through when present
      kycInput: {
        customer_type: 'individual',
        email: data.accountHolder.email!,
        first_name: data.accountHolder.firstName!,
        last_name: data.accountHolder.lastName!,
        phone: data.accountHolder.phone!,
        tax_id: data.accountHolder.taxId,
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

    const liquidityStatus = imported.value.status.toLowerCase();
    const kycImportStatus =
      liquidityStatus === 'approved'
        ? 'approved'
        : liquidityStatus === 'rejected'
          ? 'rejected'
          : 'pending_import';

    await accountRepo.updateKycImport(created.id, {
      kycImportStatus,
      swipeluxCustomerId: imported.value.channel_customer_id,
    });
    return {
      status: 'ACTIVE',
      message: 'Account created successfully',
      id: created.id,
      ...(imported.value.verification_url
        ? { verificationUrl: imported.value.verification_url }
        : {}),
    };
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
