import { z } from 'zod';

export const listBanksQuerySchema = z.object({
  asset: z.string().min(1, 'asset is required (e.g. NGN)'),
});

export type ListBanksQuery = z.infer<typeof listBanksQuerySchema>;

export const resolveBankBodySchema = z.object({
  asset: z.string().min(1),
  bankCode: z.string().min(1),
  accountNumber: z.string().min(1),
});

export type ResolveBankBody = z.infer<typeof resolveBankBodySchema>;
