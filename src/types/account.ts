/**
 * Fiat account types per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md §3.
 * BloxFi **Account** rows are **offramp payout destinations** only.
 */

export type RailType = 'onramp' | 'offramp';

export interface AccountHolder {
  type: 'business' | 'individual';
  name: string;
  firstName?: string; // required when rail='onramp', enforced by the Task 7 zod schema, not by this type
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  /** Onramp only — tax identifier (SSN/ITIN/etc.). */
  taxId?: string;
}

export interface RailInfo {
  currency: string;
  railType: RailType;
  paymentRail: string;
}

/** Palremit corridor tuple stored on the account. */
export interface PayoutCorridor {
  asset: string;
  country: string;
  destinationType: string;
  beneficiaryType: 'individual' | 'business';
}

/** Stored on Account.providerPayout — used for POST /v1/withdrawals at offramp. */
export interface ProviderPayout {
  provider: 'palremit';
  schemaVersion: 2;
  corridor: PayoutCorridor;
  /** Palremit canonical snake_case destination. */
  destination: Record<string, unknown>;
  requirementsSnapshot?: {
    fetchedAt: string;
    corridor?: Record<string, unknown>;
    destinationFields?: unknown[];
  };
}

/** Bank summary on API responses (derived from providerPayout.destination at read time). */
export interface RegionAccountDetails {
  country?: string | null;
  currency: string;
  accountNumber?: string | null;
  bankCode?: string | null;
  bankName?: string | null;
}

export interface Account {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  rail: RailInfo;
  /** Free-form label (persisted as `accountType`). */
  type: string;
  details: RegionAccountDetails | null;
  accountHolder?: AccountHolder | null;
  /** Offramp only — onramp rows have no Palremit payout corridor, this is undefined. */
  providerPayout?: ProviderPayout;
  /** SwipeLux customer id (cus_*) once known. Onramp only. */
  swipeluxCustomerId?: string | null;
  /** 'pending_import' | 'approved' | 'rejected' | 'failed'. Onramp only. */
  kycImportStatus?: string | null;
  /** SOF questionnaire answers (onramp). */
  sofQuestionnaire?: Record<string, unknown> | null;
  /** S3 object key for copied source-of-funds document (onramp). */
  sourceOfFundsDocumentPath?: string | null;
}

// --- Create Account (POST) ---

export interface CreateAccountRequest {
  rail: RailType;
  type: string;
  accountHolder: AccountHolder;
  corridor?: PayoutCorridor;             // was required; offramp-only now
  destination?: Record<string, unknown>; // was required; offramp-only now
  sumsubShareToken?: string;             // onramp-only; never persisted, never logged
  sofQuestionnaire?: Record<string, unknown>; // onramp-only
  /** HTTPS URL; may also appear inside sofQuestionnaire.sourceOfFundsDocument. */
  sourceOfFundsDocument?: string;
}

export interface CreateAccountResponse {
  status: 'ACTIVE';
  message: string;
  id: string;
}

// --- List Accounts (GET) ---

export interface ListAccountsQuery {
  rail?: RailType;
  type?: string;
  currency?: string;
  limit?: number;
  createdBefore?: string;
  createdAfter?: string;
}

export interface ListAccountsResponse {
  count: number;
  banks: Account[];
  nextCursor: string | null;
}

export type GetAccountResponse = Account;

export interface DeleteAccountResponse {
  status: 'INACTIVE';
  message: string;
  id: string;
}

// --- Update Account (PUT) ---

/** Partial canonical destination merge; corridor cannot change. */
export interface UpdateAccountRequest {
  destination: Record<string, unknown>;
}

export type UpdateAccountResponse = Account;
