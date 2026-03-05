/**
 * Core: create fiat account. Validates user and KYB for rail. Spec §3.1.
 */

import type {
  CreateAccountRequest,
  CreateAccountResponse,
  AccountRegionType,
  RegionAccountDetails,
  RailType,
} from '../../types/account';

export interface AccountRepoCreate {
  createAccount(data: {
    userId: string;
    railType: RailType;
    currency: string;
    paymentRail: string;
    accountType: AccountRegionType;
    accountHolder: object;
    regionDetails: object;
  }): Promise<{
    id: string;
    userId: string;
    railType: string;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: unknown;
    regionDetails: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForAccount {
  findUserById(id: string): Promise<{ id: string; kybStatus: string } | null>;
}

export interface KybRepoForAccount {
  getKybRailStatuses(userId: string, railsFilter?: string[]): Promise<
    Array<{ rail: string; status: string; capabilities: string[] }>
  >;
}

function getRegionDetails(req: CreateAccountRequest): RegionAccountDetails | null {
  const key = req.type;
  const payload = key ? (req as unknown as Record<string, RegionAccountDetails | null | undefined>)[key] : undefined;
  return (payload && typeof payload === 'object' && 'currency' in payload ? payload : null) as RegionAccountDetails | null;
}

function getPaymentRail(type: AccountRegionType, details: RegionAccountDetails | null): string {
  if (!details) return 'unknown';
  if (details.transferType) return String(details.transferType).toLowerCase();
  const defaults: Partial<Record<AccountRegionType, string>> = {
    brazil: 'pix',
    us: 'ach',
    mexico: 'spei',
    colombia: 'ach',
    argentina: 'ach',
    africa: 'ach',
    nigeria: 'bank_transfer',
    ghana: 'bank_transfer',
    kenya: 'bank_transfer',
    south_africa: 'ach',
    zimbabwe: 'bank_transfer',
    rwanda: 'bank_transfer',
    senegal: 'bank_transfer',
  };
  return defaults[type] ?? 'unknown';
}

/** Map to currency rail for KYB (e.g. USD, BRL, COP, ARS, MXN). */
function getCurrencyRail(currency: string): string {
  const upper = currency?.trim().toUpperCase() ?? '';
  return upper || 'USD';
}

export async function createAccount(
  accountRepo: AccountRepoCreate,
  userRepo: UserRepoForAccount,
  kybRepo: KybRepoForAccount,
  userId: string,
  data: CreateAccountRequest
): Promise<CreateAccountResponse> {
  const regionDetails = getRegionDetails(data);
  if (!regionDetails?.currency) {
    throw new Error('INVALID_ACCOUNT: region details and currency are required');
  }

  const paymentRail = getPaymentRail(data.type, regionDetails);
  const currency = regionDetails.currency.trim().toLowerCase();
  const railCurrency = getCurrencyRail(regionDetails.currency);

  const user = await userRepo.findUserById(userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

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
    accountType: data.type,
    accountHolder: data.accountHolder as object,
    regionDetails: regionDetails as object,
  });

  return {
    status: 'ACTIVE',
    message: 'Account created successfully',
    id: account.id,
  };
}
