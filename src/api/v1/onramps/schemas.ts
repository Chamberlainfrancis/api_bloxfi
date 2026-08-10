/**
 * Zod schemas for Onramp endpoints. Spec §4.
 */

import { z } from 'zod';

const platformFeeSchema = z.object({
  type: z.enum(['PERCENTAGE', 'FLAT']),
  value: z.coerce.number().min(0),
  walletAddress: z.string().min(1),
  currency: z.string().min(1).optional(),
  network: z.string().min(1).optional(),
});

const createOnrampSourceSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
  userld: z.string().uuid().optional(),
  transferType: z.string().optional(),
  /** Prisma Account.id — which onramp Account this transfer uses. */
  accountId: z.string().uuid().optional(),
});

const createOnrampDestinationSchema = z.object({
  currency: z.string().min(1).optional(),
  chain: z.string().min(1).optional(),
  userId: z.string().uuid().optional(),
  userld: z.string().uuid().optional(),
  externalWalletId: z.string().uuid().optional(),
  externalWalletld: z.string().uuid().optional(),
});

export const createOnrampBodySchema = z
  .object({
    requestId: z.string().uuid().optional(),
    requestld: z.string().uuid().optional(),
    quoteId: z.string().uuid().optional(),
    source: createOnrampSourceSchema,
    destination: createOnrampDestinationSchema,
    purposeOfPayment: z.string().optional(),
    platformFee: platformFeeSchema.optional(),
  })
  .transform((val) => ({
    requestId: val.requestId ?? val.requestld,
    quoteId: val.quoteId,
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
    platformFee: val.platformFee,
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

    if (val.quoteId) {
      if (val.platformFee) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['platformFee'],
          message: 'platformFee must be omitted when quoteId is provided',
        });
      }
      for (const field of ['amount', 'currency'] as const) {
        const v = val.source[field];
        if (v != null && v !== '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['source', field],
            message: `source.${field} must be omitted when quoteId is provided`,
          });
        }
      }
      for (const field of ['currency', 'chain'] as const) {
        const v = val.destination[field];
        if (v != null && v !== '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['destination', field],
            message: `destination.${field} must be omitted when quoteId is provided`,
          });
        }
      }
    } else {
      if (!val.source.amount) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'amount'], message: 'source.amount is required' });
      }
      if (!val.source.currency?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source', 'currency'],
          message: 'source.currency is required',
        });
      }
      if (!val.destination.currency?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destination', 'currency'],
          message: 'destination.currency is required',
        });
      }
      if (!val.destination.chain?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destination', 'chain'],
          message: 'destination.chain is required',
        });
      }
      if (!val.platformFee) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['platformFee'],
          message: 'platformFee is required',
        });
      }
    }
  });

export const createOnrampQuoteBodySchema = z
  .object({
    fromCurrency: z.string().min(1),
    toCurrency: z.string().min(1),
    amount: z.number().positive(),
    chain: z.string().min(1),
    platformFee: platformFeeSchema.superRefine((pf, ctx) => {
      if (pf.type === 'PERCENTAGE' && pf.value >= 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'platformFee.value for PERCENTAGE is a decimal fraction (0.01 = 1%)',
        });
      }
    }),
  })
  .transform((val) => ({
    fromCurrency: val.fromCurrency.trim().toLowerCase(),
    toCurrency: val.toCurrency.trim().toLowerCase(),
    amount: val.amount,
    destinationChain: val.chain.trim(),
    platformFee: val.platformFee,
  }));

export const getOnrampRatesQuerySchema = z.object({
  fromCurrency: z.string().min(1),
  toCurrency: z.string().min(1),
  // Optional fee preview: when amount + chain are supplied, the response
  // includes a `quote` with the Palremit payout fee deducted from receive.
  amount: z.coerce.number().positive().optional(),
  chain: z.string().min(1).optional(),
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
export type CreateOnrampQuoteBody = z.infer<typeof createOnrampQuoteBodySchema>;
export type GetOnrampRatesQuery = z.infer<typeof getOnrampRatesQuerySchema>;
export type ListOnrampsQuery = z.infer<typeof listOnrampsQuerySchema>;
