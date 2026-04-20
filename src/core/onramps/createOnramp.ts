/**
 * Core: create onramp. Fiat-deposit-first flow:
 * create intent + deposit instructions, then execute §6.2 crypto withdrawal after fiat is processed.
 */

import { applyOnrampFee } from '@/core/payments';
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
} from '@/types/onramp';

const QUOTE_EXPIRY_MINUTES = 30;

export interface CreateOnrampOptions {
  getQuoteFromPalremit?: (
    from: string,
    to: string,
    amount: number
  ) => Promise<{ conversionRate: string; conversion: number } | null>;
  /** Palremit `POST /deposits/create_fiat_deposit` → BloxFi deposit instructions. */
  createPalremitFiatDeposit: (params: {
    firstName: string;
    lastName: string;
    email: string;
    currency: string;
    amount: number;
    bloxRequestId: string;
    depositByIso: string;
  }) => Promise<DepositInfo | null>;
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
  findUserById(id: string): Promise<{ id: string; businessInfo: unknown } | null>;
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

function userDisplay(user: { businessInfo?: unknown } | null): {
  email: string;
  businessName?: string;
} {
  if (!user?.businessInfo || typeof user.businessInfo !== 'object') {
    return { email: '', businessName: undefined };
  }
  const info = user.businessInfo as Record<string, unknown>;
  return {
    email: (info.email as string) ?? '',
    businessName: (info.legalName as string) ?? (info.tradingName as string),
  };
}

/** Names for Palremit fiat deposit API (first_name / last_name). */
function namesForPalremitFiatDeposit(info: Record<string, unknown>): { first: string; last: string } {
  const fn = (info.firstName as string) ?? (info.first_name as string);
  const ln = (info.lastName as string) ?? (info.last_name as string);
  if (fn?.trim() && ln?.trim()) {
    return { first: fn.trim(), last: ln.trim() };
  }
  if (fn?.trim()) {
    return { first: fn.trim(), last: fn.trim() };
  }
  const legal =
    (info.legalName as string) ?? (info.tradingName as string) ?? (info.businessName as string) ?? '';
  const trimmed = legal.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) return { first: parts[0], last: parts[0] };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }
  return { first: 'Customer', last: 'User' };
}

export async function createOnramp(
  onrampRepo: OnrampRepoCreate,
  userRepo: UserRepoForOnramp,
  accountRepo: AccountRepoForOnramp,
  walletRepo: WalletRepoForOnramp,
  kybRepo: KybRepoForOnramp,
  requestId: string,
  body: Omit<CreateOnrampRequest, 'requestId'>,
  options: CreateOnrampOptions
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

  if (!options.getQuoteFromPalremit) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const quote = await options.getQuoteFromPalremit(fromCurrency, toCurrency, src.amount);
  if (!quote?.conversionRate || typeof quote.conversion !== 'number') {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const conversionRate = quote.conversionRate;

  const grossFiat = src.amount;
  const receiveGross = quote.conversion;
  const { feeAmount: developerFeeAmount, netAmount: receiveNet } = applyOnrampFee(receiveGross, fee);

  const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000);
  const sendGross = { amount: grossFiat.toFixed(2), currency: fromCurrency };
  const sendNet = sendGross;
  const railFee = { amount: '0.00', currency: fromCurrency };
  const receiveGrossStr = { amount: receiveGross.toFixed(8), currency: toCurrency };
  const receiveNetStr = { amount: receiveNet.toFixed(8), currency: toCurrency };
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
    amount: developerFeeAmount.toFixed(8),
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

  const businessInfo =
    user.businessInfo != null && typeof user.businessInfo === 'object' && !Array.isArray(user.businessInfo)
      ? (user.businessInfo as Record<string, unknown>)
      : {};
  const email = userDisplay(user).email.trim();
  if (!email) {
    throw new Error('USER_EMAIL_REQUIRED_FOR_ONRAMP');
  }
  const { first: firstName, last: lastName } = namesForPalremitFiatDeposit(businessInfo);

  const depositInfo = await options.createPalremitFiatDeposit({
    firstName,
    lastName,
    email,
    currency: fromCurrency,
    amount: grossFiat,
    bloxRequestId: requestId,
    depositByIso: expiresAt.toISOString(),
  });
  if (!depositInfo) {
    throw new Error('PALREMIT_FIAT_DEPOSIT_FAILED');
  }

  const row = await onrampRepo.createOnramp({
    requestId,
    userId,
    status: 'AWAITING_FUNDS',
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
