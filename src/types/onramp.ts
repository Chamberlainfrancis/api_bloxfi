/**
 * Onramp types per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md §4.
 * Fee object: type (FIX | PERCENT) and value only per spec-clarifications §3.
 */

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

/** Onramp fee: complete as specified — type and value only (spec-clarifications §3). */
export interface OnrampFee {
  type: 'FIX' | 'PERCENT';
  value: number; // fixed amount or percentage (e.g. 0.01 = 1%)
}

export interface OnrampSource {
  userId: string;
  currency: string;
  amount: number;
  accountId?: string;
  transferType?: string;
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
  externalWalletId: string;
  amount: number;
  user?: {
    email: string;
    businessName?: string;
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
  beneficiary: { name: string; address: string };
  ach?: DepositInfoAch;
  wire?: DepositInfoWire;
  pix?: DepositInfoPix;
  reference: string;
  depositBy: string;
  instruction: string;
}

export interface Receipt {
  transactionHash: string;
}

export interface DeveloperFeeAmount {
  amount: string;
  currency: string;
}

export interface OnrampTransferDetails {
  id: string;
  requestId: string;
  status: OnrampStatus;
  createdAt: string;
  updatedAt: string;
  source: OnrampSource;
  destination: OnrampDestination;
  quoteInformation: QuoteInformation;
  depositInfo?: DepositInfo | null;
  receipt?: Receipt | null;
  developerFee?: DeveloperFeeAmount | null;
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
}

// --- POST /onramps (create) ---

export interface CreateOnrampSourceInput {
  amount: number;
  currency: string;
  userId: string;
  accountId: string;
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
  source: CreateOnrampSourceInput;
  destination: CreateOnrampDestinationInput;
  purposeOfPayment?: string;
  fee: OnrampFee;
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
