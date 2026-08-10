/**
 * Build Graph-capable USD FIAT_DEPOSIT_KYC input.
 * Individual: from onramp Account (accountHolder + sofQuestionnaire + metadata.documents).
 * Business: from User fields + metadata extras (legacy / unused once Briana uses individual).
 * Fail closed: never invent document URLs or background answers.
 */

import type { AccountMetadataDocument } from '@/types/account';

export class GraphOnrampKycError extends Error {
  readonly missingFields: string[];
  /** Stable machine code for logs / support; not shown in the default message. */
  readonly code = 'USD_ONRAMP_KYC_INCOMPLETE' as const;

  constructor(missingFields: string[]) {
    const unique = [...new Set(missingFields)].sort();
    // Client-facing: no provider name. Internal code stays on `code` / `name`.
    super(`missing required fields for USD KYC: ${unique.join(', ')}`);
    this.name = 'GraphOnrampKycError';
    this.missingFields = unique;
  }
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

const ALPHA_2_TO_3: Readonly<Record<string, string>> = {
  AE: 'ARE',
  AU: 'AUS',
  BE: 'BEL',
  CA: 'CAN',
  CN: 'CHN',
  DE: 'DEU',
  ES: 'ESP',
  FR: 'FRA',
  GB: 'GBR',
  GH: 'GHA',
  IN: 'IND',
  IE: 'IRL',
  IT: 'ITA',
  JP: 'JPN',
  KE: 'KEN',
  NG: 'NGA',
  NL: 'NLD',
  NZ: 'NZL',
  SG: 'SGP',
  US: 'USA',
  ZA: 'ZAF',
};

const ALPHA_3_TO_2: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ALPHA_2_TO_3).map(([a2, a3]) => [a3, a2])
);

function toAlpha3(country: string): string | null {
  const n = country.trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(n)) return n;
  if (/^[A-Z]{2}$/.test(n)) return ALPHA_2_TO_3[n] ?? null;
  return null;
}

