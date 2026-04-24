import { z } from 'zod';

export const listNetworksQuerySchema = z
  .object({
    coin: z.string().optional(),
    coinCode: z.string().optional(),
  })
  .refine((v) => Boolean((v.coin ?? v.coinCode ?? '').trim()), {
    message: 'Query parameter coin or coinCode is required (e.g. ?coin=USDT)',
    path: ['coin'],
  });

export type ListNetworksQuery = z.infer<typeof listNetworksQuerySchema>;
