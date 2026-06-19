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
