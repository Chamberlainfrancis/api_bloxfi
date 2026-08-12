/**
 * Build Graph-capable USD FIAT_DEPOSIT_KYC input.
 * Individual: from onramp Account (accountHolder + sofQuestionnaire + metadata.documents).
 * Business: from User fields + metadata extras (legacy / unused once Briana uses individual).
 * Fail closed: never invent document URLs or background answers.
 */

import type { AccountMetadataDocument } from '@/types/account';
import {
  alpha2ToAlpha3,
  alpha3ToAlpha2,
  isValid as isValidCountryCode,
} from 'i18n-iso-countries';

export type GraphOnrampKycFieldIssue = {
  field: string;
  reason: 'required' | 'invalid';
  /** Human-readable detail when `reason` is `invalid`. */
  detail?: string;
};

export class GraphOnrampKycError extends Error {
  /** Field paths with problems (API-compat name; includes invalid as well as missing). */
  readonly missingFields: string[];
  /** Per-field reason: `required` or a short invalid detail. */
  readonly fieldErrors: Record<string, string>;
  /** Stable machine code for logs / support; not shown in the default message. */
  readonly code = 'USD_ONRAMP_KYC_INCOMPLETE' as const;

  constructor(issues: Array<string | GraphOnrampKycFieldIssue>) {
    const normalized: GraphOnrampKycFieldIssue[] = issues.map((i) =>
      typeof i === 'string' ? { field: i, reason: 'required' } : i
    );
    const byField = new Map<string, GraphOnrampKycFieldIssue>();
    for (const issue of normalized) {
      const prev = byField.get(issue.field);
      // Prefer invalid over required when both are reported for the same field.
      if (!prev || (prev.reason === 'required' && issue.reason === 'invalid')) {
        byField.set(issue.field, issue);
      }
    }
    const unique = [...byField.values()].sort((a, b) => a.field.localeCompare(b.field));
    const missingFields = unique.map((i) => i.field);
    const fieldErrors = Object.fromEntries(
      unique.map((i) => [
        i.field,
        i.reason === 'required' ? 'required' : (i.detail ?? 'invalid'),
      ])
    );
    const messageParts = unique.map((i) =>
      i.reason === 'required'
        ? `${i.field} is required`
        : `${i.field}: ${i.detail ?? 'invalid'}`
    );
    // Client-facing: no provider name. Internal code stays on `code` / `name`.
    super(`USD KYC validation failed: ${messageParts.join('; ')}`);
    this.name = 'GraphOnrampKycError';
    this.missingFields = missingFields;
    this.fieldErrors = fieldErrors;
  }
}

function issueRequired(field: string): GraphOnrampKycFieldIssue {
  return { field, reason: 'required' };
}

function issueInvalid(field: string, detail: string): GraphOnrampKycFieldIssue {
  return { field, reason: 'invalid', detail };
}

export type GraphOnrampKycDocument = {
  type: string;
  url: string;
  issue_date?: string;
  expiry_date?: string;
};

export type GraphOnrampKycBackground = {
  employment_status: 'employed' | 'self_employed' | 'unemployed' | 'student' | 'retired';
  occupation?: string;
  primary_purpose: 'business' | 'personal' | 'salary' | 'freelance';
  source_of_funds:
    | 'salary'
    | 'savings'
    | 'business'
    | 'freelance'
    | 'investment'
    | 'government_benefits'
    | 'pension';
  expected_monthly_inflow: number;
};

export type GraphOnrampKycUboExtras = {
  id_type?: 'passport' | 'drivers_license' | 'national_id' | 'voters_card';
  id_number?: string;
  id_country?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  date_of_birth?: string;
  address_line1?: string;
  address_line2?: string;
  address_city?: string;
  address_state?: string;
  address_postal_code?: string;
  address_country?: string;
};

/**
 * User-shaped fields plus Graph-only extras (documents / background / UBO id).
 * Extras may also be supplied via `user.metadata.graphOnrampKyc` upstream.
 */
export type GraphOnrampKycSource = {
  businessInfo?: unknown;
  registeredAddress?: unknown;
  legalRepresentative?: unknown;
  documents?: GraphOnrampKycDocument[];
  background_information?: GraphOnrampKycBackground;
  ubo?: GraphOnrampKycUboExtras;
  business_id_type?: string;
  business_industry?: string;
  business_type?: string;
};

