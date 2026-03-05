/**
 * Zod schemas for User & KYB endpoints. Spec §1.
 */

import { z } from 'zod';

const addressSchema = z.object({
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  stateProvinceRegion: z.string().optional(),
  postalCode: z.string().min(1),
  country: z.string().length(3),
});

const entityTypeSchema = z.enum([
  'LIMITED_COMPANY',
  'PUBLIC_LIMITED_COMPANY',
  'PARTNERSHIP',
  'SOLE_PROPRIETORSHIP',
  'NON_PROFIT',
  'TRUST',
]);

const businessInfoSchema = z.object({
  legalName: z.string().min(1),
  tradingName: z.string().optional(),
  registrationNumber: z.string().min(1),
  entityType: entityTypeSchema,
  dateOfIncorporation: z.string().min(1),
  taxIdentificationNumber: z.string().min(1),
  website: z.string().url().optional(),
  industry: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
});

const legalRepresentativeSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1),
  dateOfBirth: z.string().min(1),
  position: z.string().min(1),
  address: addressSchema,
});

/** POST /users body (requestId is in header) */
export const createUserBodySchema = z.object({
  type: z.literal('business'),
  businessInfo: businessInfoSchema,
  registeredAddress: addressSchema,
  legalRepresentative: legalRepresentativeSchema,
  metadata: z.record(z.unknown()).optional(),
});

const businessDetailsSchema = z.object({
  numberOfEmployees: z.string().optional(),
  annualRevenue: z.string().optional(),
  sourceOfFunds: z.string().optional(),
  purposeOfAccount: z.string().optional(),
  expectedMonthlyVolume: z.string().optional(),
  businessDescription: z.string().optional(),
});

const beneficialOwnerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  nationality: z.string().length(3),
  ownershipPercentage: z.number().min(0).max(100),
  isPoliticallyExposed: z.boolean(),
  address: addressSchema,
});

const directorSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  nationality: z.string().min(1),
  position: z.string().min(1),
  isPoliticallyExposed: z.boolean(),
});

/** POST /users/:userId/kyb body */
export const updateKybBodySchema = z.object({
  businessDetails: businessDetailsSchema.optional(),
  beneficialOwners: z.array(beneficialOwnerSchema).optional(),
  directors: z.array(directorSchema).optional(),
});

/** POST /users/:userId/kyb/submissions body */
export const submitKybBodySchema = z.object({
  rails: z.array(z.string().min(1)).min(1),
  priority: z.string().optional(),
});

/** GET /users/:userId/kyb/status query - rails (comma-separated) */
export const getKybStatusQuerySchema = z.object({
  rails: z.string().optional(), // e.g. "USD,EUR,GBP"
});

/** Document types per spec §1.5 */
const kybDocumentTypeSchema = z.enum([
  'CERTIFICATE_OF_INCORPORATION',
  'ARTICLES_OF_ASSOCIATION',
  'PROOF_OF_ADDRESS',
  'DIRECTOR_ID',
  'BENEFICIAL_OWNER_ID',
  'TAX_REGISTRATION',
  'BANK_STATEMENT',
  'SHAREHOLDERS_REGISTER',
]);

/** POST /users/:userId/kyb/documents body - array of document items */
export const attachKybDocumentsBodySchema = z.array(
  z.object({
    type: kybDocumentTypeSchema,
    fileId: z.string().uuid(),
    subType: z.string().optional(),
    issuedCountry: z.string().length(3).optional(),
    issueDate: z.string().optional(),
    expiryDate: z.string().nullable().optional(),
    documentNumber: z.string().optional(),
    ownerName: z.string().optional(),
  })
);

export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateKybBody = z.infer<typeof updateKybBodySchema>;
export type SubmitKybBody = z.infer<typeof submitKybBodySchema>;
export type GetKybStatusQuery = z.infer<typeof getKybStatusQuerySchema>;
export type AttachKybDocumentsBody = z.infer<typeof attachKybDocumentsBodySchema>;
