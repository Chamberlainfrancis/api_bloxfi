/**
 * Zod schemas for limits and high-value-request endpoints. Spec §6.
 */

import { z } from 'zod';

export const createHighValueRequestBodySchema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().uuid(),
  currency: z.string().optional(),
  requestedLimit: z.string().optional(),
  reason: z.string().optional(),
});

export type CreateHighValueRequestBody = z.infer<typeof createHighValueRequestBodySchema>;