function asRecord(x: unknown): Record<string, unknown> | null {
  if (x != null && typeof x === 'object' && !Array.isArray(x)) {
    return x as Record<string, unknown>;
  }
  return null;
}

function str(x: unknown): string {
  return typeof x === 'string' ? x.trim() : '';
}

/** YYYY-MM-DD from ISO datetime or already-date string. */
function toDateOnly(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : raw;
}

function toAlpha3(country: string): string | null {
  const n = country.trim().toUpperCase();
  if (!n || !isValidCountryCode(n)) return null;
  if (/^[A-Z]{3}$/.test(n)) return n;
  if (/^[A-Z]{2}$/.test(n)) return alpha2ToAlpha3(n) ?? null;
  return null;
}

function toAlpha2(country: string): string | null {
  const n = country.trim().toUpperCase();
  if (!n || !isValidCountryCode(n)) return null;
  if (/^[A-Z]{2}$/.test(n)) return n;
  if (/^[A-Z]{3}$/.test(n)) return alpha3ToAlpha2(n) ?? null;
  return null;
}

const ENTITY_TYPE_TO_GRAPH: Readonly<Record<string, string>> = {
  LIMITED_COMPANY: 'llc',
  PUBLIC_LIMITED_COMPANY: 'corporation',
  PARTNERSHIP: 'partnership',
  SOLE_PROPRIETORSHIP: 'sole_proprietorship',
  NON_PROFIT: 'nonprofit',
  TRUST: 'trust',
};

const ENTITY_TYPE_TO_BUSINESS_TYPE: Readonly<Record<string, string>> = {
  LIMITED_COMPANY: 'limitedLiabilityCompany',
  PUBLIC_LIMITED_COMPANY: 'corporation',
  PARTNERSHIP: 'partnership',
  SOLE_PROPRIETORSHIP: 'soleProprietorship',
  NON_PROFIT: 'nonprofit',
  TRUST: 'trust',
};

function isE164(phone: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phone);
}

function mapAddress(addr: Record<string, unknown> | null): {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postal: string;
  countryAlpha3: string | null;
  countryAlpha2: string | null;
} {
  const line1 = str(addr?.addressLine1 ?? addr?.address_line1);
  const line2 = str(addr?.addressLine2 ?? addr?.address_line2) || undefined;
  const city = str(addr?.city ?? addr?.address_city);
  const state = str(addr?.stateProvinceRegion ?? addr?.state ?? addr?.address_state);
  const postal = str(addr?.postalCode ?? addr?.address_postal_code);
  const countryRaw = str(addr?.country ?? addr?.address_country);
  return {
    line1,
    ...(line2 ? { line2 } : {}),
    city,
    state,
    postal,
    countryAlpha3: countryRaw ? toAlpha3(countryRaw) : null,
    countryAlpha2: countryRaw ? toAlpha2(countryRaw) : null,
  };
}

/**
 * Build Graph business `kyc_input`. Throws {@link GraphOnrampKycError} listing missing fields.
 */
