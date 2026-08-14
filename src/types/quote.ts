/**
 * Locked ramp quotes (POST /offramps/quotes, POST /onramps/quotes).
 */

import type {
  OfframpFees,
  PlatformFee,
  RampFeePreview,
  RampFeePreviewPlatformFee,
  RateInformation,
} from '@/types/offramp';
import type { OnrampFees, QuoteInformation } from '@/types/onramp';
import type { PalremitProfit } from '@/core/quotes/rateSpread';

export type { RampFeePreviewPlatformFee };

export interface OfframpQuoteCorridor {
  country: string;
  destinationType: string;
  beneficiaryType?: 'individual' | 'business';
}

/** Persisted snapshot for offramp quote → create hydration. */
export interface OfframpQuoteSnapshot {
  version: 1;
  fromCurrency: string;
  toCurrency: string;
  /** Palremit-resolved network code. */
  fromChain: string;
  clientFromChain: string;
  sendAmount: number;
  corridor: OfframpQuoteCorridor;
  platformFee: PlatformFee;
  baseConversionRate: string;
  conversionRate: string;
  inverseRate: string;
  rateValidUntil: string;
  destinationAmount: number;
  quote: RampFeePreview;
  fees: OfframpFees;
  profit?: PalremitProfit | null;
  rateInformation: RateInformation;
}

export interface OfframpQuoteResponse {
  quoteId: string;
  expiresAt: string;
  fromCurrency: string;
  toCurrency: string;
  fromChain: string;
  conversionRate: string;
  baseConversionRate: string;
  inverseRate: string;
  rateValidUntil: string;
  minimumAmount: string;
  maximumAmount: string;
  estimatedProcessingTime: string;
  quote: RampFeePreview;
}

/** Capability + currency markup applied at quote time (named USD today). */
export interface OnrampQuoteMarkup {
  capability: string;
  currency: string;
  markup: number;
}

/** Persisted snapshot for onramp quote → create hydration. */
export interface OnrampQuoteSnapshot {
  version: 1;
  fromCurrency: string;
  toCurrency: string;
  destinationChain: string;
  clientDestinationChain: string;
  sendAmount: number;
  platformFee: PlatformFee;
  conversionRate: string;
  rateValidUntil: string;
  receiveNet: number;
  quote: RampFeePreview;
  quoteInformation: QuoteInformation;
  fees: OnrampFees;
  profit?: PalremitProfit | null;
  /** Set when the quote was created with accountId. */
  accountId?: string;
  /** Applied rule, or null when accountId was present but no config hit. */
  markup?: OnrampQuoteMarkup | null;
  marketRate?: string;
  rateCurrency?: string;
  perCurrency?: string;
}

export interface OnrampQuoteResponse {
  quoteId: string;
  expiresAt: string;
  fromCurrency: string;
  toCurrency: string;
  conversionRate: string;
  rateValidUntil: string;
  quote: RampFeePreview;
}
