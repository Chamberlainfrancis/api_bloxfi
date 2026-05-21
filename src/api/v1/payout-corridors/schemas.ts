import { z } from 'zod';

const iso2 = z
  .string()
  .min(2)
  .max(2)
  .transform((s) => s.toUpperCase());

const assetCode = z
  .string()
  .min(2)
  .max(10)
  .transform((s) => s.toUpperCase());

export const listPayoutCorridorsQuerySchema = z.object({
  asset: assetCode.optional(),
  targetFiat: assetCode.optional(),
  country: iso2.optional(),
  destinationType: z.string().min(1).optional(),
  beneficiaryType: z.enum(['individual', 'business']).optional(),
  network: z.string().min(1).optional(),
});

export const payoutCorridorRequirementsQuerySchema = z.object({
  asset: assetCode,
  country: iso2,
  destinationType: z.string().min(1),
  beneficiaryType: z.enum(['individual', 'business']),
});

export type ListPayoutCorridorsQuery = z.infer<typeof listPayoutCorridorsQuerySchema>;
export type PayoutCorridorRequirementsQuery = z.infer<typeof payoutCorridorRequirementsQuerySchema>;
