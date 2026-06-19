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

/** Platform fee settlement lifecycle (post offramp completion). */
export type PlatformFeeSettlementStatus =
  | 'skipped'
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed';

export interface PlatformFeeSettlement {
  status: PlatformFeeSettlementStatus;
  /** Palremit Liquidity withdrawal id */
  withdrawalId?: string;
  /** On-chain transaction hash when available */
  transactionHash?: string;
  /** Why settlement was skipped or failed */
  notes?: string[];
  attemptedAt?: string;
  completedAt?: string;
}

/** Platform fee: PERCENTAGE (e.g. 0.01 = 1%) or FLAT amount. */
export interface PlatformFee {
  type: 'PERCENTAGE' | 'FLAT';
  value: number;
  walletAddress: string;
  /** Settlement asset — USDC expected; defaults to USDC when omitted */
  currency?: string;
  /** Palremit network code for fee payout (e.g. MATIC, ERC20) */
  network?: string;
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
  /**
   * USD offramp: **`isSelfTransfer`** and optional Palremit `destination` overrides (not bank core fields).
   * Transfer purpose is **`purposeOfPayment`** (same row), not duplicated in metadata.
   */
  metadata?: Record<string, unknown>;
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
    /** Source crypto currency the fee was computed in */
    currency: string;
    walletAddress: string;
    /** USDC settlement destination (from create request) */
    settlementCurrency?: string;
    settlementNetwork?: string;
    transactionHash?: string;
    settlement?: PlatformFeeSettlement;
  };
  railFee?: { amount: string; currency: string };
  networkFee?: { amount: string; currency: string; description?: string };
  /**
   * Palremit payout fee, itemized for transparency. Deducted from the receive
   * amount. `unavailable` is true when Palremit could not preview a fee
   * (the receive then reflects no provider-fee deduction).
   */
  transferFee?: {
    fees: Array<{ kind: string; amount: string; currency: string }>;
    total: { amount: string; currency: string } | null;
    unavailable: boolean;
  };
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

/**
 * Optional fee preview attached to a rate when enough quote inputs are given.
 * `netReceive` is `grossReceive` minus Palremit's payout fee (deduct-from-receive).
 * `transferFee.unavailable` means no fee could be previewed (no deduction applied).
 */
export interface RampFeePreviewPlatformFee {
  type: 'PERCENTAGE' | 'FLAT';
  /** PERCENTAGE: decimal fraction (0.01 = 1%). */
  value: number;
  walletAddress: string;
  currency?: string;
  network?: string;
  amount: string;
}

export interface RampFeePreview {
  // Money fields mirror the existing onramp QuoteInformation shape:
  // `{ amount, currency }` objects named sendGross / receiveGross / receiveNet.
  sendGross: { amount: string; currency: string };
  // Offramp only: the send amount AFTER the provider transfer fee has been
  // deducted (in the send currency). This is the amount that is converted at
  // the rate to produce `receiveNet`. Omitted for onramp, whose provider fee
  // is a crypto network fee denominated in the receive currency and is
  // deducted from the receive side instead.
  sendNet?: { amount: string; currency: string };
  receiveGross: { amount: string; currency: string };
  receiveNet: { amount: string; currency: string };
  /** Fiat receive after transfer fee, before platform markup (offramp quotes). */
  baseReceiveNet?: { amount: string; currency: string };
  /** BloxFi platform fee preview (ramp quotes). */
  platformFee?: RampFeePreviewPlatformFee;
  transferFee: {
    // Surfaced verbatim in the fee's own currency (for an offramp this is the
    // provider's funding-asset fee, e.g. USDC — NOT converted to the payout
    // fiat). `unavailable` is true when the fee could not be previewed or
    // priced, in which case no deduction is applied.
    fees: Array<{ kind: string; amount: string; currency: string }>;
    total: { amount: string; currency: string } | null;
    unavailable: boolean;
  };
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
  /** Fee preview, present only when amount + corridor inputs are supplied. */
  quote?: RampFeePreview;
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
  quoteId?: string;
  source: CreateOfframpSourceInput;
  destination: CreateOfframpDestinationInput;
  platformFee?: PlatformFee;
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
