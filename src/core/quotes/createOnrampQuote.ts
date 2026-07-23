/**
 * Build and persist onramp quotes (POST /onramps/quotes).
 */

import { applyOfframpPlatformFee } from '@/core/payments';
import { buildPalremitProfit } from '@/core/quotes/rateSpread';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
import type { PlatformFee, RampFeePreview } from '@/types/offramp';
import type { OnrampFees, QuoteInformation } from '@/types/onramp';
import type { OnrampQuoteResponse, OnrampQuoteSnapshot } from '@/types/quote';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';

export interface CreateOnrampQuoteInput {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  destinationChain: string;
  platformFee: PlatformFee;
}

export interface CreateOnrampQuoteOptions {
  getQuoteFromPalremit: (
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
  resolvePalremitNetwork: (
    coinCode: string,
    chainFromClient: string,
    field: 'destination.chain'
  ) => Promise<string>;
  getProviderWithdrawalFeeQuote: (input: {
    asset: string;
    amount: number;
    destinationType: string;
    network?: string | null;
  }) => Promise<PalremitWithdrawalFeeQuote | null>;
  convertToUsdc: (from: string, amount: number) => Promise<number | null>;
}

function parseQuoteExpiry(minutes = 180): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export async function createOnrampQuote(
  input: CreateOnrampQuoteInput,
  options: CreateOnrampQuoteOptions
): Promise<OnrampQuoteResponse> {
  const fromCurrency = input.fromCurrency.trim().toLowerCase();
  const toCurrency = input.toCurrency.trim().toLowerCase();
  const clientDestinationChain = input.destinationChain.trim();

  const resolvedChain = await options.resolvePalremitNetwork(
    toCurrency.toUpperCase(),
    clientDestinationChain,
    'destination.chain'
  );

  const palremitQuote = await options.getQuoteFromPalremit(
    fromCurrency,
    toCurrency,
    input.amount
  );
  if (!palremitQuote?.conversionRate || typeof palremitQuote.conversion !== 'number') {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }

  const receiveGross = palremitQuote.conversion;
  const { feeAmount: platformFeeAmount, netAmount: receiveAfterPlatformFee } =
    applyOfframpPlatformFee(receiveGross, input.platformFee);

  const feeQuote = await options.getProviderWithdrawalFeeQuote({
    asset: toCurrency,
    amount: receiveAfterPlatformFee,
    destinationType: 'crypto_address',
    network: resolvedChain,
  });

  const usable =
    feeQuote != null &&
    !feeQuote.feeUnavailable &&
    feeQuote.totalFee != null &&
    feeQuote.totalFee.currency.toUpperCase() === toCurrency.toUpperCase();

  let transferFeeCrypto = 0;
  if (usable && feeQuote) {
    const parsedFee = Number(feeQuote.totalFee!.amount);
    if (Number.isFinite(parsedFee) && parsedFee > 0) transferFeeCrypto = parsedFee;
  }

  if (transferFeeCrypto >= receiveAfterPlatformFee) {
    throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
  }

  const receiveNet = Math.max(0, receiveAfterPlatformFee - transferFeeCrypto);
  const expiresAt = parseQuoteExpiry();

  const quote: RampFeePreview = {
    sendGross: { amount: input.amount.toFixed(2), currency: fromCurrency },
    receiveGross: { amount: receiveGross.toFixed(8), currency: toCurrency },
    baseReceiveNet: { amount: receiveAfterPlatformFee.toFixed(8), currency: toCurrency },
    receiveNet: { amount: receiveNet.toFixed(8), currency: toCurrency },
    platformFee: {
      type: input.platformFee.type,
      value: input.platformFee.value,
      walletAddress: input.platformFee.walletAddress,
      ...(input.platformFee.currency?.trim()
        ? { currency: input.platformFee.currency.trim().toUpperCase() }
        : {}),
      ...(input.platformFee.network?.trim() ? { network: input.platformFee.network.trim() } : {}),
      amount: platformFeeAmount.toFixed(8),
    },
    transferFee: {
      fees: feeQuote?.fees ?? [],
      total: feeQuote?.totalFee ?? null,
      unavailable: !usable,
    },
  };

  const quoteInformation: QuoteInformation = {
    sendGross: quote.sendGross,
    sendNet: quote.sendGross,
    railFee: { amount: '0.00', currency: fromCurrency },
    receiveGross: quote.receiveGross,
    receiveNet: quote.receiveNet,
    rate: palremitQuote.conversionRate,
    expiresAt: expiresAt.toISOString(),
    transferFee: quote.transferFee,
  };

  const fees: OnrampFees = {
    platformFee: {
      type: input.platformFee.type,
      value: String(input.platformFee.value),
      amount: platformFeeAmount.toFixed(8),
      currency: toCurrency,
      walletAddress: input.platformFee.walletAddress,
      settlementCurrency: input.platformFee.currency?.trim().toUpperCase() || 'USDC',
      ...(input.platformFee.network?.trim()
        ? { settlementNetwork: input.platformFee.network.trim() }
        : {}),
    },
  };

  const profit = await buildPalremitProfit({
    sourceAmount: input.amount,
    toCurrency,
    rate: palremitQuote.conversionRate,
    marketRate: palremitQuote.marketRate ?? undefined,
    rateCurrency: palremitQuote.rateCurrency ?? undefined,
    perCurrency: palremitQuote.perCurrency ?? undefined,
    nowIso: new Date().toISOString(),
    convertToUsdc: options.convertToUsdc,
  }).catch(() => null);

  const snapshot: OnrampQuoteSnapshot = {
    version: 1,
    fromCurrency,
    toCurrency,
    destinationChain: resolvedChain,
    clientDestinationChain,
    sendAmount: input.amount,
    platformFee: input.platformFee,
    conversionRate: palremitQuote.conversionRate,
    rateValidUntil: expiresAt.toISOString(),
    receiveNet,
    quote,
    quoteInformation,
    fees,
    profit,
  };

  const row = await rampQuoteRepo.createRampQuote({
    rampType: 'onramp',
    payload: snapshot,
    expiresAt,
  });

  return {
    quoteId: row.id,
    expiresAt: row.expiresAt.toISOString(),
    fromCurrency,
    toCurrency,
    conversionRate: palremitQuote.conversionRate,
    rateValidUntil: expiresAt.toISOString(),
    quote,
  };
}
