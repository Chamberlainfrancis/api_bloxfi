/**
 * Fiat account types per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md §3.
 * Unified region schema per spec-clarifications §2: same shape for all regions; N/A fields null or "".
 * Africa: supported as specific countries (Nigeria, Ghana, Kenya, etc.) plus generic "africa" fallback.
 */

export type RailType = 'onramp' | 'offramp';

/** All supported account region/country codes (Americas, Africa-specific, generic africa). */
export const ACCOUNT_REGION_TYPES = [
  'us',
  'brazil',
  'colombia',
  'argentina',
  'mexico',
  'africa',
  'nigeria',
  'ghana',
  'kenya',
  'south_africa',
  'zimbabwe',
  'rwanda',
  'senegal',
] as const;

export type AccountRegionType = (typeof ACCOUNT_REGION_TYPES)[number];

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

/** Unified region-specific account details; N/A fields null or "" per spec-clarifications §2 */
export interface RegionAccountDetails {
  transferType?: string | null; // ach, wire, swift (US)
  accountType?: string | null; // Checking, Savings (US)
  accountNumber?: string | null;
  iban?: string | null;
  routingNumber?: string | null;
  swiftCode?: string | null;
  bankName?: string | null;
  bankCountry?: string | null;
  bankAddress?: Address | null;
  currency: string;
  pixKey?: string | null; // Brazil
}

export interface Account {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  rail: RailInfo;
  accountHolder?: AccountHolder | null;
  us?: RegionAccountDetails | null;
  brazil?: RegionAccountDetails | null;
  colombia?: RegionAccountDetails | null;
  argentina?: RegionAccountDetails | null;
  mexico?: RegionAccountDetails | null;
  africa?: RegionAccountDetails | null;
  nigeria?: RegionAccountDetails | null;
  ghana?: RegionAccountDetails | null;
  kenya?: RegionAccountDetails | null;
  south_africa?: RegionAccountDetails | null;
  zimbabwe?: RegionAccountDetails | null;
  rwanda?: RegionAccountDetails | null;
  senegal?: RegionAccountDetails | null;
}

// --- Create Account (POST) ---

export interface CreateAccountRequest {
  rail: RailType;
  type: AccountRegionType;
  accountHolder: AccountHolder;
  us?: RegionAccountDetails | null;
  brazil?: RegionAccountDetails | null;
  colombia?: RegionAccountDetails | null;
  argentina?: RegionAccountDetails | null;
  mexico?: RegionAccountDetails | null;
  africa?: RegionAccountDetails | null;
  nigeria?: RegionAccountDetails | null;
  ghana?: RegionAccountDetails | null;
  kenya?: RegionAccountDetails | null;
  south_africa?: RegionAccountDetails | null;
  zimbabwe?: RegionAccountDetails | null;
  rwanda?: RegionAccountDetails | null;
  senegal?: RegionAccountDetails | null;
}

export interface CreateAccountResponse {
  status: 'ACTIVE';
  message: string;
  id: string;
}

// --- List Accounts (GET) ---

export interface ListAccountsQuery {
  rail?: RailType;
  type?: AccountRegionType;
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
