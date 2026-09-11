/**
 * Build and persist offramp quotes (POST /offramps/quotes).
 */

import { resolveTransferFeeInSendCurrency } from '@/core/payments';
import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';
import { buildPalremitProfit } from '@/core/quotes/rateSpread';
import { applyPairMarkupIfMatched, findPairMarkup } from '@/core/quotes/pairMarkup';
import {
  floorOfframpMarketRate,
  isUsableExecutableRate,
} from '@/core/quotes/floorOfframpMarketRate';
import { offrampImpliedSourceExceedsSendNet } from '@/core/quotes/offrampQuoteSolvency';
import {
  computeOfframpQuoteAmounts,
  formatOfframpConversionRate,
  formatOfframpInverseRate,
  solveOfframpSendFromDest,
} from '@/core/quotes/computeOfframpQuoteAmounts';
import { payoutFiatDecimals, roundPayoutFiatAmount } from '@/core/quotes/roundPayoutFiatAmount';
import { parseStableFeeAsset } from '@/core/offramps/stablecoinFee';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
import {
  resolveOfframpQuoteCorridor,
  type OfframpAccountPayoutCorridor,
  type OfframpQuoteCorridorBody,
} from '@/core/quotes/resolveOfframpQuoteCorridor';
import type {
  GetOfframpRatesResponse,
  OfframpFees,
  PlatformFee,
  RampFeePreview,
  RateInformation,
} from '@/types/offramp';
import type { OfframpQuoteCorridor, OfframpQuoteResponse, OfframpQuoteSnapshot } from '@/types/quote';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';

export interface CreateOfframpQuoteInput {
  fromCurrency: string;
  toCurrency: string;
  fromChain: string;
  /** Crypto send. Required unless destinationAmount is set. */
  amount?: number;
  /** Fiat receive. Required unless amount is set. Locks the bank credit. */
  destinationAmount?: number;
  corridor: OfframpQuoteCorridor | OfframpQuoteCorridorBody;
  platformFee: PlatformFee;
  accountId: string;
}

export interface CreateOfframpQuoteOptions {
  getRateFromPalremit: (
    from: string,
    to: string,
    fromChain?: string
  ) => Promise<GetOfframpRatesResponse | null>;
  resolvePalremitNetwork: (
    coinCode: string,
    chainFromClient: string,
    field: 'source.chain'
  ) => Promise<string>;
  getProviderWithdrawalFeeQuote: (input: {
    asset: string;
    amount: number;
    destinationType: string;
    country?: string | null;
    beneficiaryType?: 'individual' | 'business' | null;
  }) => Promise<PalremitWithdrawalFeeQuote | null>;
  convertToUsdc: (from: string, amount: number) => Promise<number | null>;
  loadOfframpAccountCorridor: (
    accountId: string
  ) => Promise<OfframpAccountPayoutCorridor | null>;
}

function parseQuoteExpiry(rateValidUntil: string): Date {
  const parsed = Date.parse(rateValidUntil);
  if (Number.isFinite(parsed)) return new Date(parsed);
  return new Date(Date.now() + 30 * 60 * 1000);
}

