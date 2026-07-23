/**
 * Build and persist offramp quotes (POST /offramps/quotes).
 */

import { resolveTransferFeeInSendCurrency } from '@/core/payments';
import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';
import { buildPalremitProfit } from '@/core/quotes/rateSpread';
import {
  computeOfframpQuoteAmounts,
  formatOfframpConversionRate,
  formatOfframpInverseRate,
} from '@/core/quotes/computeOfframpQuoteAmounts';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
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
  amount: number;
  corridor: OfframpQuoteCorridor;
  platformFee: PlatformFee;
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

  const resolvedChain = await options.resolvePalremitNetwork(
    fromCurrency.toUpperCase(),
    clientFromChain,
    'source.chain'
  );

  const rateResponse = await options.getRateFromPalremit(fromCurrency, toCurrency, resolvedChain);
  if (!rateResponse) throw new Error('PALREMIT_RATES_UNAVAILABLE');

  const baseRateNum = parseFloat(rateResponse.conversionRate) || 0;
  if (baseRateNum <= 0) throw new Error('PALREMIT_RATES_UNAVAILABLE');

  // Platform fee is taken from the source crypto (gross). The provider fee is
  // quoted on the fiat that remains AFTER the platform fee, matching the math.
  const platformApplied = applyOfframpPlatformFee(input.amount, input.platformFee);
  const afterPlatformFiat = platformApplied.netAmount * baseRateNum;

  const feeQuote = await options.getProviderWithdrawalFeeQuote({
    asset: toCurrency,
    amount: afterPlatformFiat,
    destinationType: input.corridor.destinationType,
    country: input.corridor.country,
    beneficiaryType: input.corridor.beneficiaryType ?? undefined,
  });

  const feeInSendCurrency = await resolveTransferFeeInSendCurrency({
    feeQuote,
    sendCurrency: fromCurrency,
    getRate: (from, to, chain) => options.getRateFromPalremit(from, to, chain),
  });

  const amounts = computeOfframpQuoteAmounts({
    sendAmount: input.amount,
    baseConversionRate: baseRateNum,
    feeInSendCurrency,
    platformFee: input.platformFee,
  });

  if (amounts.sendNet <= 0) {
    throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
  }

  const profit = await buildPalremitProfit({
    sourceAmount: input.amount,
    toCurrency,
    rate: rateResponse.conversionRate,
    marketRate: rateResponse.marketRate,
    rateCurrency: rateResponse.rateCurrency,
    perCurrency: rateResponse.perCurrency,
    nowIso: new Date().toISOString(),
    convertToUsdc: options.convertToUsdc,
  }).catch(() => null);

  const usable =
    feeInSendCurrency != null && Number.isFinite(feeInSendCurrency);

  const quote: RampFeePreview = {
    sendGross: { amount: String(input.amount), currency: fromCurrency },
    sendNet: { amount: amounts.sendNet.toFixed(8), currency: fromCurrency },
    receiveGross: { amount: amounts.receiveGross.toFixed(2), currency: toCurrency },
    baseReceiveNet: { amount: amounts.baseReceiveNet.toFixed(2), currency: toCurrency },
    receiveNet: { amount: amounts.receiveNet.toFixed(2), currency: toCurrency },
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

  const allInRate = formatOfframpConversionRate(amounts.allInConversionRate);
  const expiresAt = parseQuoteExpiry(rateResponse.rateValidUntil);

  const rateInformation: RateInformation = {
    rate: allInRate,
    conversionRate: allInRate,
    inverseRate: formatOfframpInverseRate(amounts.allInConversionRate),
    fromCurrency,
    toCurrency,
    fromChain: resolvedChain,
    expiresAt: expiresAt.toISOString(),
  };

  const fees: OfframpFees = {
    platformFee: {
      type: input.platformFee.type,
      value: String(input.platformFee.value),
      amount: amounts.platformFeeAmount.toFixed(8),
      currency: fromCurrency,
      walletAddress: input.platformFee.walletAddress,
      settlementCurrency: input.platformFee.currency?.trim().toUpperCase() || 'USDC',
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
    sendAmount: input.amount,
    corridor: input.corridor,
    platformFee: input.platformFee,
    baseConversionRate: rateResponse.conversionRate,
    conversionRate: allInRate,
    inverseRate: rateInformation.inverseRate,
    rateValidUntil: rateResponse.rateValidUntil,
    destinationAmount: amounts.receiveNet,
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
    baseConversionRate: rateResponse.conversionRate,
    inverseRate: rateInformation.inverseRate,
    rateValidUntil: rateResponse.rateValidUntil,
    minimumAmount: rateResponse.minimumAmount,
    maximumAmount: rateResponse.maximumAmount,
    estimatedProcessingTime: rateResponse.estimatedProcessingTime,
    quote,
  };
}

export { assertOfframpQuoteCorridorMatchesAccount } from '@/core/quotes/assertOfframpQuoteCorridor';
