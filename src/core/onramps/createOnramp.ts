/**
 * Core: create onramp. Validate user, account, wallet; compute quote (Currency API + fees); persist; return transferDetails.
 * Spec §4.2 POST /onramps. Rates from Currency API; LP used only for liquidity (e.g. depositInfo when configured).
 */

import type { LpHttpClient } from '../integrations/types';
import { applyOnrampFee } from '../payments';
import { createOnrampAtLp } from '../integrations/onrampLp';
import type {
  CreateOnrampRequest,
  CreateOnrampResponse,
  GetOnrampRatesResponse,
  OnrampStatus,
  OnrampSource,
  OnrampDestination,
  QuoteInformation,
  DepositInfo,
  DeveloperFeeAmount,
  OnrampTransferDetails,
} from '../../types/onramp';

const QUOTE_EXPIRY_MINUTES = 30;

export interface CreateOnrampOptions {
  /** Fetches rate from Currency API. Used as sole rate source for quote (RAMP_ARCHITECTURE). */
  getRateFromCurrencyApi?: (from: string, to: string) => Promise<GetOnrampRatesResponse | null>;
}

export interface OnrampRepoCreate {
  createOnramp(data: {
    requestId: string;
    userId: string;
    status: OnrampStatus;
    source: object;
    destination: object;
    quoteInformation: object;
    depositInfo?: object | null;
    receipt?: object | null;
    developerFee?: object | null;
    failedReason?: string | null;
  }): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    quoteInformation: unknown;
    depositInfo: unknown;
    receipt: unknown;
    developerFee: unknown;
    failedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForOnramp {
  findUserById(id: string): Promise<{
    id: string;
    businessInfo: unknown;
  } | null>;
}

export interface AccountRepoForOnramp {
  findAccountByIdAndUser(accountId: string, userId: string): Promise<{
    id: string;
    userId: string;
    accountHolder: unknown;
    regionDetails: unknown;
    paymentRail: string;
    accountType: string;
  } | null>;
}

export interface WalletRepoForOnramp {
  findExternalWalletByIdAndUser(
    walletId: string,
    userId: string
  ): Promise<{
    id: string;
    address: string;
    chain: string;
    userId: string;
  } | null>;
}

export interface KybRepoForOnramp {
  getKybRailStatuses(userId: string, rails?: string[]): Promise<
    Array<{ rail: string; status: string }>
  >;
}

function userDisplay(user: { businessInfo?: unknown } | null): { email: string; businessName?: string } {
  if (!user?.businessInfo || typeof user.businessInfo !== 'object') {
    return { email: '', businessName: undefined };
  }
  const info = user.businessInfo as Record<string, unknown>;
  return {
    email: (info.email as string) ?? '',
    businessName: (info.legalName as string) ?? (info.tradingName as string),
  };
}

/**
 * Build deposit info (where the user sends fiat). When LP does not return depositInfo,
 * we build a minimal placeholder. Platform-specific bank details can be injected by the API layer if needed.
 */
function buildDepositInfoPlaceholder(
  beneficiaryName: string,
  reference: string,
  depositBy: string
): DepositInfo {
  return {
    bankName: 'Platform',
    beneficiary: { name: beneficiaryName, address: '' },
    reference,
    depositBy,
    instruction: `Include reference code ${reference} in payment description`,
  };
}

export async function createOnramp(
  onrampRepo: OnrampRepoCreate,
  userRepo: UserRepoForOnramp,
  accountRepo: AccountRepoForOnramp,
  walletRepo: WalletRepoForOnramp,
  kybRepo: KybRepoForOnramp,
  lpClient: LpHttpClient | null,
  requestId: string,
  body: Omit<CreateOnrampRequest, 'requestId'>,
  options?: CreateOnrampOptions
): Promise<CreateOnrampResponse> {
  const { source: src, destination: dest, fee } = body;
  const userId = src.userId;
  if (dest.userId !== userId) {
    throw new Error('SOURCE_DESTINATION_USER_MISMATCH');
  }

  const user = await userRepo.findUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  const railCurrency = (src.currency ?? 'USD').toUpperCase();
  const railStatuses = await kybRepo.getKybRailStatuses(userId, [railCurrency]);
  const approved = railStatuses.some((r) => r.status === 'approved');
  if (!approved) throw new Error('USER_NOT_KYB_VERIFIED');

  const account = await accountRepo.findAccountByIdAndUser(src.accountId, userId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');

  const wallet = await walletRepo.findExternalWalletByIdAndUser(dest.externalWalletId, userId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');

  const fromCurrency = src.currency.trim().toLowerCase();
  const toCurrency = dest.currency.trim().toLowerCase();
  let conversionRate = '1.00';
  if (options?.getRateFromCurrencyApi) {
    const currencyApiRates = await options.getRateFromCurrencyApi(fromCurrency, toCurrency);
    if (currencyApiRates?.conversionRate) conversionRate = currencyApiRates.conversionRate;
  }

  const grossFiat = src.amount;
  const rateNum = parseFloat(conversionRate) || 1;
  const receiveGross = grossFiat * rateNum;
  const { feeAmount: developerFeeAmount, netAmount: receiveNet } = applyOnrampFee(receiveGross, fee);

  const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000);
  const sendGross = { amount: grossFiat.toFixed(2), currency: fromCurrency };
  const sendNet = sendGross;
  const railFee = { amount: '0.00', currency: fromCurrency };
  const receiveGrossStr = { amount: receiveGross.toFixed(2), currency: toCurrency };
  const receiveNetStr = { amount: receiveNet.toFixed(2), currency: toCurrency };
  const quoteInformation: QuoteInformation = {
    sendGross,
    sendNet,
    railFee,
    receiveGross: receiveGrossStr,
    receiveNet: receiveNetStr,
    rate: conversionRate,
    expiresAt: expiresAt.toISOString(),
  };

  const developerFee: DeveloperFeeAmount = {
    amount: developerFeeAmount.toFixed(2),
    currency: toCurrency,
  };

  const userDisplayInfo = userDisplay(user);
  const sourcePayload: OnrampSource = {
    userId,
    currency: fromCurrency,
    amount: grossFiat,
    accountId: account.id,
    transferType: src.transferType ?? account.paymentRail,
    user: userDisplayInfo,
  };
  const destinationPayload: OnrampDestination = {
    userId,
    currency: toCurrency,
    chain: dest.chain,
    walletAddress: wallet.address,
    externalWalletId: dest.externalWalletId,
    amount: receiveNet,
    user: userDisplayInfo,
  };

  const reference = `ONR-${requestId.slice(0, 8).toUpperCase()}`;
  const depositBy = expiresAt.toISOString();
  const beneficiaryName = (account.accountHolder as { name?: string })?.name ?? 'Account Holder';
  let depositInfo: DepositInfo = buildDepositInfoPlaceholder(beneficiaryName, reference, depositBy);

  // Optionally create at LP and use LP depositInfo if returned
  if (lpClient) {
    const lpPayload: CreateOnrampRequest = { ...body, requestId };
    const lpResponse = await createOnrampAtLp(lpClient, lpPayload);
    if (lpResponse?.transferDetails?.depositInfo) {
      depositInfo = lpResponse.transferDetails.depositInfo;
    }
  }

  const row = await onrampRepo.createOnramp({
    requestId,
    userId,
    status: 'CREATED',
    source: sourcePayload,
    destination: destinationPayload,
    quoteInformation,
    depositInfo,
    receipt: null,
    developerFee,
    failedReason: null,
  });

  const transferDetails: OnrampTransferDetails = {
    id: row.id,
    requestId: row.requestId,
    status: row.status as OnrampStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OnrampSource,
    destination: row.destination as OnrampDestination,
    quoteInformation: row.quoteInformation as QuoteInformation,
    depositInfo: (row.depositInfo as DepositInfo) ?? null,
    receipt: row.receipt ? (row.receipt as { transactionHash: string }) : null,
    developerFee: (row.developerFee as DeveloperFeeAmount) ?? null,
    failedReason: row.failedReason ?? null,
  };

  return {
    transferType: 'ONRAMP',
    transferDetails,
  };
}