export function buildGraphBusinessKycInput(source: GraphOnrampKycSource): Record<string, unknown> {
  const missing: string[] = [];
  const biz = asRecord(source.businessInfo) ?? {};
  const registered = mapAddress(asRecord(source.registeredAddress));
  const lr = asRecord(source.legalRepresentative) ?? {};
  const lrAddr = mapAddress(asRecord(lr.address));
  const uboExtra = source.ubo ?? {};

  const entityName = str(biz.legalName ?? biz.tradingName);
  const email = str(biz.email) || str(lr.email);
  const phoneNumber = str(biz.phone);
  const contactFirst = str(lr.firstName) || str(uboExtra.first_name);
  const contactLast = str(lr.lastName) || str(uboExtra.last_name);
  const website = str(biz.website);
  const entityType = str(biz.entityType);
  const registrationNumber = str(biz.registrationNumber);
  const taxId = str(biz.taxIdentificationNumber);
  const dateOfIncorporation = str(biz.dateOfIncorporation);
  const industry = str(source.business_industry) || str(biz.industry);
  const businessIdType = str(source.business_id_type);
  const businessType =
    str(source.business_type) ||
    (entityType ? ENTITY_TYPE_TO_BUSINESS_TYPE[entityType] : '') ||
    (entityType ? ENTITY_TYPE_TO_GRAPH[entityType] : '');

  const jurisdiction = registered.countryAlpha2;
  const bizCountry3 = registered.countryAlpha3;

  const issues: GraphOnrampKycFieldIssue[] = [];
  const registeredCountryRaw = str(
    (asRecord(source.registeredAddress) ?? {}).country ??
      (asRecord(source.registeredAddress) ?? {}).address_country
  );

  if (!entityName) issues.push(issueRequired('entity_name'));
  if (!email) issues.push(issueRequired('email'));
  if (!contactFirst) issues.push(issueRequired('contact_first_name'));
  if (!contactLast) issues.push(issueRequired('contact_last_name'));
  if (!phoneNumber) issues.push(issueRequired('phone_number'));
  else if (!isE164(phoneNumber)) {
    issues.push(issueInvalid('phone_number', 'must be E.164 (+country code)'));
  }
  if (!website) issues.push(issueRequired('websites'));
  if (!registeredCountryRaw) issues.push(issueRequired('jurisdiction'));
  else if (!jurisdiction) {
    issues.push(issueInvalid('jurisdiction', 'must be a valid ISO 3166 country code'));
  }
  if (!industry) issues.push(issueRequired('business_industry'));
  if (!businessIdType) issues.push(issueRequired('business_id_type'));
  if (!registrationNumber && !taxId) issues.push(issueRequired('business_id_number'));
  if (!dateOfIncorporation) issues.push(issueRequired('business_dof'));
  if (!registered.line1) issues.push(issueRequired('address_line1'));
  if (!registered.city) issues.push(issueRequired('address_city'));
  if (!registered.state) issues.push(issueRequired('address_state'));
  if (!registered.postal) issues.push(issueRequired('address_postal_code'));
  if (!registeredCountryRaw) issues.push(issueRequired('address_country'));
  else if (!bizCountry3) {
    issues.push(issueInvalid('address_country', 'must be a valid ISO 3166 country code'));
  }

  const uboFirst = str(uboExtra.first_name) || contactFirst;
  const uboLast = str(uboExtra.last_name) || contactLast;
  const uboPhone = str(uboExtra.phone) || str(lr.phone) || phoneNumber;
  const uboEmail = str(uboExtra.email) || str(lr.email) || email;
  const uboDob = toDateOnly(str(uboExtra.date_of_birth) || str(lr.dateOfBirth));
  const uboIdType = uboExtra.id_type;
  const uboIdNumber = str(uboExtra.id_number);
  const uboIdCountryRaw = str(uboExtra.id_country) || lrAddr.countryAlpha2 || jurisdiction || '';
  const uboIdCountry = uboExtra.id_country
    ? toAlpha2(uboExtra.id_country)
    : lrAddr.countryAlpha2 ?? jurisdiction;

  const uboLine1 = str(uboExtra.address_line1) || lrAddr.line1;
  const uboCity = str(uboExtra.address_city) || lrAddr.city;
  const uboState = str(uboExtra.address_state) || lrAddr.state;
  const uboPostal = str(uboExtra.address_postal_code) || lrAddr.postal;
  const uboCountryRaw =
    str(uboExtra.address_country) ||
    (lrAddr.countryAlpha3 ?? lrAddr.countryAlpha2 ?? bizCountry3 ?? '');
  const uboCountry3 = uboCountryRaw ? toAlpha3(uboCountryRaw) : null;

  if (!uboFirst) issues.push(issueRequired('ubo.first_name'));
  if (!uboLast) issues.push(issueRequired('ubo.last_name'));
  if (!uboPhone) issues.push(issueRequired('ubo.phone'));
  else if (!isE164(uboPhone)) {
    issues.push(issueInvalid('ubo.phone', 'must be E.164 (+country code)'));
  }
  if (!uboEmail) issues.push(issueRequired('ubo.email'));
  if (!str(uboExtra.date_of_birth) && !str(lr.dateOfBirth)) {
    issues.push(issueRequired('ubo.date_of_birth'));
  } else if (!uboDob || !/^\d{4}-\d{2}-\d{2}$/.test(uboDob)) {
    issues.push(issueInvalid('ubo.date_of_birth', 'must be YYYY-MM-DD'));
  }
  if (!uboIdType) issues.push(issueRequired('ubo.id_type'));
  if (!uboIdNumber) issues.push(issueRequired('ubo.id_number'));
  if (!uboIdCountryRaw) issues.push(issueRequired('ubo.id_country'));
  else if (!uboIdCountry) {
    issues.push(issueInvalid('ubo.id_country', 'must be a valid ISO 3166 country code'));
  }
  if (!uboLine1) issues.push(issueRequired('ubo.address_line1'));
  if (!uboCity) issues.push(issueRequired('ubo.address_city'));
  if (!uboState) issues.push(issueRequired('ubo.address_state'));
  if (!uboPostal) issues.push(issueRequired('ubo.address_postal_code'));
  if (!uboCountryRaw) issues.push(issueRequired('ubo.address_country'));
  else if (!uboCountry3) {
    issues.push(issueInvalid('ubo.address_country', 'must be a valid ISO 3166 country code'));
  }

  if (!source.background_information) issues.push(issueRequired('background_information'));
  if (!source.documents?.length) issues.push(issueRequired('documents'));
  else {
    for (let i = 0; i < source.documents.length; i++) {
      const d = source.documents[i]!;
      if (!str(d.type) || !str(d.url) || !/^https?:\/\//i.test(d.url)) {
        issues.push(issueRequired(`documents[${i}]`));
      }
    }
  }

  if (issues.length > 0) {
    throw new GraphOnrampKycError(issues);
  }

  const businessIdNumber = registrationNumber || taxId;
  const documents = source.documents!.map((d) => {
    const out: GraphOnrampKycDocument = { type: d.type.trim(), url: d.url.trim() };
    if (d.issue_date) out.issue_date = d.issue_date;
    if (d.expiry_date) out.expiry_date = d.expiry_date;
    return out;
  });

  return {
    customer_type: 'business',
    email,
    contact_first_name: contactFirst,
    contact_last_name: contactLast,
    entity_name: entityName,
    jurisdiction: jurisdiction!,
    websites: [website],
    phone_number: phoneNumber,
    ...(entityType && ENTITY_TYPE_TO_GRAPH[entityType]
      ? { entity_type: ENTITY_TYPE_TO_GRAPH[entityType] }
      : {}),
    registration_number: businessIdNumber,
    business_industry: industry,
    ...(businessType ? { business_type: businessType } : {}),
    business_dof: toDateOnly(dateOfIncorporation),
    business_id_type: businessIdType,
    business_id_number: businessIdNumber,
    address_line1: registered.line1,
    ...(registered.line2 ? { address_line2: registered.line2 } : {}),
    address_city: registered.city,
    address_state: registered.state,
    address_postal_code: registered.postal,
    address_country: bizCountry3!,
    ubo: {
      first_name: uboFirst,
      last_name: uboLast,
      phone: uboPhone,
      email: uboEmail,
      date_of_birth: uboDob,
      id_type: uboIdType,
      id_number: uboIdNumber,
      id_country: uboIdCountry,
      address_line1: uboLine1,
      ...(str(uboExtra.address_line2) || lrAddr.line2
        ? { address_line2: str(uboExtra.address_line2) || lrAddr.line2 }
        : {}),
      address_city: uboCity,
      address_state: uboState,
      address_postal_code: uboPostal,
      address_country: uboCountry3!,
    },
    background_information: source.background_information,
    documents,
  };
}

