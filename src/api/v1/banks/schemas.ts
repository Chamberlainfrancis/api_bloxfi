import { z } from 'zod';

export const listBanksQuerySchema = z.object({
  /** Fiat payout asset (e.g. NGN). Not for crypto tickers. */
  asset: z.string().min(1, 'asset is required (e.g. NGN)'),
});

export type ListBanksQuery = z.infer<typeof listBanksQuerySchema>;

/**
 * BloxFi partner shape (camelCase). We map to Palremit snake_case on `POST /v1/banks/resolve`.
 */
export const resolveBankBodySchema = z.object({
  asset: z.string().min(1),
  /** Optional; upstream always receives `destination_type: bank_account`. */
  destinationType: z.literal('bank_account').optional(),
  bankCode: z.string().min(1),
  accountNumber: z.string().min(1),
});

export type ResolveBankBody = z.infer<typeof resolveBankBodySchema>;
