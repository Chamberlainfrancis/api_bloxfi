/**
 * Onramp types per docs/bloxfi-api-specmd.md §4.
 * Platform fee uses the same request shape as offramp (no automatic settlement payout).
 */

import type { PlatformFee, RampFeePreview } from '@/types/offramp';

export type OnrampStatus =
  | 'CREATED'
  | 'AWAITING_FUNDS'
  | 'FIAT_PENDING'
  | 'FIAT_PROCESSED'
  | 'CRYPTO_INITIATED'
  | 'CRYPTO_PENDING'
  | 'COMPLETED'
  | 'FIAT_FAILED'
  | 'FIAT_RETURNED'
  | 'CRYPTO_FAILED'
  | 'EXPIRED';

export interface OnrampFees {
  platformFee?: {
    type: 'PERCENTAGE' | 'FLAT';
    value: string;
    amount: string;
    /** Receive crypto currency the fee was computed in */
    currency: string;
    walletAddress: string;
    /** USDC settlement destination (from create request) */
    settlementCurrency?: string;
    settlementNetwork?: string;
  };
}

export interface OnrampSource {
  userId: string;
  currency: string;
  amount: number;
  /** Optional label for fiat rail (e.g. ach); not a BloxFi account id. */
  transferType?: string;
  /** @deprecated Legacy rows only; onramps no longer link Account records. */
  accountId?: string;
  user?: {
    email: string;
    businessName?: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface OnrampDestination {
  userId: string;
  currency: string;
  chain: string;
  walletAddress: string;
  /** Copied from external wallet when present; forwarded to LP crypto withdrawal `destination.memo`. */
  memo?: string;
  externalWalletId: string;
  amount: number;
  user?: {
    email: string;
    businessName?: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface QuoteInformation {
  sendGross: { amount: string; currency: string };
  sendNet: { amount: string; currency: string };
  railFee: { amount: string; currency: string };
  receiveGross: { amount: string; currency: string };
  receiveNet: { amount: string; currency: string };
  rate: string;
  expiresAt?: string;
  /**
   * Palremit payout (crypto network) fee, itemized for transparency. Deducted
   * from the receive amount. `unavailable` is true when Palremit could not
   * preview a fee (the receive then reflects no provider-fee deduction).
   */
  transferFee?: {
    fees: Array<{ kind: string; amount: string; currency: string }>;
    total: { amount: string; currency: string } | null;
    unavailable: boolean;
  };
}

export interface DepositInfoAch {
  routingNumber: string;
  accountNumber: string;
}

export interface DepositInfoWire {
  routingNumber: string;
  accountNumber: string;
}

export interface DepositInfoPix {
  pixKey: string;
}

export interface DepositInfo {
  bankName: string;
  beneficiary: { name: string; address: string; country?: string };
  ach?: DepositInfoAch;
  wire?: DepositInfoWire;
  pix?: DepositInfoPix;
  reference: string;
  depositBy: string;
  instruction: string;
}

export interface Receipt {
  transactionHash?: string;
  txnRef?: string;
  /** ISO timestamp when LP confirmed crypto payout (`withdrawal.successful`). */
  completedAt?: string;
  /** @deprecated Legacy prepare step; use palremitWithdrawalId */
  palremitPrepareReference?: string;
  /** Palremit Liquidity Orchestrator withdrawal id (Mongo ObjectId hex). */
  palremitWithdrawalId?: string;
  destinationTxId?: string;
  awaitingWebhookConfirmation?: boolean;
  provider?: string;
}

export interface OnrampTransferDetails {
  id: string;
  requestId: string;
  /** BloxFi primary id (ON-…); same value as `clientReference` and Palremit `client_reference`. */
  txnRef: string;
  /** Palremit Liquidity Orchestrator `client_reference`; identical to `txnRef` for this integration. */
  clientReference: string;
  status: OnrampStatus;
  createdAt: string;
  updatedAt: string;
  source: OnrampSource;
  destination: OnrampDestination;
  quoteInformation: QuoteInformation;
  depositInfo?: DepositInfo | null;
  receipt?: Receipt | null;
  fees?: OnrampFees | null;
  failedReason?: string | null;
}

export interface OnrampResponse {
  transferType: 'ONRAMP';
  transferDetails: OnrampTransferDetails;
}

// --- GET /onramps/rates ---

export interface GetOnrampRatesQuery {
  fromCurrency: string;
  toCurrency: string;
}

export interface ConversionRateByTransfer {
  transferType: string;
  conversionRate: string;
}

export interface GetOnrampRatesResponse {
  fromCurrency: string;
  toCurrency: string;
  conversionRate: string;
  conversionRates?: ConversionRateByTransfer[];
  /** Fee preview, present only when amount + chain inputs are supplied. */
  quote?: RampFeePreview;
}

// --- POST /onramps (create) ---

export interface CreateOnrampSourceInput {
  amount: number;
  currency: string;
  userId: string;
  transferType?: string;
}

export interface CreateOnrampDestinationInput {
  currency: string;
  chain: string;
  userId: string;
  externalWalletId: string;
}

export interface CreateOnrampRequest {
  requestId: string;
  quoteId?: string;
  source: CreateOnrampSourceInput;
  destination: CreateOnrampDestinationInput;
  purposeOfPayment?: string;
  platformFee?: PlatformFee;
}

export type CreateOnrampResponse = OnrampResponse;

// --- GET /onramps/:onrampId ---

export type GetOnrampResponse = OnrampResponse;

// --- GET /onramps (list) ---

export interface ListOnrampsQuery {
  userId?: string;
  status?: OnrampStatus;
  currency?: string;
  limit?: number;
  createdBefore?: string;
  createdAfter?: string;
}

export interface ListOnrampItem {
  id: string;
  status: OnrampStatus;
  createdAt: string;
  source: { currency: string; amount: number };
  destination: { currency: string; amount: number; chain: string };
}

export interface ListOnrampsResponse {
  count: number;
  onramps: ListOnrampItem[];
  nextCursor: string | null;
}