/** Read Graph extras from User.metadata.graphOnrampKyc when present. */
export function graphKycExtrasFromUserMetadata(metadata: unknown): Partial<GraphOnrampKycSource> {
  const meta = asRecord(metadata);
  const g = asRecord(meta?.graphOnrampKyc);
  if (!g) return {};
  const out: Partial<GraphOnrampKycSource> = {};
  if (Array.isArray(g.documents)) {
    out.documents = g.documents as GraphOnrampKycDocument[];
  }
  if (g.background_information != null && typeof g.background_information === 'object') {
    out.background_information = g.background_information as GraphOnrampKycBackground;
  }
  if (g.ubo != null && typeof g.ubo === 'object') {
    out.ubo = g.ubo as GraphOnrampKycUboExtras;
  }
  if (typeof g.business_id_type === 'string') out.business_id_type = g.business_id_type;
  if (typeof g.business_industry === 'string') out.business_industry = g.business_industry;
  if (typeof g.business_type === 'string') out.business_type = g.business_type;
  return out;
}

/** User.metadata.graphUsdNamedDeposits === true opts a business into Graph USD named deposits. */
export function isGraphUsdNamedDepositsEnabled(metadata: unknown): boolean {
  const meta = asRecord(metadata);
  return meta?.graphUsdNamedDeposits === true;
}

