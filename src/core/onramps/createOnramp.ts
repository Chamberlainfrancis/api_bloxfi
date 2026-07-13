/**
 * Core: create onramp. Fiat-deposit-first flow:
 * create intent + deposit instructions, then execute crypto withdrawal after fiat is credited.
 */

import { applyOfframpPlatformFee } from '@/core/payments';
import { buildPalremitProfit } from '@/core/quotes/rateSpread';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
import { generateOnrampTxnRef } from '@/utils/txnRef';
import type {
  CreateOnrampRequest,
  CreateOnrampResponse,
  OnrampStatus,
  OnrampSource,
  OnrampDestination,
  QuoteInformation,
  DepositInfo,
  OnrampFees,
  OnrampTransferDetails,
  Receipt,
} from '@/types/onramp';
import type { OnrampQuoteSnapshot } from '@/types/quote';

const QUOTE_EXPIRY_MINUTES = 30;

export interface CreateOnrampOptions {
  getQuoteFromPalremit?: (
    from: string,
    to: string,
    amount: number
  ) => Promise<{
    conversionRate: string;
    conversion: number;
    marketRate?: string | null;
    rateCurrency?: string | null;
    perCurrency?: string | null;
  } | null>;
  convertToUsdc?: (from: string, amount: number) => Promise<number | null>;
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
    /**
     * Prisma User.id, sent to Palremit as `business_reference` for
     * providers whose deposit arm resolves a pre-onboarded provider
     * customer (e.g. SwipeLux FIAT_DEPOSIT_NO_KYC) rather than orchestrating
     * KYC itself. Mirrors the exact same `businessReference: userId`
     * pattern already used for offramp withdrawals
     * (advanceOfframpPayout.ts) — not palremitChannelUserId, which is
     * defined but never actually populated.
     */
    businessReference: string;
  }) => Promise<{ depositInfo: DepositInfo; providerRefs: Record<string, unknown> } | null>;
  /**
   * Fetch Palremit's crypto payout fee (POST /v1/withdrawals/quote). Deducted
   * from the receive amount. Returns null on failure → fee treated as
   * unavailable (no deduction), so a quote outage never blocks onramp creation.
   */
  getProviderWithdrawalFeeQuote?: (input: {
    asset: string;
    amount: number;
    destinationType: string;
    network?: string | null;
  }) => Promise<PalremitWithdrawalFeeQuote | null>;
  /** When set, pricing is taken from the locked quote (POST /onramps/quotes). */
  lockedQuote?: OnrampQuoteSnapshot;
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
    fees?: object | null;
    profit?: object | null;
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
    fees: unknown;
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
  const { source: src, destination: dest } = body;
  const userId = src.userId;
  if (dest.userId !== userId) {
    throw new Error('SOURCE_DESTINATION_USER_MISMATCH');
  }

  const user = await userRepo.findUserById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  const fromCurrency = (options.lockedQuote?.fromCurrency ?? src.currency).trim().toLowerCase();
  const toCurrency = (options.lockedQuote?.toCurrency ?? dest.currency).trim().toLowerCase();

  const railCurrency = fromCurrency.toUpperCase();
  const railStatuses = await kybRepo.getKybRailStatuses(userId, [railCurrency]);
  const approved = railStatuses.some((r) => r.status === 'approved');
  if (!approved) throw new Error('USER_NOT_KYB_VERIFIED');

  const wallet = await walletRepo.findExternalWalletByIdAndUser(dest.externalWalletId, userId);
  if (!wallet) throw new Error('WALLET_NOT_FOUND');

  const destinationNetwork = options.lockedQuote
    ? options.lockedQuote.destinationChain
    : await options.resolvePalremitNetwork(
        dest.currency.trim().toUpperCase(),
        dest.chain,
        'destination.chain'
      );

  if (options.lockedQuote) {
    if (options.lockedQuote.fromCurrency !== fromCurrency) {
      throw new Error('QUOTE_CURRENCY_MISMATCH');
    }
    if (options.lockedQuote.toCurrency !== toCurrency) {
      throw new Error('QUOTE_CURRENCY_MISMATCH');
    }
  }

  let grossFiat: number;
  let receiveNet: number;
  let quoteInformation: QuoteInformation;
  let fees: OnrampFees;
  let profit: object | null = null;
  let expiresAt: Date;
  let platformFee = body.platformFee!;

  if (options.lockedQuote) {
    const snap = options.lockedQuote;
    platformFee = snap.platformFee;
    grossFiat = snap.sendAmount;
    receiveNet = snap.receiveNet;
    quoteInformation = snap.quoteInformation;
    fees = snap.fees;
    profit = snap.profit ?? null;
    expiresAt = new Date(snap.rateValidUntil);
  } else {
    if (!options.getQuoteFromPalremit) {
      throw new Error('PALREMIT_RATES_UNAVAILABLE');
    }
    const quote = await options.getQuoteFromPalremit(fromCurrency, toCurrency, src.amount);
    if (!quote?.conversionRate || typeof quote.conversion !== 'number') {
      throw new Error('PALREMIT_RATES_UNAVAILABLE');
    }
    const conversionRate = quote.conversionRate;

    grossFiat = src.amount;
    const receiveGross = quote.conversion;
    const { feeAmount: platformFeeAmount, netAmount: receiveAfterPlatformFee } =
      applyOfframpPlatformFee(receiveGross, platformFee);

    let transferFeeCrypto = 0;
    let transferFeeBreakdown: QuoteInformation['transferFee'];
    if (options.getProviderWithdrawalFeeQuote) {
      const feeQuote = await options.getProviderWithdrawalFeeQuote({
        asset: toCurrency,
        amount: receiveAfterPlatformFee,
        destinationType: 'crypto_address',
        network: destinationNetwork,
      });
      const usable =
        feeQuote != null &&
        !feeQuote.feeUnavailable &&
        feeQuote.totalFee != null &&
        feeQuote.totalFee.currency.toUpperCase() === toCurrency.toUpperCase();
      if (usable && feeQuote) {
        const parsedFee = Number(feeQuote.totalFee!.amount);
        if (Number.isFinite(parsedFee) && parsedFee > 0) transferFeeCrypto = parsedFee;
        transferFeeBreakdown = { fees: feeQuote.fees, total: feeQuote.totalFee, unavailable: false };
      } else {
        transferFeeBreakdown = {
          fees: feeQuote?.fees ?? [],
          total: feeQuote?.totalFee ?? null,
          unavailable: true,
        };
      }
    }

    if (transferFeeCrypto >= receiveAfterPlatformFee) {
      throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
    }
    receiveNet = Math.max(0, receiveAfterPlatformFee - transferFeeCrypto);

    expiresAt = new Date(Date.now() + QUOTE_EXPIRY_MINUTES * 60 * 1000);
    const sendGross = { amount: grossFiat.toFixed(2), currency: fromCurrency };
    const sendNet = sendGross;
    const railFee = { amount: '0.00', currency: fromCurrency };
    const receiveGrossStr = { amount: receiveGross.toFixed(8), currency: toCurrency };
    const receiveNetStr = { amount: receiveNet.toFixed(8), currency: toCurrency };
    quoteInformation = {
      sendGross,
      sendNet,
      railFee,
      receiveGross: receiveGrossStr,
      receiveNet: receiveNetStr,
      rate: conversionRate,
      expiresAt: expiresAt.toISOString(),
      ...(transferFeeBreakdown ? { transferFee: transferFeeBreakdown } : {}),
    };

    fees = {
      platformFee: {
        type: platformFee.type,
        value: String(platformFee.value),
        amount: platformFeeAmount.toFixed(8),
        currency: toCurrency,
        walletAddress: platformFee.walletAddress,
        settlementCurrency: platformFee.currency?.trim().toUpperCase() || 'USDC',
        ...(platformFee.network?.trim() ? { settlementNetwork: platformFee.network.trim() } : {}),
      },
    };

    profit = options.convertToUsdc
      ? await buildPalremitProfit({
          sourceAmount: src.amount,
          toCurrency,
          rate: quote.conversionRate,
          marketRate: quote.marketRate ?? undefined,
          rateCurrency: quote.rateCurrency ?? undefined,
          perCurrency: quote.perCurrency ?? undefined,
          nowIso: new Date().toISOString(),
          convertToUsdc: options.convertToUsdc,
        }).catch(() => null)
      : null;
  }

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
    businessReference: userId,
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
    fees,
    profit,
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
    fees: (row.fees as OnrampFees) ?? null,
    failedReason: row.failedReason ?? null,
  };

  return {
    transferType: 'ONRAMP',
    transferDetails,
  };
}