export async function createOfframpQuote(
  input: CreateOfframpQuoteInput,
  options: CreateOfframpQuoteOptions
): Promise<OfframpQuoteResponse> {
  const fromCurrency = input.fromCurrency.trim().toLowerCase();
  const toCurrency = input.toCurrency.trim().toLowerCase();
  const clientFromChain = input.fromChain.trim();
  const accountId = input.accountId.trim();
  if (!accountId) throw new Error('OFFRAMP_ACCOUNT_NOT_FOUND');
  const accountCorridor = await options.loadOfframpAccountCorridor(accountId);
  if (!accountCorridor) throw new Error('OFFRAMP_ACCOUNT_NOT_FOUND');
  const corridor = resolveOfframpQuoteCorridor({
    toCurrency,
    body: input.corridor,
    account: accountCorridor,
  });

  const resolvedChain = await options.resolvePalremitNetwork(
    fromCurrency.toUpperCase(),
    clientFromChain,
    'source.chain'
  );

  const rateResponse = await options.getRateFromPalremit(fromCurrency, toCurrency, resolvedChain);
  if (!rateResponse) throw new Error('PALREMIT_RATES_UNAVAILABLE');

  const destLocked =
    input.destinationAmount != null
      ? roundPayoutFiatAmount(toCurrency, input.destinationAmount)
      : null;
  if (input.destinationAmount != null && !(destLocked! > 0)) {
    throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
  }
  const sendHint = input.amount ?? destLocked ?? 1;

  let conversionRate = rateResponse.conversionRate;
  const pairPriced = applyPairMarkupIfMatched({
    fromCurrency,
    toCurrency,
    amount: sendHint,
    marketRate: rateResponse.marketRate,
    rateCurrency: rateResponse.rateCurrency,
    perCurrency: rateResponse.perCurrency,
  });
  if (pairPriced) conversionRate = pairPriced.conversionRate;

  let baseRateNum = parseFloat(conversionRate) || 0;
  if (baseRateNum <= 0) throw new Error('PALREMIT_RATES_UNAVAILABLE');

  // Dest-fixed: quote OwlPay for the exact fiat the bank must receive.
  // Source-fixed: quote on the fiat that remains after the platform fee.
  const afterPlatformFiat =
    destLocked != null
      ? destLocked
      : roundPayoutFiatAmount(
          toCurrency,
          applyOfframpPlatformFee(input.amount!, input.platformFee).netAmount * baseRateNum
        );

  const feeQuote = await options.getProviderWithdrawalFeeQuote({
    asset: toCurrency,
    amount: afterPlatformFiat,
    destinationType: corridor.destinationType,
    country: corridor.country,
    beneficiaryType: corridor.beneficiaryType ?? undefined,
  });

  const rawMarket = parseFloat(String(rateResponse.marketRate ?? conversionRate));
  const apiMarket = Number.isFinite(rawMarket) && rawMarket > 0 ? rawMarket : baseRateNum;
  const executable = parseFloat(feeQuote?.effectiveRate ?? '');
  const executableOk = isUsableExecutableRate(executable);
  if (findPairMarkup(fromCurrency, toCurrency) && !executableOk) {
    throw new Error('UNFAVORABLE_RATE');
  }
  const flooredMarket = floorOfframpMarketRate(
    apiMarket,
    executableOk ? executable : null,
  );
  const repriced = applyPairMarkupIfMatched({
    fromCurrency,
    toCurrency,
    amount: sendHint,
    marketRate: flooredMarket,
    rateCurrency: rateResponse.rateCurrency,
    perCurrency: rateResponse.perCurrency,
  });
  if (repriced) {
    conversionRate = repriced.conversionRate;
    baseRateNum = parseFloat(conversionRate) || 0;
    if (baseRateNum <= 0) throw new Error('PALREMIT_RATES_UNAVAILABLE');
  } else {
    // No pair-markup rule (CNY, NGN, …): still cap the locked customer rate
    // at OwlPay so solvency does not 422 a corridor we can actually fund.
    const flooredCustomer = floorOfframpMarketRate(
      baseRateNum,
      executableOk ? executable : null,
    );
    conversionRate = String(flooredCustomer);
    baseRateNum = flooredCustomer;
    if (baseRateNum <= 0) throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }

  const feeInSendCurrency = await resolveTransferFeeInSendCurrency({
    feeQuote,
    sendCurrency: fromCurrency,
    getRate: (from, to, chain) => options.getRateFromPalremit(from, to, chain),
  });

  const sendAmount =
    destLocked != null
      ? solveOfframpSendFromDest({
          destinationAmount: destLocked,
          baseConversionRate: baseRateNum,
          feeInSendCurrency,
          platformFee: input.platformFee,
        }).sendGross
      : input.amount!;

  const amounts = computeOfframpQuoteAmounts({
    sendAmount,
    baseConversionRate: baseRateNum,
    feeInSendCurrency,
    platformFee: input.platformFee,
  });

  const receiveDecimals = payoutFiatDecimals(toCurrency);
  // Dest-fixed: receive is the requested fiat. Source-fixed JPY snaps to
  // whole yen. Other source-fixed fiats keep full precision.
  const receiveNet =
    destLocked != null
      ? destLocked
      : receiveDecimals === 0
        ? roundPayoutFiatAmount(toCurrency, amounts.receiveNet)
        : amounts.receiveNet;
  const receiveGross =
    receiveDecimals === 0
      ? roundPayoutFiatAmount(toCurrency, amounts.receiveGross)
      : amounts.receiveGross;
  const baseReceiveNet =
    receiveDecimals === 0
      ? roundPayoutFiatAmount(toCurrency, amounts.baseReceiveNet)
      : amounts.baseReceiveNet;

  if (amounts.sendNet <= 0) {
    throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
  }

  if (
    offrampImpliedSourceExceedsSendNet({
      sendNet: amounts.sendNet,
      receiveNet,
      effectiveRate: executableOk ? executable : null,
    })
  ) {
    throw new Error('UNFAVORABLE_RATE');
  }

  const profit = await buildPalremitProfit({
    sourceAmount: sendAmount,
    toCurrency,
    rate: conversionRate,
    marketRate: flooredMarket,
    rateCurrency: rateResponse.rateCurrency,
    perCurrency: rateResponse.perCurrency,
    nowIso: new Date().toISOString(),
    convertToUsdc: options.convertToUsdc,
  }).catch(() => null);

  const usable =
    feeInSendCurrency != null && Number.isFinite(feeInSendCurrency);

  const allInForRate =
    destLocked != null && sendAmount > 0 ? destLocked / sendAmount : amounts.allInConversionRate;

  const quote: RampFeePreview = {
    sendGross: {
      amount: destLocked != null ? sendAmount.toFixed(8) : String(input.amount),
      currency: fromCurrency,
    },
    sendNet: { amount: amounts.sendNet.toFixed(8), currency: fromCurrency },
    receiveGross: { amount: receiveGross.toFixed(receiveDecimals), currency: toCurrency },
    baseReceiveNet: { amount: baseReceiveNet.toFixed(receiveDecimals), currency: toCurrency },
    receiveNet: { amount: receiveNet.toFixed(receiveDecimals), currency: toCurrency },
    platformFee: {
      type: input.platformFee.type,
      value: input.platformFee.value,
      walletAddress: input.platformFee.walletAddress,
      currency: fromCurrency,
      ...(input.platformFee.network?.trim() ? { network: input.platformFee.network.trim() } : {}),
      amount: amounts.platformFeeAmount.toFixed(8),
    },
    transferFee: {
      fees: feeQuote?.fees ?? [],
      total: feeQuote?.totalFee ?? null,
      unavailable: !usable,
    },
  };

  const allInRate = formatOfframpConversionRate(allInForRate);
  const expiresAt = parseQuoteExpiry(rateResponse.rateValidUntil);

  const rateInformation: RateInformation = {
    rate: allInRate,
    conversionRate: allInRate,
    inverseRate: formatOfframpInverseRate(allInForRate),
    fromCurrency,
    toCurrency,
    fromChain: resolvedChain,
    expiresAt: expiresAt.toISOString(),
  };

  const settlementCurrency =
    parseStableFeeAsset(input.platformFee.currency) ?? parseStableFeeAsset(fromCurrency);

  const fees: OfframpFees = {
    platformFee: {
      type: input.platformFee.type,
      value: String(input.platformFee.value),
      amount: amounts.platformFeeAmount.toFixed(8),
      currency: fromCurrency,
      walletAddress: input.platformFee.walletAddress,
      ...(settlementCurrency ? { settlementCurrency } : {}),
      ...(input.platformFee.network?.trim()
        ? { settlementNetwork: input.platformFee.network.trim() }
        : {}),
    },
    transferFee: quote.transferFee,
  };

  const snapshot: OfframpQuoteSnapshot = {
    version: 1,
    fromCurrency,
    toCurrency,
    fromChain: resolvedChain,
    clientFromChain,
    sendAmount,
    corridor,
    platformFee: input.platformFee,
    baseConversionRate: conversionRate,
    conversionRate: allInRate,
    inverseRate: rateInformation.inverseRate,
    rateValidUntil: rateResponse.rateValidUntil,
    destinationAmount: receiveNet,
    quote,
    fees,
    profit,
    rateInformation,
  };

  const row = await rampQuoteRepo.createRampQuote({
    rampType: 'offramp',
    payload: snapshot,
    expiresAt,
  });

  return {
    quoteId: row.id,
    expiresAt: row.expiresAt.toISOString(),
    fromCurrency,
    toCurrency,
    fromChain: resolvedChain,
    conversionRate: allInRate,
    baseConversionRate: conversionRate,
    inverseRate: rateInformation.inverseRate,
    rateValidUntil: rateResponse.rateValidUntil,
    minimumAmount: rateResponse.minimumAmount,
    maximumAmount: rateResponse.maximumAmount,
    estimatedProcessingTime: rateResponse.estimatedProcessingTime,
    quote,
  };
}

export { assertOfframpQuoteCorridorMatchesAccount } from '@/core/quotes/assertOfframpQuoteCorridor';
