/**
 * Core: create offramp. Palremit crypto provision + fiat withdrawal after `deposit.credited` (see advanceOfframpPayout).
 */

import { maskPublicOfframpDestination } from '@/core/offramps/maskOfframpDestination';
import { isAccountReadyForOfframp } from '@/core/integrations/palremitOfframp';
import { generateOfframpTxnRef } from '@/utils/txnRef';
import type {
  CreateOfframpRequest,
  CreateOfframpResponse,
  OfframpStatus,
  OfframpSource,
  OfframpDestination,
  RateInformation,
  DepositInstructions,
  OfframpFees,
  OfframpTransferDetails,
} from '@/types/offramp';
import type { OfframpQuoteSnapshot } from '@/types/quote';
import { assertOfframpQuoteCorridorMatchesAccount } from '@/core/quotes/assertOfframpQuoteCorridor';

export interface CreateOfframpOptions {
  /**
   * Resolve `source.chain` to a Palremit `network_code` from GET /v1/coins/get_coin_network_list (fallback get_coin).
   */
  resolvePalremitNetwork: (
    coinCode: string,
    chainFromClient: string,
    field: 'source.chain'
  ) => Promise<string>;
  createPalremitDeposit: (
    userContext: {
      userId: string;
      businessInfo: unknown;
      legalRepresentative: unknown;
      email: string;
    },
    body: Omit<CreateOfframpRequest, 'requestId'>,
    requestId: string,
    depositBy: string,
    txnRef: string
  ) => Promise<{
    depositInstructions: DepositInstructions;
    correlationId: string;
    providerRefs: Record<string, unknown>;
  } | null>;
  /** Pricing is always taken from the locked quote (POST /offramps/quotes). */
  lockedQuote: OfframpQuoteSnapshot;
}

