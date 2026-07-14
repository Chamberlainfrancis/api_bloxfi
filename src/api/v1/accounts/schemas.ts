/**
 * Zod schemas for Account endpoints. Spec §3.
 * Offramp accounts are created via Palremit corridor discovery: `corridor` + `destination` (snake_case).
 * Onramp accounts are created via Sumsub share-token KYC import (`sumsubShareToken`), no corridor/destination.
 */

import { z } from 'zod';

const accountHolderSchema = z.object({
  type: z.enum(['business', 'individual']),
  name: z.string().min(1),
  firstName: z.string().min(1).optional(), // required for rail='onramp', enforced below
  lastName: z.string().min(1).optional(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
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
 * onramp is a Sumsub share-token KYC import (no corridor/destination).
 */
export const createAccountBodySchema = z
  .object({
    rail: z.enum(['onramp', 'offramp']),
    type: z.string().min(1, 'type is required'),
    accountHolder: accountHolderSchema,
    corridor: payoutCorridorSchema.optional(), // was required; now offramp-only
    destination: z.record(z.unknown()).optional(), // was required; now offramp-only
    sumsubShareToken: z.string().min(1).optional(), // onramp-only
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
      // rail === 'onramp' — NEW branch.
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
      if (!data.sumsubShareToken) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sumsubShareToken'], message: 'sumsubShareToken is required for rail=onramp' });
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
