/**
 * User & KYB types per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md §1.
 * Request/response DTOs for User Creation and KYB workflow.
 */

// --- Entity types (spec §1 Data Models) ---

export type EntityType =
  | 'LIMITED_COMPANY'
  | 'PUBLIC_LIMITED_COMPANY'
  | 'PARTNERSHIP'
  | 'SOLE_PROPRIETORSHIP'
  | 'NON_PROFIT'
  | 'TRUST';

export type KYBStatus =
  | 'not_started'
  | 'incomplete'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'suspended';

export type UserStatus = 'active' | 'inactive' | 'suspended';

export interface Address {
  addressLine1: string;
  addressLine2?: string;
  city: string;
  stateProvinceRegion?: string;
  postalCode: string;
  country: string; // ISO 3166-1 alpha-3
}

export interface BusinessInfo {
  legalName: string;
  tradingName?: string;
  registrationNumber: string;
  entityType: EntityType;
  dateOfIncorporation: string; // ISO 8601
  taxIdentificationNumber: string;
  website?: string;
  industry: string;
  email: string;
  phone: string;
}

export interface LegalRepresentative {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string; // ISO 8601
  position: string;
  address: Address;
}

export interface BeneficialOwner {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO 8601
  nationality: string; // ISO 3166-1 alpha-3
  ownershipPercentage: number; // 0–100
  isPoliticallyExposed: boolean;
  address: Address;
}

export interface Director {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality: string;
  position: string;
  isPoliticallyExposed: boolean;
}

// --- 1.1 Create Business User ---

export interface CreateUserRequest {
  type: 'business';
  requestId: string;
  businessInfo: BusinessInfo;
  registeredAddress: Address;
  legalRepresentative: LegalRepresentative;
  metadata?: Record<string, unknown>;
}

/** Response 201: id, type, status, businessInfo (subset), kybStatus, createdAt */
export interface CreateUserResponse {
  id: string;
  type: 'business';
  status: UserStatus;
  businessInfo: {
    legalName: string;
    tradingName?: string;
    email: string;
  };
  kybStatus: KYBStatus;
  createdAt: string; // ISO 8601
}

// --- 1.2 Get User Details ---

/** Response 200: full user with approvedRails, updatedAt */
export interface GetUserResponse {
  id: string;
  type: 'business';
  status: UserStatus;
  businessInfo: {
    legalName: string;
    tradingName?: string;
    registrationNumber: string;
    entityType: EntityType;
    email: string;
  };
  kybStatus: KYBStatus;
  approvedRails: string[];
  createdAt: string;
  updatedAt: string;
}

// --- 1.3 Update KYB Information ---

export interface BusinessDetails {
  numberOfEmployees?: string;
  annualRevenue?: string;
  sourceOfFunds?: string;
  purposeOfAccount?: string;
  expectedMonthlyVolume?: string;
  businessDescription?: string;
}

export interface UpdateKybRequest {
  businessDetails?: BusinessDetails;
  beneficialOwners?: BeneficialOwner[];
  directors?: Director[];
}

/** Response 200: status, missingFields, nextSteps */
export interface UpdateKybResponse {
  status: string; // e.g. "information_received"
  missingFields: string[];
  nextSteps: string[];
}

// --- 1.6 Submit KYB Application ---

export interface SubmitKybRequest {
  rails: string[]; // e.g. ["USD", "EUR", "GBP"]
  priority?: string; // e.g. "standard"
}

/** Response 201: submissionId, status, rails, submittedAt, estimatedCompletionDate */
export interface SubmitKybResponse {
  submissionId: string;
  status: string; // e.g. "under_review"
  rails: string[];
  submittedAt: string; // ISO 8601
  estimatedCompletionDate: string; // ISO 8601
}

// --- 1.7 Check KYB Status ---

export interface RailStatusItem {
  rail: string;
  status: string; // e.g. "approved", "under_review"
  approvedAt?: string; // ISO 8601
  submittedAt?: string; // ISO 8601
  capabilities?: string[]; // e.g. ["onramp", "offramp"]
}

/** Response 200: userId, overallStatus, railStatuses, lastUpdated */
export interface GetKybStatusResponse {
  userId: string;
  overallStatus: KYBStatus;
  railStatuses: RailStatusItem[];
  lastUpdated: string; // ISO 8601
}
