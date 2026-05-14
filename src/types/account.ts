/**
 * Fiat account types per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md §3.
 * BloxFi **Account** rows are **offramp payout destinations** only; onramp fiat uses Palremit provisioned accounts + **ExternalWallet** for crypto destination.
 */

export type RailType = 'onramp' | 'offramp';

export interface Address {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  stateProvinceRegion?: string | null;
  postalCode: string;
  country: string;
}

export interface AccountHolder {
  type: 'business' | 'individual';
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: Address | null;
  idType?: string | null;
  idNumber?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  formationDate?: string | null;
}

export interface RailInfo {
  currency: string;
  railType: RailType;
  paymentRail: string; // e.g. "ach", "wire", "pix", "spei"
}

/**
 * USD settlement on the account: payout rail, account holder as credited, beneficiary (+ address).
 * Stored at `details.transferDetails`.
 * Transfer purpose is **`destination.purposeOfPayment`** on the offramp; **`metadata.isSelfTransfer`**
 * maps to Palremit `extras.is_self_transfer`.
 */
export interface UsdTransferDetails {
  payoutRail: string;
  accountHolderName: string;
  beneficiary: {
    name: string;
    /** When omitted on create, API copies `accountHolder.type`. */
    type?: 'individual' | 'business';
    address: {
      street: string;
      city: string;
      stateProvince: string;
      postalCode: string;
      country: string;
    };
  };
}

/** Bank / rail-specific fields; N/A fields null or "" per spec-clarifications §2 */
export interface RegionAccountDetails {
  /** Free-form country or jurisdiction for this bank account (stored as provided). */
  country?: string | null;
  transferType?: string | null; // ach, wire (US)
  accountType?: string | null; // Checking, Savings (US)
  /** US domestic account number or international IBAN — one field for all USD/global bank payouts. */
  accountNumber?: string | null;
  routingNumber?: string | null;
  /** USD global bank → Palremit `destination.bank_code` (e.g. US ABA routing, international BIC). */
  bankCode?: string | null;
  bankName?: string | null;
  bankCountry?: string | null;
  bankAddress?: Address | null;
  currency: string;
  pixKey?: string | null; // Brazil
  /** USD: rail, beneficiary, settlement fields for Palremit global-bank offramps. */
  transferDetails?: UsdTransferDetails | null;
}

export interface Account {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  rail: RailInfo;
  /** Free-form region / corridor label (persisted as `accountType`). */
  type: string;
  details: RegionAccountDetails | null;
  accountHolder?: AccountHolder | null;
}

// --- Create Account (POST) ---

export interface CreateAccountRequest {
  /** Must be `offramp` (BloxFi accounts are payout destinations for offramps only). */
  rail: RailType;
  /** Non-empty region or corridor label (stored verbatim after trim). */
  type: string;
  accountHolder: AccountHolder;
  details: RegionAccountDetails;
}

export interface CreateAccountResponse {
  status: 'ACTIVE';
  message: string;
  id: string;
}

// --- List Accounts (GET) ---

export interface ListAccountsQuery {
  /** Filter by stored rail (`onramp` / `offramp`). When omitted, only `offramp` rows are returned. */
  rail?: RailType;
  /** Filter by stored region label (`accountType`). */
  type?: string;
  currency?: string;
  limit?: number;
  createdBefore?: string;
  createdAfter?: string;
}

export interface ListAccountsResponse {
  count: number;
  banks: Account[]; // accountNumber masked (e.g. ****6789)
  nextCursor: string | null;
}

// --- Get Account (GET) ---

export type GetAccountResponse = Account;

// --- Delete Account (DELETE) ---

export interface DeleteAccountResponse {
  status: 'INACTIVE';
  message: string;
  id: string;
}
