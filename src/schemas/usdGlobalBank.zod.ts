/**
 * Zod for USD Palremit `global_bank_account`:
 * - Account `details.transferDetails` (camelCase): rail, beneficiary, settlement fields.
 * - Account `details.swiftCode` (optional) → outbound `destination.swift_code` per Palremit sample.
 * - **`palremitUsdGlobalBankDestinationSchema`** validates the **outbound** Palremit payload (snake_case).
 */

import { z } from 'zod';

// --- API (camelCase) — account + client metadata ---

export const usdGlobalBankBeneficiaryAddressApiSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  stateProvince: z.string().min(1),
  postalCode: z.string().min(1),
  country: z
    .string()
    .min(2)
    .max(2)
    .transform((s) => s.toUpperCase()),
});

export const usdGlobalBankBeneficiaryApiSchema = z.object({
  name: z.string().min(1),
  /** Omitted on create-account: server uses `accountHolder.type`. */
  type: z.enum(['individual', 'business']).optional(),
  address: usdGlobalBankBeneficiaryAddressApiSchema,
});

/** Palremit `transfer_purpose` / USD `destination.purposeOfPayment` (UPPER_SNAKE). */
export const usdPalremitTransferPurposeSchema = z
  .string()
  .min(1)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'must be UPPER_SNAKE (e.g. FAMILY_MAINTENANCE)');

/**
 * Per-offramp metadata for USD: **`isSelfTransfer`** only (→ Palremit `extras.is_self_transfer`).
 * Optional keys are merged as Palremit `destination` overrides (camelCase → snake_case) where supported.
 */
export const usdOfframpOptionalMetadataSchema = z
  .object({
    isSelfTransfer: z.boolean(),
  })
  .passthrough();

/**
 * Stored on account `details.transferDetails` for USD (camelCase).
 * Transfer purpose is **`destination.purposeOfPayment`** on the offramp request, not account metadata.
 */
export const usdAccountTransferDetailsSchema = z
  .object({
    payoutRail: z.string().min(1).transform((s) => s.toUpperCase()),
    accountHolderName: z.string().min(1),
    beneficiary: usdGlobalBankBeneficiaryApiSchema,
  })
  .superRefine((d, ctx) => {
    if (!d.payoutRail.startsWith('WIRE')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payoutRail'],
        message: 'payoutRail must start with WIRE (e.g. WIRE, WIRE_DOMESTIC)',
      });
    }
    if (d.beneficiary.address.country !== 'US') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beneficiary', 'address', 'country'],
        message: 'beneficiary.address.country must be US for this payout path',
      });
    }
  });

// --- Palremit wire format (snake_case) — validate outbound `destination` only ---

const palremitUsdBeneficiaryAddressSchema = z.object({
  street: z.string().min(1),
  city: z.string().min(1),
  state_province: z.string().min(1),
  postal_code: z.string().min(1),
  country: z
    .string()
    .min(2)
    .max(2)
    .transform((s) => s.toUpperCase()),
});

const palremitUsdBeneficiarySchema = z.object({
  name: z.string().min(1),
  type: z.enum(['individual', 'business']),
  address: palremitUsdBeneficiaryAddressSchema,
});

export const usdGlobalBankExtrasSchema = z.object({
  transfer_purpose: usdPalremitTransferPurposeSchema,
  is_self_transfer: z.boolean(),
});

/** Outbound Palremit `destination` for `global_bank_account` (see LP sample: swift_code after account_number). */
export const palremitUsdGlobalBankDestinationSchema = z
  .object({
    country: z
      .string()
      .min(2)
      .max(2)
      .transform((s) => s.toUpperCase()),
    payout_rail: z.string().min(1).transform((s) => s.toUpperCase()),
    account_number: z.string().min(1),
    swift_code: z.string().min(1).optional(),
    bank_code: z.string().min(1),
    bank_name: z.string().min(1),
    account_holder_name: z.string().min(1),
    beneficiary: palremitUsdBeneficiarySchema,
    extras: usdGlobalBankExtrasSchema,
  })
  .superRefine((d, ctx) => {
    if (!d.payout_rail.startsWith('WIRE')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payout_rail'],
        message: 'payout_rail must start with WIRE (e.g. WIRE, WIRE_DOMESTIC)',
      });
    }
    if (d.country !== 'US' || d.beneficiary.address.country !== 'US') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['country'],
        message: 'country and beneficiary.address.country must be US for this payout path',
      });
    }
  });
