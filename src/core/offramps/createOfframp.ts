/**
 * Core: create offramp. Validate user, wallet, account; compute quote (Currency API + platform fee); persist; return deposit instructions.
 * Spec §5.2 POST /offramps. Rates from Currency API; LP used only for liquidity (Deposit API for crypto address, Withdrawal API for fiat).
 */

import type { LpHttpClient } from '../integrations/types';
import { applyOfframpPlatformFee } from '../payments';
import { createOfframpAtLp } from '../integrations/offrampLp';
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
} from '../../types/offramp';

export interface CreateOfframpOptions {
  /** Fetches rate from Currency API. Used as sole rate source (RAMP_ARCHITECTURE). */
  getRateFromCurrencyApi?: (
    from: string,
    to: string,
    fromChain?: string
  ) => Promise<GetOfframpRatesResponse | null>;
  /** When set, used for liquidity: get crypto deposit address/instructions (e.g. Palremit Deposit API). */
  createViaPalremit?: (
    user: { businessInfo: unknown },
    account: { accountHolder: unknown; regionDetails: unknown; paymentRail: string },
    body: Omit<CreateOfframpRequest, 'requestId'>,
    depositBy: string
  ) => Promise<{ reference: string; depositInstructions: DepositInstructions } | null>;
}

const QUOTE_EXPIRY_MINUTES = 30;

export interface OfframpRepoCreate {
  createOfframp(data: {
    requestId: string;
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
  } | null>;
}

export interface AccountRepoForOfframp {
  findAccountByIdAndUser(accountId: string, userId: string): Promise<{
    id: string;
    userId: string;
    accountHolder: unknown;
    regionDetails: unknown;
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

/**
 * Build deposit instructions (where user sends crypto). Placeholder when LP does not return.
 */
function buildDepositInstructionsPlaceholder(
  address: string,
  amount: string,
  currency: string,
  network: string,
  depositBy: string
): DepositInstructions {
  return {
    address,
    amount,
    currency,
    network,
    depositBy,
    instruction: `Send exactly ${amount} ${currency} to the address above by ${depositBy}`,
  };
}

export async function createOfframp(
  offrampRepo: OfframpRepoCreate,
  userRepo: UserRepoForOfframp,
  accountRepo: AccountRepoForOfframp,
  walletRepo: WalletRepoForOfframp,
  kybRepo: KybRepoForOfframp,
  lpClient: LpHttpClient | null,
  requestId: string,
  body: Omit<CreateOfframpRequest, 'requestId'>,
  options?: CreateOfframpOptions
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

  const account = await accountRepo.findAccountByIdAndUser(dest.accountId, userId);
  if (!account) throw new Error('ACCOUNT_NOT_FOUND');

  const wallet = await walletRepo.findExternalWalletByIdAndUser(src.externalWalletId, userId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');

  const fromCurrency = src.currency.trim().toLowerCase();
  const toCurrency = dest.currency.trim().toLowerCase();
  const chain = src.chain.trim();

  let rate = '1.00';
  let inverseRate = '1.00';
  if (options?.getRateFromCurrencyApi) {
    const currencyApiRates = await options.getRateFromCurrencyApi(
      fromCurrency,
      toCurrency,
      chain
    );
    if (currencyApiRates) {
      rate = currencyApiRates.rate;
      inverseRate = currencyApiRates.inverseRate;
    }
  }

  const cryptoAmount = src.amount;
  const rateNum = parseFloat(rate) || 1;
  const fiatGross = cryptoAmount * rateNum;
  const { feeAmount: platformFeeAmount, netAmount: fiatNet } = applyOfframpPlatformFee(
    fiatGross,
    platformFee
  );

  const expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000);
  const rateInformation: RateInformation = {
    rate,
    inverseRate,
    fromCurrency,
    toCurrency,
    fromChain: chain,
    expiresAt: expiresAt.toISOString(),
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
    transferType: dest.transferType ?? account.paymentRail,
    user: userDisplayInfo,
  };

  const fees: OfframpFees = {
    platformFee: {
      amount: platformFeeAmount.toFixed(2),
      currency: toCurrency,
    },
  };

  const timeline = {
    createdAt: new Date().toISOString(),
  };

  let depositInstructions: DepositInstructions | null = null;
  let lpReference: string | null = null;
  const depositBy = expiresAt.toISOString();

  if (options?.createViaPalremit) {
    const palremitResult = await options.createViaPalremit(user, account, body, depositBy);
    if (palremitResult) {
      depositInstructions = palremitResult.depositInstructions;
      lpReference = palremitResult.reference;
    }
  }
  if (!depositInstructions && lpClient) {
    const lpPayload: CreateOfframpRequest = { ...body, requestId };
    const lpResponse = await createOfframpAtLp(lpClient, lpPayload);
    if (lpResponse?.transferDetails?.depositInstructions) {
      depositInstructions = lpResponse.transferDetails.depositInstructions;
      lpReference =
        (lpResponse.transferDetails as { lpReference?: string })?.lpReference ?? null;
    }
  }

  if (!depositInstructions) {
    depositInstructions = buildDepositInstructionsPlaceholder(
      wallet.address,
      cryptoAmount.toFixed(6),
      fromCurrency,
      chain,
      expiresAt.toISOString()
    );
  }

  const row = await offrampRepo.createOfframp({
    requestId,
    userId,
    status: 'CREATED',
    source: sourcePayload,
    destination: destinationPayload,
    rateInformation,
    depositInstructions,
    timeline,
    fees,
    receipt: null,
    refundDetails: null,
    failedReason: null,
    lpReference,
  });

  const transferDetails: OfframpTransferDetails = {
    id: row.id,
    requestId: row.requestId,
    status: row.status as OfframpStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OfframpSource,
    destination: row.destination as OfframpDestination,
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
