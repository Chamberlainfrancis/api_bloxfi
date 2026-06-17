/**
 * Core: create offramp. Palremit crypto provision + fiat withdrawal after `deposit.credited` (see advanceOfframpPayout).
 */

import { applyOfframpPlatformFee, resolveTransferFeeInSendCurrency } from '@/core/payments';
import { maskPublicOfframpDestination } from '@/core/offramps/maskOfframpDestination';
import { isAccountReadyForOfframp } from '@/core/integrations/palremitOfframp';
import { parseProviderPayout } from '@/core/accounts/providerPayoutHelpers';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
import { generateOfframpTxnRef } from '@/utils/txnRef';
import type {
  CreateOfframpRequest,
  CreateOfframpResponse,
  GetOfframpRatesResponse,
  OfframpStatus,
  OfframpSource,
  OfframpDestination,
  RateInformation,
  DepositInstructions,
  OfframpFees,
  OfframpTransferDetails,
} from '@/types/offramp';

const QUOTE_EXPIRY_MINUTES = 30;

export interface CreateOfframpOptions {
  getRateFromPalremit?: (
    from: string,
    to: string,
    fromChain?: string
  ) => Promise<GetOfframpRatesResponse | null>;
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
  /**
   * Fetch Palremit's payout fee for this corridor (POST /v1/withdrawals/quote).
   * Deducted from the receive amount. Returns null on failure → fee treated as
   * unavailable (no deduction), so a quote outage never blocks offramp creation.
   */
  getProviderWithdrawalFeeQuote?: (input: {
    asset: string;
    amount: number;
    destinationType: string;
    country?: string | null;
    beneficiaryType?: 'individual' | 'business' | null;
  }) => Promise<PalremitWithdrawalFeeQuote | null>;
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
  const { source: src, destination: dest, platformFee } = body;
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

  const chain = await options.resolvePalremitNetwork(
    src.currency.trim().toUpperCase(),
    src.chain,
    'source.chain'
  );

  const fromCurrency = src.currency.trim().toLowerCase();
  const toCurrency = dest.currency.trim().toLowerCase();

  const accountCurrency = account.currency.trim().toLowerCase();
  if (accountCurrency !== toCurrency) {
    throw new Error('ACCOUNT_CURRENCY_MISMATCH');
  }

  if (!isAccountReadyForOfframp({ providerPayout: account.providerPayout })) {
    throw new Error('ACCOUNT_INCOMPLETE_FOR_OFFRAMP');
  }

  if (!options.getRateFromPalremit) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const getRate = options.getRateFromPalremit;
  const rateResponse = await getRate(fromCurrency, toCurrency, chain);
  if (!rateResponse) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const rate = rateResponse.conversionRate;
  const inverseRate = rateResponse.inverseRate;

  const cryptoAmount = src.amount;
  const { feeAmount: platformFeeAmount, netAmount: netCryptoAfterPlatform } = applyOfframpPlatformFee(
    cryptoAmount,
    platformFee
  );
  const rateNum = parseFloat(rate) || 1;
  // Gross fiat after BloxFi's own platform fee but BEFORE the provider payout
  // fee. The provider fee is deducted from the SEND crypto (not this fiat),
  // because the downstream provider is destination-amount-fixed and charges
  // its fee on the funding leg in its own currency (e.g. USDC) — see
  // resolveTransferFeeInSendCurrency.
  const fiatGross = netCryptoAfterPlatform * rateNum;

  const pp = parseProviderPayout(account.providerPayout);
  let transferFeeInSend = 0; // provider fee expressed in the send crypto
  let transferFeeBreakdown: OfframpFees['transferFee'];
  if (options.getProviderWithdrawalFeeQuote && pp) {
    const quote = await options.getProviderWithdrawalFeeQuote({
      asset: pp.corridor.asset,
      amount: fiatGross,
      destinationType: pp.corridor.destinationType,
      country: pp.corridor.country,
      beneficiaryType: pp.corridor.beneficiaryType,
    });
    // Convert the provider fee (its own currency) into the send crypto. Null →
    // unavailable/unpriceable → fail soft (no deduction); the recipient still
    // receives the full quoted amount and the treasury absorbs the fee.
    const feeInSend = await resolveTransferFeeInSendCurrency({
      feeQuote: quote,
      sendCurrency: fromCurrency,
      getRate,
    });
    if (feeInSend != null) {
      transferFeeInSend = feeInSend > 0 ? feeInSend : 0;
      transferFeeBreakdown = {
        fees: quote?.fees ?? [],
        total: quote?.totalFee ?? null,
        unavailable: false,
      };
    } else {
      transferFeeBreakdown = {
        fees: quote?.fees ?? [],
        total: quote?.totalFee ?? null,
        unavailable: true,
      };
    }
  }

  if (transferFeeInSend >= netCryptoAfterPlatform) {
    throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
  }
  // Deduct the provider fee from the send crypto, then convert the remainder
  // at the rate → the net fiat the recipient actually receives (== what we
  // quote). This is the amount sent to the orchestrator as destination.amount.
  const netCryptoAfterTransfer = Math.max(0, netCryptoAfterPlatform - transferFeeInSend);
  const fiatNet = netCryptoAfterTransfer * rateNum;

  const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000);
  const depositBy = expiresAt.toISOString();
  const rateInformation: RateInformation = {
    rate,
    conversionRate: rate,
    inverseRate,
    fromCurrency,
    toCurrency,
    fromChain: chain,
    expiresAt: depositBy,
  };

  const userDisplayInfo = userDisplay(user);
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

  const fees: OfframpFees = {
    platformFee: {
      type: platformFee.type,
      value: String(platformFee.value),
      amount: platformFeeAmount.toFixed(6),
      currency: fromCurrency,
      walletAddress: platformFee.walletAddress,
    },
    ...(transferFeeBreakdown ? { transferFee: transferFeeBreakdown } : {}),
  };

  const timeline = {
    createdAt: new Date().toISOString(),
  };

  const txnRef = generateOfframpTxnRef();

  const email = userDisplay(user).email.trim();
  if (!email) {
    throw new Error('USER_EMAIL_REQUIRED_FOR_OFFRAMP');
  }

  /** Palremit provision must use the same canonical `network_code` as rates (not raw client chain). */
  const bodyForPalremit: Omit<CreateOfframpRequest, 'requestId'> = {
    ...body,
    source: {
      ...body.source,
      chain,
    },
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
