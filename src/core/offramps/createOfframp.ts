/**
 * Core: create offramp. Palremit crypto provision + fiat withdrawal after `deposit.credited` (see advanceOfframpPayout).
 */

import { requireOfframpPairMarkup } from '@/core/quotes/pairMarkup';
import { maskPublicOfframpDestination } from '@/core/offramps/maskOfframpDestination';
import {
  beneficiaryDobFromCustomer,
  buildWithdrawalFromAccount,
  isAccountReadyForOfframp,
  mergeSourceAmountCapIntoProviderRefs,
} from '@/core/integrations/palremitOfframp';
import {
  PayoutDestinationInvalidError,
  type PalremitDestinationCheck,
} from '@/core/integrations/palremitDestinationCheck';
import { purposePolicyForUser } from '@/core/payoutPurposes';
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
import type { ResolvedSenderInfo } from '@/core/admin/senderInfo';
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
  /**
   * Ask Palremit whether the fiat payout this offramp will send passes its
   * checks. Runs before deposit instructions are issued, so a payout that
   * would be rejected never gets funded. Optional so tests can omit it.
   */
  validatePayoutDestination?: (withdrawalBody: Record<string, unknown>) => Promise<PalremitDestinationCheck>;
  /**
   * Ops "sender info" setting for (offramp, payout currency, payout rail).
   * Resolved once here and saved on the row; later setting edits do not
   * change this offramp. Optional so callers without the setting store work.
   */
  resolveSenderInfo?: (input: {
    rampType: 'offramp';
    currency: string;
    rail?: string | null;
  }) => Promise<ResolvedSenderInfo | null>;
  /**
   * Business wallets. Without it, wallet funding is refused and wallet-only
   * businesses can't be checked (tests / callers that predate wallets).
   */
  wallet?: {
    findBusinessWallet(userId: string): Promise<{ enabled: boolean; walletOnly: boolean } | null>;
    /** Reserve + create in one DB transaction (offramp.repo createWalletFundedOfframp). */
    createWalletFundedOfframp(
      data: Parameters<OfframpRepoCreate['createOfframp']>[0],
      funding: { asset: 'USDT' | 'USDC'; amount: string }
    ): ReturnType<OfframpRepoCreate['createOfframp']>;
  };
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
    profit?: object | null;
    receipt?: object | null;
    refundDetails?: object | null;
    failedReason?: string | null;
    lpReference?: string | null;
    runReference?: string | null;
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
    runReference?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export interface UserRepoForOfframp {
  findUserById(id: string): Promise<{
    id: string;
    businessInfo: unknown;
    legalRepresentative: unknown;
    /** Ops settings, e.g. the purpose policy (allowSelfTransfer). */
    metadata?: unknown;
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

  // The sender wallet is informational only; deposits are matched by the
  // provisioned address, not the sending address.
  const wallet = src.externalWalletId
    ? await walletRepo.findExternalWalletByIdAndUser(src.externalWalletId, userId)
    : null;
  if (src.externalWalletId && !wallet) throw new Error('WALLET_NOT_FOUND');

  const chain = options.lockedQuote.fromChain;
  const fromCurrency = options.lockedQuote.fromCurrency.trim().toLowerCase();
  const toCurrency = options.lockedQuote.toCurrency.trim().toLowerCase();
  // No offramp without a saved markup: a row removed after the quote also blocks it.
  requireOfframpPairMarkup(fromCurrency, toCurrency);

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
  const profit = snap.profit ?? null;
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
    ...(wallet ? { externalWalletId: wallet.id, walletAddress: wallet.address } : {}),
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
      ...(src.externalWalletId ? { externalWalletId: src.externalWalletId } : {}),
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

  // Business wallet: decide the funding source before anything is provisioned.
  const businessWallet = options.wallet ? await options.wallet.findBusinessWallet(userId) : null;
  const fromWallet = src.fundingSource === 'wallet';
  if (fromWallet) {
    if (!options.wallet || !businessWallet?.enabled) throw new Error('WALLET_NOT_ENABLED');
    if (fromCurrency !== 'usdt' && fromCurrency !== 'usdc') throw new Error('WALLET_ASSET_NOT_SUPPORTED');
  } else if (businessWallet?.enabled && businessWallet.walletOnly) {
    throw new Error('WALLET_ONLY');
  }
  if (fromWallet) sourcePayload.fundingSource = 'wallet';

  if (options.validatePayoutDestination) {
    await assertPayoutDestinationAccepted(options.validatePayoutDestination, {
      account,
      user,
      fiatNet,
      purposeOfPayment: dest.purposeOfPayment,
      metadata: body.metadata,
    });
  }

  if (fromWallet && options.wallet) {
    return createFromWallet(options.wallet, {
      requestId,
      txnRef,
      userId,
      cryptoAmount,
      asset: fromCurrency.toUpperCase() as 'USDT' | 'USDC',
      sourcePayload,
      destinationPayload,
      rateInformation,
      fees,
      profit,
      providerRefs: snap.sourceAmountCap != null || snap.quote.sendNet?.amount != null
        ? mergeSourceAmountCapIntoProviderRefs({}, snap.sourceAmountCap ?? snap.quote.sendNet?.amount)
        : {},
      senderInfo: options.resolveSenderInfo
        ? await options.resolveSenderInfo({
            rampType: 'offramp',
            currency: toCurrency,
            rail: (destinationPayload.transferType ?? account.paymentRail ?? '').toLowerCase(),
          })
        : null,
      runReference: body.runReference,
    });
  }

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

  const senderInfo = options.resolveSenderInfo
    ? await options.resolveSenderInfo({
        rampType: 'offramp',
        currency: toCurrency,
        rail: (destinationPayload.transferType ?? account.paymentRail ?? '').toLowerCase(),
      })
    : null;
  const providerRefs = {
    ...mergeSourceAmountCapIntoProviderRefs(
      palremitDeposit.providerRefs,
      snap.sourceAmountCap ?? snap.quote.sendNet?.amount
    ),
    ...(senderInfo ? { senderInfo } : {}),
  };

  const row = await offrampRepo.createOfframp({
    requestId,
    txnRef,
    providerRefs,
    userId,
    status: 'AWAITING_CRYPTO',
    source: sourcePayload,
    destination: destinationPayload,
    rateInformation,
    depositInstructions: palremitDeposit.depositInstructions,
    timeline,
    fees,
    profit,
    receipt: null,
    refundDetails: null,
    failedReason: null,
    lpReference: txnRef,
    runReference: body.runReference ?? null,
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
    senderName: senderInfo?.senderName ?? null,
    runReference: row.runReference ?? null,
  };

  return {
    transferType: 'OFFRAMP',
    transferDetails,
  };
}

/**
 * Wallet-funded offramp: no deposit address. The reserve and the row are
 * written together (CRYPTO_CONFIRMED straight away); the caller then starts
 * the fiat payout as it does after a deposit.
 */
async function createFromWallet(
  wallet: NonNullable<CreateOfframpOptions['wallet']>,
  p: {
    requestId: string;
    txnRef: string;
    userId: string;
    cryptoAmount: number;
    asset: 'USDT' | 'USDC';
    sourcePayload: OfframpSource;
    destinationPayload: OfframpDestination;
    rateInformation: RateInformation;
    fees: OfframpFees;
    profit: unknown;
    providerRefs: Record<string, unknown>;
    senderInfo: ResolvedSenderInfo | null;
    runReference?: string;
  }
): Promise<CreateOfframpResponse> {
  const now = new Date().toISOString();
  const amount = String(p.cryptoAmount);
  const row = await wallet.createWalletFundedOfframp(
    {
      requestId: p.requestId,
      txnRef: p.txnRef,
      providerRefs: {
        ...p.providerRefs,
        walletFunding: { asset: p.asset, amount, reservedAt: now },
        ...(p.senderInfo ? { senderInfo: p.senderInfo } : {}),
      },
      userId: p.userId,
      status: 'CRYPTO_CONFIRMED',
      source: p.sourcePayload,
      destination: p.destinationPayload,
      rateInformation: p.rateInformation,
      depositInstructions: null,
      timeline: { createdAt: now, cryptoConfirmedAt: now, cryptoReceivedAmount: p.cryptoAmount, cryptoExpectedAmount: p.cryptoAmount, fundedFromWallet: true },
      fees: p.fees,
      profit: (p.profit as object | null) ?? null,
      receipt: null,
      refundDetails: null,
      failedReason: null,
      lpReference: p.txnRef,
      runReference: p.runReference ?? null,
    },
    { asset: p.asset, amount }
  );
  const ref = row.txnRef ?? p.txnRef;
  return {
    transferType: 'OFFRAMP',
    transferDetails: {
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
      depositInstructions: null,
      timeline: (row.timeline as { createdAt?: string }) ?? undefined,
      fees: (row.fees as OfframpFees) ?? null,
      receipt: null,
      refundDetails: null,
      failedReason: row.failedReason ?? null,
      senderName: p.senderInfo?.senderName ?? null,
      runReference: row.runReference ?? null,
    },
  };
}

/**
 * Build the withdrawal body advanceOfframpPayout will send for this offramp and
 * have Palremit check it. Throws PayoutDestinationInvalidError on field errors;
 * carries on if Palremit can't answer (withdrawal create still validates).
 */
async function assertPayoutDestinationAccepted(
  validate: NonNullable<CreateOfframpOptions['validatePayoutDestination']>,
  input: {
    account: { accountHolder: unknown; providerPayout: unknown };
    user: { id: string; legalRepresentative?: unknown; metadata?: unknown };
    fiatNet: number;
    purposeOfPayment?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const holder = input.account.accountHolder;
  const holderEmail =
    holder != null &&
    typeof holder === 'object' &&
    !Array.isArray(holder) &&
    typeof (holder as { email?: unknown }).email === 'string'
      ? (holder as { email: string }).email
      : undefined;
  const withdrawalBody = buildWithdrawalFromAccount({
    txnRef: 'offramp-validate',
    destinationAmount: input.fiatNet,
    providerPayout: input.account.providerPayout,
    purposeOfPayment: input.purposeOfPayment,
    metadata: input.metadata,
    businessReference: input.user.id,
    accountHolderEmail: holderEmail,
    beneficiaryDob: beneficiaryDobFromCustomer({
      accountHolder: holder,
      legalRepresentative: input.user.legalRepresentative,
    }),
    purposePolicy: purposePolicyForUser(input.user),
  });
  if (!withdrawalBody) return;
  const check = await validate(withdrawalBody);
  if (check.status === 'invalid') throw new PayoutDestinationInvalidError(check.errors);
}