const IDENTITY_DOC_TYPES = new Set(['passport', 'drivers_license', 'national_id', 'voters_card']);

/** Graph person document types (Create/Update Person). Non-Graph types are dropped. */
const GRAPH_PERSON_DOC_TYPES = new Set([
  'passport',
  'national_id',
  'drivers_license',
  'voters_card',
  'utility_bill',
]);

/** ISO 3166-2 subdivision code (local part): `SH`, `AB`, `NY`, `LA` — not full names. */
const SUBDIVISION_CODE = /^[A-Za-z0-9]{1,3}$/;

/** Client-facing allowlist for Graph USD `metadata.documents[].type` (before mapping). */
const GRAPH_USD_CREATE_DOC_TYPES = new Set([
  'passport',
  'national_id',
  'drivers_license',
  'voters_card',
  'utility_bill',
  'proof_of_address',
  'poa',
]);

/** Map BloxFi / portal doc types onto Graph’s allowed set. */
function toGraphPersonDocType(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (GRAPH_PERSON_DOC_TYPES.has(t)) return t;
  if (t === 'proof_of_address' || t === 'poa') return 'utility_bill';
  // Portal SOF evidence is not a Graph person document type.
  return null;
}

type DocSideBuckets = { front: number[]; back: number[] };

/** Parse document side; omit/empty defaults to `front`. Invalid values → null. */
function resolveDocumentSide(raw: unknown): 'front' | 'back' | null {
  const s = str(raw).toLowerCase();
  if (!s) return 'front';
  if (s === 'front' || s === 'back') return s;
  return null;
}

/**
 * Strict Graph USD create-Account checks (before persist).
 * Throws {@link GraphOnrampKycError} with field paths; then builds kyc_input.
 *
 * `side` is optional (defaults to front). Same mapped type may appear twice only
 * as complementary front + back. Graph still receives one URL (prefer front).
 */
export function assertGraphUsdAccountCreatePayload(
  source: GraphIndividualKycSource
): Record<string, unknown> {
  const issues: GraphOnrampKycFieldIssue[] = [];
  const holder = asRecord(source.accountHolder) ?? {};
  const addr = asRecord(holder.address) ?? {};
  const state = str(addr.stateProvinceRegion ?? addr.state ?? addr.address_state);
  if (state && !SUBDIVISION_CODE.test(state)) {
    issues.push(
      issueInvalid('address_state', 'must be an ISO 3166-2 subdivision code (e.g. TX, AB), not a full name')
    );
  }

  const docs = Array.isArray(source.documents) ? source.documents : [];
  const byMapped = new Map<string, DocSideBuckets>();
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]!;
    const rawType = str(d.type).toLowerCase();
    if (!rawType) {
      issues.push(issueRequired(`documents[${i}].type`));
      continue;
    }
    if (!GRAPH_USD_CREATE_DOC_TYPES.has(rawType) || !toGraphPersonDocType(rawType)) {
      issues.push(issueInvalid(`documents[${i}].type`, 'unsupported document type for USD KYC'));
      continue;
    }
    const mapped = toGraphPersonDocType(rawType)!;
    const side = resolveDocumentSide('side' in d ? d.side : undefined);
    if (side === null) {
      issues.push(issueInvalid(`documents[${i}].side`, 'must be front or back'));
      continue;
    }
    const bucket = byMapped.get(mapped) ?? { front: [], back: [] };
    if (side === 'front') bucket.front.push(i);
    else bucket.back.push(i);
    byMapped.set(mapped, bucket);
  }

  for (const bucket of byMapped.values()) {
    const total = bucket.front.length + bucket.back.length;
    if (total <= 1) continue;
    if (total === 2 && bucket.front.length === 1 && bucket.back.length === 1) continue;
    const extras = [...bucket.front, ...bucket.back].sort((a, b) => a - b).slice(1);
    for (const i of extras) {
      issues.push(
        issueInvalid(
          `documents[${i}].side`,
          'duplicate type needs complementary front + back (or a single document)'
        )
      );
    }
  }

  if (issues.length > 0) {
    throw new GraphOnrampKycError(issues);
  }
  return buildGraphIndividualKycInput(source);
}

