import { z } from 'zod';

const e164Phone = z
  .string()
  .regex(/^\+[1-9]\d{1,14}$/, 'phone must be E.164 (e.g. +15555550100)');

export const createBeneficiaryBodySchema = z
  .object({
    requestId: z.string().uuid(),
    userId: z.string().uuid(),
    customerType: z.literal('individual'),
    sumsubShareToken: z.string().min(1),
    email: z.string().email().max(120),
    firstName: z.string().min(1).max(60),
    lastName: z.string().min(1).max(60),
    phone: e164Phone,
  })
  .strict();

export const listBeneficiariesQuerySchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();

export const getBeneficiaryParamsSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

export const getBeneficiaryQuerySchema = z
  .object({
    userId: z.string().uuid(),
  })
  .strict();

export type CreateBeneficiaryBody = z.infer<typeof createBeneficiaryBodySchema>;
