/**
 * Zod schemas for Offramp endpoints. Spec §5.
 */

import { z } from 'zod';

const platformFeeSchema = z.object({
  type: z.enum(['PERCENTAGE', 'FLAT']),
  value: z.number().min(0),
});

const createOfframpSourceSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(1),
  chain: z.string().min(1),
  userId: z.string().uuid(),
  externalWalletId: z.string().uuid(),
});

const createOfframpDestinationSchema = z.object({
  currency: z.string().min(1),
  amount: z.number().positive().optional(),
  userId: z.string().uuid(),
  accountId: z.string().uuid(),
  transferType: z.string().optional(),
});

export const createOfframpBodySchema = z.object({
  requestId: z.string().uuid(),
  source: createOfframpSourceSchema,
  destination: createOfframpDestinationSchema,
  platformFee: platformFeeSchema,
  metadata: z.record(z.unknown()).optional(),
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
      'CRYPTO_RECEIVED',
      'FIAT_PENDING',
      'COMPLETED',
      'CANCELLED',
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