const EMPLOYMENT = new Set(['employed', 'self_employed', 'unemployed', 'student', 'retired']);
const PURPOSE = new Set(['business', 'personal', 'salary', 'freelance']);
const SOURCE = new Set([
  'salary',
  'savings',
  'business',
  'freelance',
  'investment',
  'government_benefits',
  'pension',
]);

/**
 * SOF questionnaire `expectedMonthlyPayments` bucket `A_B` → Graph integer after `_`.
 * e.g. `0_4999` → 4999. Returns null when unparseable.
 */
export function expectedMonthlyInflowFromSofBucket(bucket: string): number | null {
  const idx = bucket.lastIndexOf('_');
  if (idx < 0 || idx === bucket.length - 1) return null;
  const suffix = bucket.slice(idx + 1);
  if (!/^\d+$/.test(suffix)) return null;
  return Number.parseInt(suffix, 10);
}

function normalizePhoneE164(raw: string): string {
  return raw.replace(/[\s()-]/g, '');
}

export type GraphIndividualKycSource = {
  accountHolder: unknown;
  sofQuestionnaire: unknown;
  documents?: AccountMetadataDocument[] | GraphOnrampKycDocument[];
};

/**
 * Build Graph individual `kyc_input` from an onramp Account.
 * Throws {@link GraphOnrampKycError} listing missing/invalid fields.
 */
