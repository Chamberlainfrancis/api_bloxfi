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
import { buildAccountCapabilities } from '@/core/accounts/accountCapabilities';
import { issueGraphNamedDepositAccount } from '@/core/accounts/graphAccountIssuance';
import { isSwipeluxBeneficiaryKycImportEnabled } from '@/core/beneficiaries/flag';
import {
  copyRemoteDocumentToS3,
  RemoteDocumentError,
} from '@/core/files/copyRemoteDocument';
import {
  assertGraphUsdAccountCreatePayload,
  isUsAddressCountry,
  sanitizeGraphPersonName,
} from '@/core/integrations/graphOnrampKyc';
import { isGraphUsdBusiness } from '@/core/integrations/palremitOnramp';
import type { importSwipeluxBeneficiaryKyc } from '@/core/integrations/palremitSwipeluxKycImport';
import type {
  findAccountByCreationRequestId,
  updateAccountKycImport,
  updateAccountProviderIssuance,
} from '@/db/repositories/account.repo';
import { accountCreationPayloadsMatch } from '@/db/repositories/accountCreationPayload';
import { logger } from '@/lib/logger';
import { CreateAccountConflictError } from '@/types/createAccountConflict';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';
import type {
  AccountDepositDetails,
  AccountHolder,
  AccountMetadata,
  CreateAccountRequest,
  CreateAccountResponse,
  ProviderIssuanceStatus,
  RailType,
} from '@/types/account';

/** Loggable create-account body: never include sumsubShareToken. */
function redactCreateAccountPayload(data: CreateAccountRequest): Record<string, unknown> {
  const { sumsubShareToken: _omit, ...rest } = data;
  return {
    ...rest,
    ...(data.sumsubShareToken != null ? { sumsubShareToken: '[redacted]' } : {}),
  };
}

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

/** Strip Graph-rejected punctuation from person name fields before persist / KYC. */
function sanitizeOnrampAccountHolderNames(holder: AccountHolder): AccountHolder {
  const next: AccountHolder = { ...holder };
  if (typeof next.name === 'string') next.name = sanitizeGraphPersonName(next.name);
  if (typeof next.firstName === 'string') next.firstName = sanitizeGraphPersonName(next.firstName);
  if (typeof next.lastName === 'string') next.lastName = sanitizeGraphPersonName(next.lastName);
  if (typeof next.middleName === 'string') {
    const mid = sanitizeGraphPersonName(next.middleName);
    next.middleName = mid || undefined;
  }
  return next;
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
    | 'capabilities'
  >
> {
  const depositDetails = (row.depositDetails as AccountDepositDetails | null) ?? null;
  const capabilities = buildAccountCapabilities({
    graphUsdEligible: true,
    railType: 'onramp',
    providerIssuanceStatus: row.providerIssuanceStatus,
    depositDetails,
    providerIssuanceFailureReason: row.providerIssuanceFailureReason,
  });
  if (row.providerIssuanceStatus == null) {
    return { ...(capabilities ? { capabilities } : {}) };
  }
  return {
    providerIssuanceStatus: row.providerIssuanceStatus as ProviderIssuanceStatus,
    provisionedAccountId: row.provisionedAccountId ?? null,
    depositDetails,
    providerIssuanceFailureReason: row.providerIssuanceFailureReason ?? null,
    ...(capabilities ? { capabilities } : {}),
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
  logger.info(
    {
      userId,
      requestId: options.requestId,
      payload: redactCreateAccountPayload(data),
    },
    'createAccount request payload'
  );

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
    const addressCountry = data.accountHolder.address?.country;
    if (
      (kycImportEnabled || isUsAddressCountry(addressCountry)) &&
      !data.accountHolder.taxId?.trim()
    ) {
      throw new Error(
        kycImportEnabled
          ? 'INVALID_ACCOUNT: taxId is required when beneficiary KYC import is enabled'
          : 'INVALID_ACCOUNT: taxId is required for US address (SSN/ITIN)'
      );
    }

    // Fail closed before persist when Graph KYC is incomplete / payload invalid.
    if (useGraph) {
      assertGraphUsdAccountCreatePayload({
        accountHolder: data.accountHolder,
        sofQuestionnaire: data.sofQuestionnaire,
        documents: data.metadata?.documents,
      });
    }

    // Graph (and similar providers) reject punctuation in person names — sanitize once
    // so persist, idempotency fingerprints, and KYC all see the same values.
    const accountHolder = sanitizeOnrampAccountHolderNames(data.accountHolder);
    const onrampData = { ...data, accountHolder };

    const existing = await accountRepo.findByCreationRequestId(options.requestId);
    if (existing) {
      // creationRequestId is globally unique (not scoped by userId) — a bare hit is not proof
      // this row belongs to this caller. Mirror user.repo.ts's createUser/userCreationPayloadsMatch:
      // corroborate userId + identity before replaying, else throw a distinct conflict error.
      if (!accountCreationPayloadsMatch(existing, userId, onrampData)) {
        throw new CreateAccountConflictError(
          'REQUEST_ID_MISMATCH',
          'requestId was already used to create an onramp account with different data'
        );
      }
      return {
        status: 'ACTIVE',
        message: 'Account already exists',
        id: existing.id,
        ...(useGraph ? issuanceResponseFields(existing) : {}),
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
        accountHolder: accountHolder as object,
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
      if (!accountCreationPayloadsMatch(raced, userId, onrampData)) {
        throw new CreateAccountConflictError(
          'REQUEST_ID_MISMATCH',
          'requestId was already used to create an onramp account with different data'
        );
      }
      return {
        status: 'ACTIVE',
        message: 'Account already exists',
        id: raced.id,
        ...(useGraph ? issuanceResponseFields(raced) : {}),
      };
    }

    schedulePartnerWebhook('account.created', {
      accountId: created.id,
      userId,
      rail: 'onramp',
      type: data.type,
    });

    if (useGraph) {
      const issued = await issueGraphNamedDepositAccount(options.palremitLiquidityRequest, {
        id: created.id,
        userId,
        accountHolder,
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
        email: accountHolder.email!,
        first_name: accountHolder.firstName!,
        last_name: accountHolder.lastName!,
        phone: accountHolder.phone!,
        tax_id: accountHolder.taxId,
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

  schedulePartnerWebhook('account.created', {
    accountId: account.id,
    userId,
    rail: 'offramp',
    type: account.accountType,
  });

  return {
    status: 'ACTIVE',
    message: 'Account created successfully',
    id: account.id,
  };
}
