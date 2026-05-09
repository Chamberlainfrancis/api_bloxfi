/**
 * Offramp types per docs/bloxfi-api-specmd.md §5.
 * Crypto-to-fiat: rates, create, get, list, cancel.
 */

export type OfframpStatus =
  | 'CREATED'
  | 'AWAITING_CRYPTO'
  | 'CRYPTO_PENDING'
  | 'CRYPTO_RECEIVED'
  | 'CRYPTO_CONFIRMED'
  | 'PROCESSING_FEE'
  | 'FEE_PROCESSED'
  | 'FIAT_INITIATED'
  | 'FIAT_PENDING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'CRYPTO_FAILED'
  | 'FIAT_FAILED'
  | 'EXPIRED';

/** Platform fee: PERCENTAGE (e.g. 0.01 = 1%) or FLAT amount. */
export interface PlatformFee {
  type: 'PERCENTAGE' | 'FLAT';
  value: number;
  walletAddress: string;
}

export interface OfframpSource {
  userId: string;
  currency: string;
  amount: number;
  chain: string;
  externalWalletId?: string;
  walletAddress?: string;
  user?: {
    email: string;
    businessName?: string;
    firstName?: string;
    lastName?: string;
  };
}

export interface OfframpDestination {
  userId: string;
  currency: string;
  amount: number;
  accountId?: string;
  transferType?: string;
  bankTransferMethod?: string;
  reference?: string;
  purposeOfPayment: string;
  user?: {
    email: string;
    businessName?: string;
  };
}

export interface RateInformation {
  rate: string;
  conversionRate?: string;
  inverseRate: string;
  fromCurrency: string;
  toCurrency: string;
  fromChain?: string;
  expiresAt?: string;
}

export interface DepositInstructions {
  address: string;
  amount: string;
  currency: string;
  network: string;
  networkName?: string;
  token?: string;
  memo?: string;
  depositBy: string;
  instruction?: string;
}

export interface Timeline {
  createdAt?: string;
  cryptoReceivedAt?: string;
  fiatInitiatedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface OfframpFees {
  platformFee?: {
    type: 'PERCENTAGE' | 'FLAT';
    value: string;
    amount: string;
    currency: string;
    walletAddress: string;
    transactionHash?: string;
  };
  railFee?: { amount: string; currency: string };
  networkFee?: { amount: string; currency: string; description?: string };
  totalFees?: string;
}

export interface OfframpTransferDetails {
  id: string;
  requestId: string;
  /** BloxFi primary id (OFF-…); same value as `clientReference` and Palremit `client_reference`. */
  txnRef: string;
  /** Palremit Liquidity Orchestrator `client_reference`; identical to `txnRef` for this integration. */
  clientReference: string;
  status: OfframpStatus;
  createdAt: string;
  updatedAt: string;
  source: OfframpSource;
  destination: OfframpDestination;
  rateInformation: RateInformation;
  depositInstructions: DepositInstructions | null;
  timeline?: Timeline;
  fees?: OfframpFees | null;
  receipt?: { transactionHash?: string } | null;
  refundDetails?: RefundDetails | null;
  failedReason?: string | null;
}

export interface RefundDetails {
  status: string;
  refundedAt?: string;
  amount?: string;
  currency?: string;
  transactionHash?: string;
}

export interface OfframpResponse {
  transferType: 'OFFRAMP';
  transferDetails: OfframpTransferDetails;
}

// --- GET /offramps/rates ---

export interface GetOfframpRatesQuery {
  fromCurrency: string;
  toCurrency: string;
  fromChain?: string;
}

export interface OfframpRateLimits {
  minAmount?: string;
  maxAmount?: string;
  currency?: string;
}

export interface GetOfframpRatesResponse {
  fromCurrency: string;
  toCurrency: string;
  fromChain?: string;
  conversionRate: string;
  inverseRate: string;
  rateValidUntil: string;
  minimumAmount: string;
  maximumAmount: string;
  estimatedProcessingTime: string;
  limits?: OfframpRateLimits;
  availableRails?: Array<{
    rail: string;
    methods: string[];
    processingTime: string;
  }>;
}

// --- POST /offramps (create) ---

export interface CreateOfframpSourceInput {
  amount: number;
  currency: string;
  chain: string;
  userId: string;
  externalWalletId: string;
}

export interface CreateOfframpDestinationInput {
  currency: string;
  amount?: number;
  userId: string;
  accountId: string;
  transferType?: string;
  bankTransferMethod?: string;
  reference?: string;
  purposeOfPayment: string;
}

export interface CreateOfframpRequest {
  requestId: string;
  source: CreateOfframpSourceInput;
  destination: CreateOfframpDestinationInput;
  platformFee: PlatformFee;
  metadata?: Record<string, unknown>;
}

export type CreateOfframpResponse = OfframpResponse;

// --- GET /offramps/:id ---

export type GetOfframpResponse = OfframpResponse;

// --- GET /offramps (list) ---

export interface ListOfframpsQuery {
  userId?: string;
  status?: OfframpStatus;
  currency?: string;
  limit?: number;
  createdBefore?: string;
  createdAfter?: string;
}

export interface ListOfframpItem {
  id: string;
  status: OfframpStatus;
  createdAt: string;
  source: { currency: string; amount: number; chain: string };
  destination: { currency: string; amount: number };
}

export interface ListOfframpsResponse {
  count: number;
  offramps: ListOfframpItem[];
  nextCursor: string | null;
}

// --- POST /offramps/:id/cancel ---

export interface CancelOfframpResponse {
  transferType: 'OFFRAMP';
  transferDetails: OfframpTransferDetails;
  cancelled: true;
  cancelledAt?: string;
  reason?: string;
  refund?: {
    status: string;
    refundAddress: string;
  };
}
