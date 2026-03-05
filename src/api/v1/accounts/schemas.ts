/**
 * Zod schemas for Account endpoints. Spec §3.
 * Unified region schema for all supported countries (Americas + Africa-specific: Nigeria, Ghana, Kenya, etc.).
 */

import { z } from 'zod';
import { ACCOUNT_REGION_TYPES } from '../../../types/account';

const addressSchema = z.object({
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional().nullable(),
  city: z.string().min(1),
  stateProvinceRegion: z.string().optional().nullable(),
  postalCode: z.string().min(1),
  country: z.string().min(1),
});

const accountHolderSchema = z.object({
  type: z.enum(['business', 'individual']),
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: addressSchema.optional().nullable(),
  idType: z.string().optional().nullable(),
  idNumber: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  formationDate: z.string().optional().nullable(),
});

/**
 * Unified region details: same shape for all countries; currency required, rest optional.
 * Examples: US (transferType, accountType, accountNumber/iban, routingNumber, bankName), Brazil (pixKey),
 * Colombia, Argentina, Mexico, Africa (region-specific fields as needed).
 */
export const regionDetailsSchema = z.object({
  currency: z.string().min(1, 'currency is required'),
  transferType: z.string().optional().nullable(),
  accountType: z.string().optional().nullable(),
  accountNumber: z.string().optional().nullable(),
  iban: z.string().optional().nullable(),
  routingNumber: z.string().optional().nullable(),
  swiftCode: z.string().optional().nullable(),
  bankName: z.string().optional().nullable(),
  bankCountry: z.string().optional().nullable(),
  bankAddress: addressSchema.optional().nullable(),
  pixKey: z.string().optional().nullable(),
}).passthrough(); // allow extra region-specific fields for any country

const regionTypeEnum = z.enum(ACCOUNT_REGION_TYPES);
const optionalRegion = regionDetailsSchema.optional().nullable();

/** Create account body: rail, type, accountHolder, and one region key matching type */
export const createAccountBodySchema = z.object({
  rail: z.enum(['onramp', 'offramp']),
  type: regionTypeEnum,
  accountHolder: accountHolderSchema,
  us: optionalRegion,
  brazil: optionalRegion,
  colombia: optionalRegion,
  argentina: optionalRegion,
  mexico: optionalRegion,
  africa: optionalRegion,
  nigeria: optionalRegion,
  ghana: optionalRegion,
  kenya: optionalRegion,
  south_africa: optionalRegion,
  zimbabwe: optionalRegion,
  rwanda: optionalRegion,
  senegal: optionalRegion,
}).refine((data) => {
  const regionPayload = data[data.type as keyof typeof data];
  return regionPayload != null && typeof regionPayload === 'object' && 'currency' in regionPayload;
}, { message: 'Region-specific details matching type must be provided with at least currency', path: ['type'] });

/** List accounts query */
export const listAccountsQuerySchema = z.object({
  rail: z.enum(['onramp', 'offramp']).optional(),
  type: regionTypeEnum.optional(),
  currency: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  createdBefore: z.string().datetime({ message: 'createdBefore must be ISO 8601' }).optional(),
  createdAfter: z.string().datetime({ message: 'createdAfter must be ISO 8601' }).optional(),
});

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;
