/**
 * Zod schemas for Offramp endpoints. Spec §5.
 */

import { z } from 'zod';

const platformFeeSchema = z.object({
  type: z.enum(['PERCENTAGE', 'FLAT']),
  value: z.coerce.number().min(0),
  walletAddress: z.string().min(1),
});

const createOfframpSourceSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1),
  chain: z.string().min(1),
  userId: z.string().uuid().optional(),
  userld: z.string().uuid().optional(),
  externalWalletId: z.string().uuid().optional(),
  externalWalletld: z.string().uuid().optional(),
});

const createOfframpDestinationSchema = z.object({
  currency: z.string().min(1),
  amount: z.number().positive().optional(),
  userId: z.string().uuid().optional(),
  userld: z.string().uuid().optional(),
  accountId: z.string().uuid().optional(),
  accountld: z.string().uuid().optional(),
  transferType: z.string().optional(),
  bankTransferMethod: z.string().optional(),
  reference: z.string().optional(),
  purposeOfPayment: z.string().min(1),
});

export const createOfframpBodySchema = z
  .object({
    requestId: z.string().uuid().optional(),
    requestld: z.string().uuid().optional(),
    source: createOfframpSourceSchema,
    destination: createOfframpDestinationSchema,
    platformFee: platformFeeSchema,
    metadata: z.record(z.unknown()).optional(),
  })
  .transform((val) => ({
    requestId: val.requestId ?? val.requestld,
    source: {
      ...val.source,
      userId: val.source.userId ?? val.source.userld,
      externalWalletId: val.source.externalWalletId ?? val.source.externalWalletld,
    },
    destination: {
      ...val.destination,
      userId: val.destination.userId ?? val.destination.userld,
      accountId: val.destination.accountId ?? val.destination.accountld,
    },
    platformFee: val.platformFee,
    metadata: val.metadata,
  }))
  .superRefine((val, ctx) => {
    if (!val.requestId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestId'], message: 'requestId is required' });
    }
    if (!val.source.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'userId'], message: 'source.userId is required' });
    }
    if (!val.source.externalWalletId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source', 'externalWalletId'],
        message: 'source.externalWalletId is required',
      });
    }
    if (!val.destination.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'userId'],
        message: 'destination.userId is required',
      });
    }
    if (!val.destination.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'accountId'],
        message: 'destination.accountId is required',
      });
    }
  });

export const getOfframpRatesQuerySchema = z.object({
  fromCurrency: z.string().min(1),
  toCurrency: z.string().min(1),
  fromChain: z.string().optional(),
});

export const listOfframpsQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: z
    .enum([
      'CREATED',
      'AWAITING_CRYPTO',
      'CRYPTO_PENDING',
      'CRYPTO_RECEIVED',
      'CRYPTO_CONFIRMED',
      'PROCESSING_FEE',
      'FEE_PROCESSED',
      'FIAT_INITIATED',
      'FIAT_PENDING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
      'REFUNDED',
      'CRYPTO_FAILED',
      'FIAT_FAILED',
      'EXPIRED',
    ])
    .optional(),
  currency: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .default(50),
  createdBefore: z.string().datetime().optional(),
  createdAfter: z.string().datetime().optional(),
});

export type CreateOfframpBody = z.infer<typeof createOfframpBodySchema>;
export type GetOfframpRatesQuery = z.infer<typeof getOfframpRatesQuerySchema>;
export type ListOfframpsQuery = z.infer<typeof listOfframpsQuerySchema>;

export const cancelOfframpBodySchema = z.object({
  reason: z.string().min(1),
  refundAddress: z.string().min(1),
});

export type CancelOfframpBody = z.infer<typeof cancelOfframpBodySchema>;