export function buildGraphIndividualKycInput(source: GraphIndividualKycSource): Record<string, unknown> {
  const issues: GraphOnrampKycFieldIssue[] = [];
  const holder = asRecord(source.accountHolder) ?? {};
  const sof = asRecord(source.sofQuestionnaire) ?? {};
  const holderAddr = asRecord(holder.address);
  const addr = mapAddress(holderAddr);
  const countryRaw = str(holderAddr?.country ?? holderAddr?.address_country);

  const firstName = str(holder.firstName);
  const lastName = str(holder.lastName);
  const middleName = str(holder.middleName);
  const email = str(holder.email);
  const phoneRaw = str(holder.phone);
  const phone = phoneRaw ? normalizePhoneE164(phoneRaw) : '';
  const dobRaw = str(holder.dateOfBirth);
  const dob = toDateOnly(dobRaw);
  const idType = str(holder.idType);
  const idNumber = str(holder.idNumber);
  const idCountryRaw = str(holder.idCountry);
  const idCountry = idCountryRaw ? toAlpha2(idCountryRaw) : null;
  const bvn = str(holder.bvn);
  const taxId = str(holder.taxId);

  if (!firstName) issues.push(issueRequired('first_name'));
  if (!lastName) issues.push(issueRequired('last_name'));
  if (!email) issues.push(issueRequired('email'));
  if (!phoneRaw) issues.push(issueRequired('phone'));
  else if (!isE164(phone)) {
    issues.push(issueInvalid('phone', 'must be E.164 (+country code)'));
  }
  if (!dobRaw) issues.push(issueRequired('date_of_birth'));
  else if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    issues.push(issueInvalid('date_of_birth', 'must be YYYY-MM-DD'));
  }
  if (!idType) issues.push(issueRequired('id_type'));
  else if (!IDENTITY_DOC_TYPES.has(idType)) {
    issues.push(issueInvalid('id_type', 'must be passport, drivers_license, national_id, or voters_card'));
  }
  if (!idNumber) issues.push(issueRequired('id_number'));
  if (!idCountryRaw) issues.push(issueRequired('id_country'));
  else if (!idCountry) {
    issues.push(issueInvalid('id_country', 'must be a valid ISO 3166 country code'));
  }
  if (!addr.line1) issues.push(issueRequired('address_line1'));
  if (!addr.city) issues.push(issueRequired('address_city'));
  if (!addr.state) issues.push(issueRequired('address_state'));
  if (!addr.postal) issues.push(issueRequired('address_postal_code'));
  if (!countryRaw) issues.push(issueRequired('address_country'));
  else if (!addr.countryAlpha3) {
    issues.push(issueInvalid('address_country', 'must be a valid ISO 3166 country code'));
  }

  const employmentStatus = str(sof.employmentStatus);
  const primaryPurpose = str(sof.primaryPurpose);
  const sourceOfFunds = str(sof.sourceOfFunds);
  const occupation = str(sof.mostRecentOccupation);
  const bucket = str(sof.expectedMonthlyPayments);
  const inflow = bucket ? expectedMonthlyInflowFromSofBucket(bucket) : null;

  if (!employmentStatus) issues.push(issueRequired('background_information.employment_status'));
  else if (!EMPLOYMENT.has(employmentStatus)) {
    issues.push(issueInvalid('background_information.employment_status', 'unsupported value'));
  }
  if (!primaryPurpose) issues.push(issueRequired('background_information.primary_purpose'));
  else if (!PURPOSE.has(primaryPurpose)) {
    issues.push(issueInvalid('background_information.primary_purpose', 'unsupported value'));
  }
  if (!sourceOfFunds) issues.push(issueRequired('background_information.source_of_funds'));
  else if (!SOURCE.has(sourceOfFunds)) {
    issues.push(issueInvalid('background_information.source_of_funds', 'unsupported value'));
  }
  if (!bucket) issues.push(issueRequired('background_information.expected_monthly_inflow'));
  else if (inflow == null) {
    issues.push(issueInvalid('background_information.expected_monthly_inflow', 'invalid payment bucket'));
  }

  const docs = Array.isArray(source.documents) ? source.documents : [];
  type DocCandidate = {
    index: number;
    url: string;
    side: 'front' | 'back';
    issue_date?: string;
    expiry_date?: string;
  };
  const candidatesByType = new Map<string, DocCandidate[]>();
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]!;
    const mappedType = toGraphPersonDocType(str(d.type));
    const url = str(d.url);
    // Skip unknown/unsupported types (e.g. source_of_funds) without failing closed.
    if (!mappedType) continue;
    if (!url || !/^https?:\/\//i.test(url)) {
      issues.push(issueInvalid(`documents[${i}]`, 'url must be an http(s) URL'));
      continue;
    }
    // Invalid side is ignored here (assert catches it on create); default omit → front.
    const side = resolveDocumentSide('side' in d ? d.side : undefined) ?? 'front';
    const candidate: DocCandidate = { index: i, url, side };
    if ('issue_date' in d && typeof d.issue_date === 'string') candidate.issue_date = d.issue_date;
    if ('expiry_date' in d && typeof d.expiry_date === 'string') candidate.expiry_date = d.expiry_date;
    const list = candidatesByType.get(mappedType) ?? [];
    list.push(candidate);
    candidatesByType.set(mappedType, list);
  }

  const validDocs: GraphOnrampKycDocument[] = [];
  for (const [mappedType, candidates] of candidatesByType) {
    // Graph rejects duplicate document types — one URL per type; prefer front.
    const preferred = candidates.find((c) => c.side === 'front') ?? candidates[0]!;
    const out: GraphOnrampKycDocument = { type: mappedType, url: preferred.url };
    if (preferred.issue_date) out.issue_date = preferred.issue_date;
    if (preferred.expiry_date) out.expiry_date = preferred.expiry_date;
    validDocs.push(out);
  }
  if (!validDocs.some((d) => IDENTITY_DOC_TYPES.has(d.type))) {
    issues.push(issueRequired('documents'));
  }

  if (issues.length > 0) {
    throw new GraphOnrampKycError(issues);
  }

  return {
    customer_type: 'individual',
    email,
    first_name: firstName,
    last_name: lastName,
    ...(middleName ? { middle_name: middleName, name_other: middleName } : {}),
    phone,
    date_of_birth: dob,
    id_type: idType,
    id_number: idNumber,
    id_country: idCountry,
    ...(bvn ? { bank_id_number: bvn } : {}),
    ...(taxId ? { tax_id: taxId } : {}),
    address_line1: addr.line1,
    ...(addr.line2 ? { address_line2: addr.line2 } : {}),
    address_city: addr.city,
    address_state: addr.state,
    address_postal_code: addr.postal,
    address_country: addr.countryAlpha3,
    background_information: {
      employment_status: employmentStatus,
      ...(occupation ? { occupation } : {}),
      primary_purpose: primaryPurpose,
      source_of_funds: sourceOfFunds,
      expected_monthly_inflow: inflow,
    },
    documents: validDocs,
  };
}
