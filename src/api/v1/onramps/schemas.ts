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
  userId: z.string().uuid(),
  accountId: z.string().uuid(),
  transferType: z.string().optional(),
});

const createOnrampDestinationSchema = z.object({
  currency: z.string().min(1),
  chain: z.string().min(1),
  userId: z.string().uuid(),
  externalWalletId: z.string().uuid(),
});

export const createOnrampBodySchema = z.object({
  requestId: z.string().uuid(),
  source: createOnrampSourceSchema,
  destination: createOnrampDestinationSchema,
  purposeOfPayment: z.string().optional(),
  fee: onrampFeeSchema,
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
