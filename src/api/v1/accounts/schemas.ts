/**
 * Zod schemas for offramp payout Account endpoints. Spec §3.
 * Single `details` object with required `currency`; `type` is a free-form region label.
 *
 * **USD / global bank (Palremit `global_bank_account`)** — one shape for every corridor
 * (US domestic, international, IBAN countries, etc.): same keys; only values differ.
 * Use `details.accountNumber` for any bank account identifier (US account number or IBAN).
 * Do not send `details.iban`. `details.bankCode` maps to Palremit `destination.bank_code`
 * (US ABA routing or BIC). Optional `accountType` / `bankCountry` / `country` follow settlement needs.
 */

import { z } from 'zod';
import { usdAccountTransferDetailsSchema } from '@/schemas/usdGlobalBank.zod';

const BANK_IDENTIFIER_KEYS = [
  'accountNumber',
  'bankCode',
  'routingNumber',
  'account_number',
  'bank_code',
  'routing_number',
] as const;

function stripBankIdentifierWhitespace(value: string): string {
  return value.replace(/\s+/g, '');
}

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
 * Unified bank / rail details for any country; `currency` required; `country` optional free string.
 */
export const regionDetailsSchema = z
  .object({
    country: z.string().optional().nullable(),
    currency: z.string().min(1, 'currency is required'),
    transferType: z.string().optional().nullable(),
    accountType: z.string().optional().nullable(),
    accountNumber: z.string().optional().nullable(),
    routingNumber: z.string().optional().nullable(),
    bankCode: z.string().optional().nullable(),
    bankName: z.string().optional().nullable(),
    bankCountry: z.string().optional().nullable(),
    bankAddress: addressSchema.optional().nullable(),
    pixKey: z.string().optional().nullable(),
    /** USD: payout rail, beneficiary, holder name (Palremit global bank settlement). */
    transferDetails: usdAccountTransferDetailsSchema.optional().nullable(),
  })
  .passthrough();

function stripBankIdentifiersInCreateBody<
  T extends {
    details: z.infer<typeof regionDetailsSchema>;
  },
>(data: T): T {
  const d = { ...(data.details as Record<string, unknown>) };
  let changed = false;
  for (const key of BANK_IDENTIFIER_KEYS) {
    const v = d[key];
    if (typeof v !== 'string' || v === '') continue;
    const stripped = stripBankIdentifierWhitespace(v);
    if (stripped !== v) {
      d[key] = stripped;
      changed = true;
    }
  }
  if (!changed) return data;
  return { ...data, details: d as T['details'] };
}

function normalizeUsdBeneficiaryTypeFromAccountHolder<
  T extends {
    accountHolder: { type: 'business' | 'individual' };
    details: z.infer<typeof regionDetailsSchema>;
  },
>(data: T): T {
  const ccy = data.details.currency?.trim().toUpperCase() ?? '';
  if (ccy !== 'USD') return data;
  const td = data.details.transferDetails;
  if (!td?.beneficiary) return data;
  const ben = td.beneficiary;
  return {
    ...data,
    details: {
      ...data.details,
      transferDetails: {
        ...td,
        beneficiary: {
          ...ben,
          type: data.accountHolder.type,
        },
      },
    },
  };
}

/** Create account body: `rail` + region `type`, accountHolder, details (offramp payout only). */
export const createAccountBodySchema = z
  .object({
    rail: z.enum(['onramp', 'offramp']),
    type: z.string().min(1, 'type is required'),
    accountHolder: accountHolderSchema,
    details: regionDetailsSchema,
  })
  .transform((data) => stripBankIdentifiersInCreateBody(data))
  .superRefine((data, ctx) => {
    if (data.rail !== 'offramp') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rail'],
        message: 'BloxFi bank accounts are offramp payout destinations only; set rail to offramp',
      });
      return;
    }
    const ccy = data.details.currency?.trim().toUpperCase();
    if (ccy !== 'USD') return;

    const h = data.accountHolder;
    if (h.address != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['accountHolder', 'address'],
        message:
          'USD payout accounts: omit accountHolder.address; put beneficiary address under details.transferDetails.beneficiary',
      });
    }
    const disallowed = [
      ['idType', h.idType],
      ['idNumber', h.idNumber],
      ['dateOfBirth', h.dateOfBirth],
      ['nationality', h.nationality],
      ['formationDate', h.formationDate],
    ] as const;
    for (const [path, val] of disallowed) {
      if (val != null && String(val).trim() !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accountHolder', path],
          message: `USD payout accounts: omit accountHolder.${path}; keep only type, name, email, phone`,
        });
      }
    }

    const d = data.details as Record<string, unknown>;
    if (String(d.transferType ?? '').trim() !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'transferType'],
        message: 'Omit details.transferType for USD accounts; use details.transferDetails.payoutRail',
      });
    }
    if (String(d.iban ?? '').trim() !== '') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'iban'],
        message:
          'Omit details.iban. Use details.accountNumber for all bank identifiers (US account number or international IBAN).',
      });
    }
    if (!String(d.accountNumber ?? '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'accountNumber'],
        message: 'USD payout accounts require details.accountNumber',
      });
    }
    const bankCode = String(d.bankCode ?? d.bank_code ?? '').trim();
    if (!bankCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'bankCode'],
        message:
          'USD payout accounts require details.bankCode (maps to Palremit destination.bank_code; e.g. US ABA routing number or international BIC)',
      });
    }
    if (!String(d.bankName ?? '').trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['details', 'bankName'],
        message: 'USD payout accounts require details.bankName',
      });
    }
    const gp = usdAccountTransferDetailsSchema.safeParse(d.transferDetails);
    if (!gp.success) {
      for (const e of gp.error.errors) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: e.message,
          path: ['details', 'transferDetails', ...e.path],
        });
      }
    }

  })
  .transform((data) => normalizeUsdBeneficiaryTypeFromAccountHolder(data));

/** List accounts: default rail is offramp-only when `rail` query is omitted. */
export const listAccountsQuerySchema = z.object({
  rail: z.enum(['onramp', 'offramp']).optional(),
  type: z.string().min(1).optional(),
  currency: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  createdBefore: z.string().datetime({ message: 'createdBefore must be ISO 8601' }).optional(),
  createdAfter: z.string().datetime({ message: 'createdAfter must be ISO 8601' }).optional(),
});

export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;
export type ListAccountsQuery = z.infer<typeof listAccountsQuerySchema>;