export interface OfframpRepoCreate {
  createOfframp(data: {
    requestId: string;
    txnRef: string;
    providerRefs?: object | null;
    userId: string;
    status: OfframpStatus;
    source: object;
    destination: object;
    rateInformation: object;
    depositInstructions?: object | null;
    timeline?: object | null;
    fees?: object | null;
    receipt?: object | null;
    refundDetails?: object | null;
    failedReason?: string | null;
    lpReference?: string | null;
  }): Promise<{
    id: string;
    requestId: string;
    txnRef: string | null;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    rateInformation: unknown;
    depositInstructions: unknown;
    timeline: unknown;
    fees: unknown;
    receipt: unknown;
    refundDetails: unknown;
    failedReason: string | null;
    lpReference: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForOfframp {
  findUserById(id: string): Promise<{
    id: string;
    businessInfo: unknown;
    legalRepresentative: unknown;
  } | null>;
}

export interface AccountRepoForOfframp {
  findOfframpAccountByIdAndUser(accountId: string, userId: string): Promise<{
    id: string;
    userId: string;
    currency: string;
    accountHolder: unknown;
    providerPayout: unknown;
    paymentRail: string;
    accountType: string;
  } | null>;
}

export interface WalletRepoForOfframp {
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

export interface KybRepoForOfframp {
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

export async function createOfframp(
  offrampRepo: OfframpRepoCreate,
  userRepo: UserRepoForOfframp,
  accountRepo: AccountRepoForOfframp,
  walletRepo: WalletRepoForOfframp,
  kybRepo: KybRepoForOfframp,
  requestId: string,
  body: Omit<CreateOfframpRequest, 'requestId'>,
  options: CreateOfframpOptions
): Promise<CreateOfframpResponse> {
  const { source: src, destination: dest } = body;
  if (!options.lockedQuote) {
    throw new Error('QUOTE_REQUIRED');
  }
  const userId = src.userId;
  if (dest.userId !== userId) {
    throw new Error('SOURCE_DESTINATION_USER_MISMATCH');
  }

  const user = await userRepo.findUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  const destCurrency = (dest.currency ?? 'USD').toUpperCase();
  const railStatuses = await kybRepo.getKybRailStatuses(userId, [destCurrency]);
  const approved = railStatuses.some((r) => r.status === 'approved');
  if (!approved) throw new Error('USER_NOT_KYB_VERIFIED');

  const account = await accountRepo.findOfframpAccountByIdAndUser(dest.accountId, userId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');

  const wallet = await walletRepo.findExternalWalletByIdAndUser(src.externalWalletId, userId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');

  const chain = options.lockedQuote.fromChain;
  const fromCurrency = options.lockedQuote.fromCurrency.trim().toLowerCase();
  const toCurrency = options.lockedQuote.toCurrency.trim().toLowerCase();

  const accountCurrency = account.currency.trim().toLowerCase();
  if (accountCurrency !== toCurrency) {
    throw new Error('ACCOUNT_CURRENCY_MISMATCH');
  }

  if (!isAccountReadyForOfframp({ providerPayout: account.providerPayout })) {
    throw new Error('ACCOUNT_INCOMPLETE_FOR_OFFRAMP');
  }

  assertOfframpQuoteCorridorMatchesAccount(options.lockedQuote, account.providerPayout);

  const snap = options.lockedQuote;
  const platformFee = snap.platformFee;
  const cryptoAmount = snap.sendAmount;
  const fiatNet = snap.destinationAmount;
  const rate = snap.conversionRate;
  const inverseRate = snap.inverseRate;
  const rateInformation: RateInformation = {
    ...snap.rateInformation,
    expiresAt: snap.rateValidUntil,
  };
  const fees: OfframpFees = snap.fees;
  const depositBy = snap.rateValidUntil;

  const userDisplayInfo = userDisplay(user);
  const email = userDisplay(user).email.trim();
  if (!email) {
    throw new Error('USER_EMAIL_REQUIRED_FOR_OFFRAMP');
  }
  const txnRef = generateOfframpTxnRef();

  const sourcePayload: OfframpSource = {
    userId,
    currency: fromCurrency,
    amount: cryptoAmount,
    chain,
    externalWalletId: src.externalWalletId,
    walletAddress: wallet.address,
    user: userDisplayInfo,
  };
  const destinationPayload: OfframpDestination = {
    userId,
    currency: toCurrency,
    amount: fiatNet,
    accountId: account.id,
    transferType: toCurrency === 'usd' ? account.paymentRail : (dest.transferType ?? account.paymentRail),
    bankTransferMethod: dest.bankTransferMethod,
    reference: dest.reference,
    purposeOfPayment: dest.purposeOfPayment,
    user: userDisplayInfo,
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  };

  /** Palremit provision must use the same canonical `network_code` as rates (not raw client chain). */
  const bodyForPalremit: Omit<CreateOfframpRequest, 'requestId'> = {
    ...body,
    source: {
      userId: src.userId,
      externalWalletId: src.externalWalletId,
      amount: cryptoAmount,
      currency: fromCurrency,
      chain,
    },
    destination: {
      userId: dest.userId,
      accountId: dest.accountId,
      currency: toCurrency,
      amount: fiatNet,
      purposeOfPayment: dest.purposeOfPayment,
      transferType: dest.transferType,
      bankTransferMethod: dest.bankTransferMethod,
      reference: dest.reference,
    },
    platformFee,
    ...(body.metadata !== undefined ? { metadata: body.metadata } : {}),
  };

  const palremitDeposit = await options.createPalremitDeposit(
    {
      userId: user.id,
      businessInfo: user.businessInfo,
      legalRepresentative: user.legalRepresentative,
      email,
    },
    bodyForPalremit,
    requestId,
    depositBy,
    txnRef
  );
  if (!palremitDeposit) {
    throw new Error('PALREMIT_DEPOSIT_ADDRESS_FAILED');
  }

  const timeline = {
    createdAt: new Date().toISOString(),
  };

  const row = await offrampRepo.createOfframp({
    requestId,
    txnRef,
    providerRefs: palremitDeposit.providerRefs,
    userId,
    status: 'AWAITING_CRYPTO',
    source: sourcePayload,
    destination: destinationPayload,
    rateInformation,
    depositInstructions: palremitDeposit.depositInstructions,
    timeline,
    fees,
    receipt: null,
    refundDetails: null,
    failedReason: null,
    lpReference: txnRef,
  });

  const ref = row.txnRef ?? txnRef;
  const transferDetails: OfframpTransferDetails = {
    id: row.id,
    requestId: row.requestId,
    txnRef: ref,
    clientReference: ref,
    status: row.status as OfframpStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OfframpSource,
    destination: maskPublicOfframpDestination(row.destination as OfframpDestination),
    rateInformation: row.rateInformation as RateInformation,
    depositInstructions: (row.depositInstructions as DepositInstructions) ?? null,
    timeline: (row.timeline as { createdAt?: string }) ?? undefined,
    fees: (row.fees as OfframpFees) ?? null,
    receipt: null,
    refundDetails: null,
    failedReason: row.failedReason ?? null,
  };

  return {
    transferType: 'OFFRAMP',
    transferDetails,
  };
}
