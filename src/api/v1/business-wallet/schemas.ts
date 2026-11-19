import { z } from 'zod';

export const walletWithdrawalBodySchema = z.object({
  asset: z.enum(['USDT', 'USDC']),
  chain: z.string().trim().min(2).max(16),
  amount: z.string().trim().regex(/^\d+(\.\d{1,6})?$/, 'amount must be a decimal string with at most 6 decimal places'),
  address: z.string().trim().min(10).max(128),
  memo: z.string().trim().max(128).optional().nullable(),
});

export const walletTransactionsQuerySchema = z.object({
  asset: z.enum(['USDT', 'USDC']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.coerce.date().optional(),
});

export const walletWithdrawalsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