function toAlpha2(country: string): string | null {
  const n = country.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(n)) return n;
  if (/^[A-Z]{3}$/.test(n)) return ALPHA_3_TO_2[n] ?? null;
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

  if (!entityName) missing.push('entity_name');
  if (!email) missing.push('email');
  if (!contactFirst) missing.push('contact_first_name');
  if (!contactLast) missing.push('contact_last_name');
  if (!phoneNumber || !isE164(phoneNumber)) missing.push('phone_number');
  if (!website) missing.push('websites');
  if (!jurisdiction) missing.push('jurisdiction');
  if (!industry) missing.push('business_industry');
  if (!businessIdType) missing.push('business_id_type');
  if (!registrationNumber && !taxId) missing.push('business_id_number');
  if (!dateOfIncorporation) missing.push('business_dof');
  if (!registered.line1) missing.push('address_line1');
  if (!registered.city) missing.push('address_city');
  if (!registered.state) missing.push('address_state');
  if (!registered.postal) missing.push('address_postal_code');
  if (!bizCountry3) missing.push('address_country');

  const uboFirst = str(uboExtra.first_name) || contactFirst;
  const uboLast = str(uboExtra.last_name) || contactLast;
  const uboPhone = str(uboExtra.phone) || str(lr.phone) || phoneNumber;
  const uboEmail = str(uboExtra.email) || str(lr.email) || email;
  const uboDob = toDateOnly(str(uboExtra.date_of_birth) || str(lr.dateOfBirth));
  const uboIdType = uboExtra.id_type;
  const uboIdNumber = str(uboExtra.id_number);
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

  if (!uboFirst) missing.push('ubo.first_name');
  if (!uboLast) missing.push('ubo.last_name');
  if (!uboPhone || !isE164(uboPhone)) missing.push('ubo.phone');
  if (!uboEmail) missing.push('ubo.email');
  if (!uboDob || !/^\d{4}-\d{2}-\d{2}$/.test(uboDob)) missing.push('ubo.date_of_birth');
  if (!uboIdType) missing.push('ubo.id_type');
  if (!uboIdNumber) missing.push('ubo.id_number');
  if (!uboIdCountry) missing.push('ubo.id_country');
  if (!uboLine1) missing.push('ubo.address_line1');
  if (!uboCity) missing.push('ubo.address_city');
  if (!uboState) missing.push('ubo.address_state');
  if (!uboPostal) missing.push('ubo.address_postal_code');
  if (!uboCountry3) missing.push('ubo.address_country');

  if (!source.background_information) missing.push('background_information');
  if (!source.documents?.length) missing.push('documents');
  else {
    for (let i = 0; i < source.documents.length; i++) {
      const d = source.documents[i]!;
      if (!str(d.type) || !str(d.url) || !/^https?:\/\//i.test(d.url)) {
        missing.push(`documents[${i}]`);
      }
    }
  }

  if (missing.length > 0) {
    throw new GraphOnrampKycError(missing);
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

/** Map BloxFi / portal doc types onto Graph’s allowed set. */
function toGraphPersonDocType(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (GRAPH_PERSON_DOC_TYPES.has(t)) return t;
  if (t === 'proof_of_address' || t === 'poa') return 'utility_bill';
  // Portal SOF evidence is not a Graph person document type.
  return null;
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
  const missing: string[] = [];
  const holder = asRecord(source.accountHolder) ?? {};
  const sof = asRecord(source.sofQuestionnaire) ?? {};
  const addr = mapAddress(asRecord(holder.address));

  const firstName = str(holder.firstName);
  const lastName = str(holder.lastName);
  const middleName = str(holder.middleName);
  const email = str(holder.email);
  const phoneRaw = str(holder.phone);
  const phone = phoneRaw ? normalizePhoneE164(phoneRaw) : '';
  const dob = toDateOnly(str(holder.dateOfBirth));
  const idType = str(holder.idType);
  const idNumber = str(holder.idNumber);
  const idCountry = str(holder.idCountry) ? toAlpha2(str(holder.idCountry)) : null;
  const bvn = str(holder.bvn);
  const taxId = str(holder.taxId);

  if (!firstName) missing.push('first_name');
  if (!lastName) missing.push('last_name');
  if (!email) missing.push('email');
  if (!phone || !isE164(phone)) missing.push('phone');
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) missing.push('date_of_birth');
  if (!IDENTITY_DOC_TYPES.has(idType)) missing.push('id_type');
  if (!idNumber) missing.push('id_number');
  if (!idCountry) missing.push('id_country');
  if (!addr.line1) missing.push('address_line1');
  if (!addr.city) missing.push('address_city');
  if (!addr.state) missing.push('address_state');
  if (!addr.postal) missing.push('address_postal_code');
  if (!addr.countryAlpha3) missing.push('address_country');

  const employmentStatus = str(sof.employmentStatus);
  const primaryPurpose = str(sof.primaryPurpose);
  const sourceOfFunds = str(sof.sourceOfFunds);
  const occupation = str(sof.mostRecentOccupation);
  const bucket = str(sof.expectedMonthlyPayments);
  const inflow = bucket ? expectedMonthlyInflowFromSofBucket(bucket) : null;

  if (!EMPLOYMENT.has(employmentStatus)) missing.push('background_information.employment_status');
  if (!PURPOSE.has(primaryPurpose)) missing.push('background_information.primary_purpose');
  if (!SOURCE.has(sourceOfFunds)) missing.push('background_information.source_of_funds');
  if (inflow == null) missing.push('background_information.expected_monthly_inflow');

  const docs = Array.isArray(source.documents) ? source.documents : [];
  const validDocs: GraphOnrampKycDocument[] = [];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i]!;
    const mappedType = toGraphPersonDocType(str(d.type));
    const url = str(d.url);
    // Skip unknown/unsupported types (e.g. source_of_funds) without failing closed.
    if (!mappedType) continue;
    if (!url || !/^https?:\/\//i.test(url)) {
      missing.push(`documents[${i}]`);
      continue;
    }
    const out: GraphOnrampKycDocument = { type: mappedType, url };
    if ('issue_date' in d && typeof d.issue_date === 'string') out.issue_date = d.issue_date;
    if ('expiry_date' in d && typeof d.expiry_date === 'string') out.expiry_date = d.expiry_date;
    validDocs.push(out);
  }
  if (!validDocs.some((d) => IDENTITY_DOC_TYPES.has(d.type))) {
    missing.push('documents');
  }

  if (missing.length > 0) {
    throw new GraphOnrampKycError(missing);
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
