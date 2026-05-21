/**
 * Zod schemas for offramp payout Account endpoints. Spec §3.
 * Accounts are created via Palremit corridor discovery: `corridor` + `destination` (snake_case).
 */

import { z } from 'zod';

const accountHolderSchema = z.object({
  type: z.enum(['business', 'individual']),
  name: z.string().min(1),
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

/** Create offramp payout account: Palremit corridor tuple + canonical destination. */
export const createAccountBodySchema = z
  .object({
    rail: z.enum(['onramp', 'offramp']),
    type: z.string().min(1, 'type is required'),
    accountHolder: accountHolderSchema,
    corridor: payoutCorridorSchema,
    destination: z.record(z.unknown()),
  })
  .superRefine((data, ctx) => {
    if (data.rail !== 'offramp') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rail'],
        message: 'BloxFi bank accounts are offramp payout destinations only; set rail to offramp',
      });
    }
    if (!data.destination || typeof data.destination !== 'object' || Array.isArray(data.destination)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination'],
        message: 'destination is required (Palremit snake_case fields from corridor requirements)',
      });
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
