/**
 * Core: create onramp. Fiat-deposit-first flow:
 * create intent + deposit instructions, then execute crypto withdrawal after fiat is credited.
 */

import { applyOnrampFee } from '@/core/payments';
import { generateOnrampTxnRef } from '@/utils/txnRef';
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
  Receipt,
} from '@/types/onramp';

const QUOTE_EXPIRY_MINUTES = 30;

export interface CreateOnrampOptions {
  getQuoteFromPalremit?: (
    from: string,
    to: string,
    amount: number
  ) => Promise<{ conversionRate: string; conversion: number } | null>;
  /**
   * Resolve `destination.chain` to a Palremit `network_code` from GET /v1/coins/get_coin_network_list (fallback get_coin).
   * Must throw or return canonical code; invalid chain should fail ramp creation.
   */
  resolvePalremitNetwork: (
    coinCode: string,
    chainFromClient: string,
    field: 'destination.chain'
  ) => Promise<string>;
  /** Palremit `POST /v1/provisioned-accounts` (fiat) → BloxFi deposit instructions. */
  createPalremitFiatDeposit: (params: {
    firstName: string;
    lastName: string;
    email: string;
    currency: string;
    amount: number;
    bloxRequestId: string;
    depositByIso: string;
    txnRef: string;
  }) => Promise<{ depositInfo: DepositInfo; providerRefs: Record<string, unknown> } | null>;
}

export interface OnrampRepoCreate {
  createOnramp(data: {
    requestId: string;
    txnRef: string;
    providerRefs?: object | null;
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
    txnRef: string | null;
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
    legalRepresentative: unknown;
  } | null>;
}

export interface WalletRepoForOnramp {
  findExternalWalletByIdAndUser(
    walletId: string,
    userId: string
  ): Promise<{
    id: string;
    address: string;
    memo: string | null;
    chain: string;
    userId: string;
  } | null>;
}

export interface KybRepoForOnramp {
  getKybRailStatuses(userId: string, rails?: string[]): Promise<
    Array<{ rail: string; status: string }>
  >;
}

function asObjectRecord(x: unknown): Record<string, unknown> | null {
  if (x != null && typeof x === 'object' && !Array.isArray(x)) {
    return x as Record<string, unknown>;
  }
  return null;
}

/** Names for Palremit fiat deposit API (first_name / last_name) when no legal rep person fields exist. */
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

/**
 * BloxFi business users store the natural person on `legalRepresentative` (firstName, lastName, email).
 * Palremit KYC + deposit beneficiary should use that; fall back to businessInfo-derived names / business email.
 */
function resolveOnrampUserIdentity(user: {
  businessInfo?: unknown;
  legalRepresentative?: unknown;
}): { firstName: string; lastName: string; email: string } {
  const businessInfo = asObjectRecord(user.businessInfo) ?? {};
  const lr = asObjectRecord(user.legalRepresentative);

  const lrFn = typeof lr?.firstName === 'string' ? lr.firstName.trim() : '';
  const lrLn = typeof lr?.lastName === 'string' ? lr.lastName.trim() : '';
  const lrEmail = typeof lr?.email === 'string' ? lr.email.trim() : '';

  let firstName: string;
  let lastName: string;
  if (lrFn && lrLn) {
    firstName = lrFn;
    lastName = lrLn;
  } else if (lrFn) {
    firstName = lrFn;
    lastName = lrFn;
  } else {
    const n = namesForPalremitFiatDeposit(businessInfo);
    firstName = n.first;
    lastName = n.last;
  }

  const bizEmail = typeof businessInfo.email === 'string' ? businessInfo.email.trim() : '';
  const email = lrEmail || bizEmail;
  return { firstName, lastName, email };
}

function userDisplay(user: { businessInfo?: unknown; legalRepresentative?: unknown } | null): {
  email: string;
  businessName?: string;
  firstName: string;
  lastName: string;
} {
  const identity = resolveOnrampUserIdentity(user ?? {});
  const info = asObjectRecord(user?.businessInfo);
  const businessName =
    info != null
      ? ((info.legalName as string) ?? (info.tradingName as string))?.trim() || undefined
      : undefined;
  return {
    email: identity.email,
    businessName,
    firstName: identity.firstName,
    lastName: identity.lastName,
  };
}

export async function createOnramp(
  onrampRepo: OnrampRepoCreate,
  userRepo: UserRepoForOnramp,
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

  const wallet = await walletRepo.findExternalWalletByIdAndUser(dest.externalWalletId, userId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');

  const destinationNetwork = await options.resolvePalremitNetwork(
    dest.currency.trim().toUpperCase(),
    dest.chain,
    'destination.chain'
  );

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
    transferType: src.transferType,
    user: userDisplayInfo,
  };
  const destinationPayload: OnrampDestination = {
    userId,
    currency: toCurrency,
    chain: destinationNetwork,
    walletAddress: wallet.address,
    externalWalletId: dest.externalWalletId,
    amount: receiveNet,
    user: userDisplayInfo,
    ...(wallet.memo != null && wallet.memo.trim() !== ''
      ? { memo: wallet.memo.trim() }
      : {}),
  };

  const email = userDisplayInfo.email.trim();
  if (!email) {
    throw new Error('USER_EMAIL_REQUIRED_FOR_ONRAMP');
  }
  const { firstName, lastName } = resolveOnrampUserIdentity(user);

  const txnRef = generateOnrampTxnRef();

  const fiatResult = await options.createPalremitFiatDeposit({
    firstName,
    lastName,
    email,
    currency: fromCurrency,
    amount: grossFiat,
    bloxRequestId: requestId,
    depositByIso: expiresAt.toISOString(),
    txnRef,
  });
  if (!fiatResult) {
    throw new Error('PALREMIT_FIAT_DEPOSIT_FAILED');
  }

  const { depositInfo, providerRefs } = fiatResult;

  const row = await onrampRepo.createOnramp({
    requestId,
    txnRef,
    providerRefs,
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

  const ref = row.txnRef ?? txnRef;
  const transferDetails: OnrampTransferDetails = {
    id: row.id,
    requestId: row.requestId,
    txnRef: ref,
    clientReference: ref,
    status: row.status as OnrampStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OnrampSource,
    destination: row.destination as OnrampDestination,
    quoteInformation: row.quoteInformation as QuoteInformation,
    depositInfo: (row.depositInfo as DepositInfo) ?? null,
    receipt: row.receipt ? (row.receipt as Receipt) : null,
    developerFee: (row.developerFee as DeveloperFeeAmount) ?? null,
    failedReason: row.failedReason ?? null,
  };

  return {
    transferType: 'ONRAMP',
    transferDetails,
  };
}
