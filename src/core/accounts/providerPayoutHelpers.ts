/**
 * Helpers for corridor-backed payout accounts.
 */

import type { ProviderPayout, RegionAccountDetails } from '@/types/account';

export function parseProviderPayout(raw: unknown): ProviderPayout | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.provider !== 'palremit' || o.schemaVersion !== 2) return null;
  const corridor = o.corridor;
  const destination = o.destination;
  if (
    corridor == null ||
    typeof corridor !== 'object' ||
    Array.isArray(corridor) ||
    destination == null ||
    typeof destination !== 'object' ||
    Array.isArray(destination)
  ) {
    return null;
  }
  const c = corridor as Record<string, unknown>;
  const asset = typeof c.asset === 'string' ? c.asset : '';
  const country = typeof c.country === 'string' ? c.country : '';
  const destinationType = typeof c.destinationType === 'string' ? c.destinationType : '';
  const beneficiaryType = c.beneficiaryType;
  if (
    !asset ||
    !country ||
    !destinationType ||
    (beneficiaryType !== 'individual' && beneficiaryType !== 'business')
  ) {
    return null;
  }
  return {
    provider: 'palremit',
    schemaVersion: 2,
    corridor: {
      asset,
      country,
      destinationType,
      beneficiaryType,
    },
    destination: destination as Record<string, unknown>,
    requirementsSnapshot: o.requirementsSnapshot as ProviderPayout['requirementsSnapshot'],
  };
}

/** API `details` summary derived from Palremit destination (not stored in DB). */
export function accountDetailsFromDestination(
  asset: string,
  country: string,
  destination: Record<string, unknown>
): RegionAccountDetails {
  const accountNumber = String(
    destination.account_number ?? destination.accountNumber ?? ''
  ).trim();
  const bankCode = String(destination.bank_code ?? destination.bankCode ?? '').trim();
  const bankName = String(destination.bank_name ?? destination.bankName ?? '').trim();
  return {
    currency: asset.trim().toLowerCase(),
    country: country.trim().toUpperCase(),
    accountNumber: accountNumber || null,
    bankCode: bankCode || null,
    bankName: bankName || null,
  };
}

const MASK_CHARS = 4;

function maskValue(value: string | null | undefined): string | null | undefined {
  if (value == null || value === '') return value;
  const s = String(value).trim();
  if (s.length <= MASK_CHARS) return '****';
  return '*'.repeat(s.length - MASK_CHARS) + s.slice(-MASK_CHARS);
}

/** Mask accountNumber / bankCode on API `details` for list responses. */
export function maskAccountDetails(details: RegionAccountDetails): RegionAccountDetails {
  return {
    ...details,
    accountNumber: maskValue(details.accountNumber) ?? details.accountNumber,
    bankCode: maskValue(details.bankCode) ?? details.bankCode,
  };
}

/** Mask bank identifiers inside Palremit destination for list responses. */
export function maskProviderPayoutDestination(
  providerPayout: ProviderPayout,
  mask: boolean
): ProviderPayout {
  if (!mask) return providerPayout;
  const dest = { ...providerPayout.destination };
  if (dest.account_number != null) {
    dest.account_number = maskValue(String(dest.account_number)) ?? dest.account_number;
  }
  if (dest.bank_code != null) {
    dest.bank_code = maskValue(String(dest.bank_code)) ?? dest.bank_code;
  }
  return { ...providerPayout, destination: dest };
}
