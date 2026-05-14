/**
 * Zod schemas for Onramp endpoints. Spec §4.
 */

import { z } from 'zod';

const onrampFeeSchema = z.object({
  type: z.enum(['FIX', 'PERCENT']),
  value: z.number().min(0),
});

const createOnrampSourceSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1),
  userId: z.string().uuid().optional(),
  userld: z.string().uuid().optional(),
  transferType: z.string().optional(),
});

const createOnrampDestinationSchema = z.object({
  currency: z.string().min(1),
  chain: z.string().min(1),
  userId: z.string().uuid().optional(),
  userld: z.string().uuid().optional(),
  externalWalletId: z.string().uuid().optional(),
  externalWalletld: z.string().uuid().optional(),
});

export const createOnrampBodySchema = z
  .object({
    requestId: z.string().uuid().optional(),
    requestld: z.string().uuid().optional(),
    source: createOnrampSourceSchema,
    destination: createOnrampDestinationSchema,
    purposeOfPayment: z.string().optional(),
    fee: onrampFeeSchema,
  })
  .transform((val) => ({
    requestId: val.requestId ?? val.requestld,
    source: {
      ...val.source,
      userId: val.source.userId ?? val.source.userld,
    },
    destination: {
      ...val.destination,
      userId: val.destination.userId ?? val.destination.userld,
      externalWalletId: val.destination.externalWalletId ?? val.destination.externalWalletld,
    },
    purposeOfPayment: val.purposeOfPayment,
    fee: val.fee,
  }))
  .superRefine((val, ctx) => {
    if (!val.requestId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestId'], message: 'requestId is required' });
    }
    if (!val.source.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'userId'], message: 'source.userId is required' });
    }
    if (!val.destination.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'userId'],
        message: 'destination.userId is required',
      });
    }
    if (!val.destination.externalWalletId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'externalWalletId'],
        message: 'destination.externalWalletId is required',
      });
    }
  });

export const getOnrampRatesQuerySchema = z.object({
  fromCurrency: z.string().min(1),
  toCurrency: z.string().min(1),
});

export const listOnrampsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z.enum([
    'CREATED', 'AWAITING_FUNDS', 'FIAT_PENDING', 'FIAT_PROCESSED',
    'CRYPTO_INITIATED', 'CRYPTO_PENDING', 'COMPLETED', 'FIAT_FAILED',
    'FIAT_RETURNED', 'CRYPTO_FAILED', 'EXPIRED',
  ]).optional(),
  currency: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  createdBefore: z.string().datetime().optional(),
  createdAfter: z.string().datetime().optional(),
});

export type CreateOnrampBody = z.infer<typeof createOnrampBodySchema>;
export type GetOnrampRatesQuery = z.infer<typeof getOnrampRatesQuerySchema>;
export type ListOnrampsQuery = z.infer<typeof listOnrampsQuerySchema>;
