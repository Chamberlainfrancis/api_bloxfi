/**
 * Zod schemas for Account endpoints. Spec §3.
 * Offramp accounts are created via Palremit corridor discovery: `corridor` + `destination` (snake_case).
 * Onramp accounts: SOF questionnaire + optional Graph identity fields + optional `sumsubShareToken`.
 */

import { z } from 'zod';
import { sofQuestionnaireAnswersSchema } from '@/api/v1/accounts/sofAnswersSchema';

const emptyToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const accountHolderAddressSchema = z.object({
  addressLine1: z.string().min(1),
  addressLine2: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  city: z.string().min(1),
  stateProvinceRegion: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(3),
});

const accountHolderSchema = z.object({
  type: z.enum(['business', 'individual']),
  name: z.string().min(1),
  firstName: z.string().min(1).optional(), // required for rail='onramp', enforced below
  lastName: z.string().min(1).optional(),
  middleName: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  email: z.string().email().optional().nullable(),
  phone: z.preprocess(emptyToUndefined, z.string().min(1).optional().nullable()),
  dateOfBirth: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  idType: z.enum(['passport', 'drivers_license', 'national_id', 'voters_card']).optional(),
  idNumber: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  idCountry: z.preprocess(emptyToUndefined, z.string().min(2).max(3).optional()),
  bvn: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  address: accountHolderAddressSchema.optional(),
  // Optional for onramp unless SwipeLux KYC import is enabled (enforced in createAccount core).
  taxId: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

const accountMetadataDocumentSchema = z.object({
  type: z.string().min(1),
  url: z.string().url(),
  issue_date: z.string().optional(),
  expiry_date: z.string().optional(),
});

const accountMetadataSchema = z.object({
  documents: z.array(accountMetadataDocumentSchema).optional(),
});

const payoutCorridorSchema = z.object({
  asset: z
    .string()
    .min(2)
    .transform((s) => s.toUpperCase()),
  country: z
    .string()
    .length(2)
    .transform((s) => s.toUpperCase()),
  destinationType: z.string().min(1).transform((s) => s.toLowerCase()),
  beneficiaryType: z.enum(['individual', 'business']),
});

/**
 * Create account: offramp is a Palremit corridor tuple + canonical destination (unchanged);
 * onramp is SOF questionnaire / Graph identity fields / optional Sumsub share-token KYC import.
 */
export const createAccountBodySchema = z
  .object({
    rail: z.enum(['onramp', 'offramp']),
    type: z.string().min(1, 'type is required'),
    accountHolder: accountHolderSchema,
    corridor: payoutCorridorSchema.optional(), // was required; now offramp-only
    destination: z.record(z.unknown()).optional(), // was required; now offramp-only
    sumsubShareToken: z.string().min(1).optional(), // onramp-only
    sofQuestionnaire: sofQuestionnaireAnswersSchema.optional(), // onramp-only
    /** HTTPS URL to PDF/JPEG/PNG; may also live under sofQuestionnaire.sourceOfFundsDocument. */
    sourceOfFundsDocument: z.string().url().optional(),
    /** Onramp extras (Graph identity documents). */
    metadata: accountMetadataSchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.rail === 'offramp') {
      // EXISTING behavior, unchanged: corridor + destination required.
      if (!data.corridor) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['corridor'], message: 'corridor is required for offramp' });
      }
      if (!data.destination || typeof data.destination !== 'object' || Array.isArray(data.destination)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destination'],
          message: 'destination is required (Palremit snake_case fields from corridor requirements)',
        });
      }
    } else {
      // rail === 'onramp'
      if (data.accountHolder.type !== 'individual') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accountHolder', 'type'],
          message: 'onramp accounts support customer_type individual only in v1',
        });
      }
      if (!data.accountHolder.firstName || !data.accountHolder.lastName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accountHolder'],
          message: 'firstName and lastName are required for rail=onramp',
        });
      }
      // sumsubShareToken is optional: omit when swipeluxBeneficiaryKycImport is off
      // (no SwipeLux KYC) or when using hosted KYC (flag on, no share token).
      // taxId is optional at the schema layer; createAccount requires it when SwipeLux import is on.
      if (!data.sofQuestionnaire) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sofQuestionnaire'],
          message: 'sofQuestionnaire is required for rail=onramp',
        });
      }
      const docUrl =
        data.sourceOfFundsDocument ??
        (typeof data.sofQuestionnaire?.sourceOfFundsDocument === 'string'
          ? data.sofQuestionnaire.sourceOfFundsDocument
          : undefined);
      if (!docUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceOfFundsDocument'],
          message:
            'sourceOfFundsDocument URL is required (top-level or sofQuestionnaire.sourceOfFundsDocument)',
        });
      }
    }
  });

/** List accounts: default rail is offramp-only when `rail` query is omitted. */
export const listAccountsQuerySchema = z.object({
  rail: z.enum(['onramp', 'offramp']).optional(),
  type: z.string().min(1).optional(),
  currency: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  createdBefore: z.string().datetime({ message: 'createdBefore must be ISO 8601' }).optional(),
  createdAfter: z.string().datetime({ message: 'createdAfter must be ISO 8601' }).optional(),
});

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;

/** PUT account: merge partial destination; re-validated against live Palremit corridor. */
export const updateAccountBodySchema = z.object({
  destination: z
    .record(z.unknown())
    .refine((d) => d != null && typeof d === 'object' && !Array.isArray(d) && Object.keys(d).length > 0, {
      message: 'destination must be a non-empty object with fields to add or update',
    }),
});

export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;
