/**
 * Zod schemas for External Wallet endpoints. Spec §2.
 */

import { z } from 'zod';

const blockchainNetworkSchema = z.enum([
  'POLYGON',
  'ETHEREUM',
  'BASE',
  'SOLANA',
  'ARBITRUM',
  'OPTIMISM',
  'AVALANCHE',
  'BNB_CHAIN',
]);

/** POST /users/:userId/wallets/external body */
export const addExternalWalletBodySchema = z.object({
  address: z.string().min(1, 'address is required'),
  chain: blockchainNetworkSchema,
  name: z.string().min(1, 'name is required'),
  referenceId: z.string().min(1, 'referenceId is required'),
});

/** GET /users/:userId/wallets/external query - cursor pagination and filters */
export const listExternalWalletsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  createdBefore: z.string().datetime({ message: 'createdBefore must be ISO 8601' }).optional(),
  chain: blockchainNetworkSchema.optional(),
  active: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
});

/** PATCH /users/:userId/wallets/external/:walletId body - name and active only */
export const updateExternalWalletBodySchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export type AddExternalWalletBody = z.infer<typeof addExternalWalletBodySchema>;
export type ListExternalWalletsQuery = z.infer<typeof listExternalWalletsQuerySchema>;
export type UpdateExternalWalletBody = z.infer<typeof updateExternalWalletBodySchema>;
