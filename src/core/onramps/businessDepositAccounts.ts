/**
 * Per-business onramp receiving accounts.
 *
 * Some businesses collect fiat into their own bank accounts (e.g. Skypay's
 * "Canada Inc" USD and CAD accounts). When a business has an account set for
 * the onramp currency, the onramp shows that account instead of provisioning
 * one through the orchestrator (no Graph / Dakota / OwlPay / SwipeLux / Kuda,
 * no house static account). Ops marks the fiat received by hand, the same as
 * the house static accounts, so the deposit window is the static 24h one.
 *
 * Stored on User.metadata.onrampDepositAccounts, keyed by upper-case currency:
 *
 *   {
 *     "onrampDepositAccounts": {
 *       "USD": { "bankName": "...", "accountName": "...", "accountNumber": "...",
 *                "bankCode": "...", "bankAddress": "...", "country": "US",
 *                "firstPartyOnly": true }
 *     }
 *   }
 *
 * Set through PATCH /dashboard/api/users/:userId/metadata (passcode gated).
 */

import { z } from 'zod';
import type { DepositInfo } from '@/types/onramp';
import { staticDepositNarrationRef } from '@/core/onramps/staticDepositAccounts';

export const ONRAMP_DEPOSIT_ACCOUNTS_KEY = 'onrampDepositAccounts';

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const businessDepositAccountSchema = z
  .object({
    bankName: trimmed(140),
    accountName: trimmed(140),
    accountNumber: trimmed(64),
    /** ABA routing number (USD), institution + transit (CAD), sort code, etc. */
    bankCode: trimmed(64).optional(),
    bankAddress: trimmed(300).optional(),
    beneficiaryAddress: trimmed(300).optional(),
    iban: trimmed(64).optional(),
    bic: trimmed(16).optional(),
    /** ISO-3166 alpha-2 country of the bank. */
    country: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{2}$/)
      .transform((c) => c.toUpperCase())
      .optional(),
    /** Only payments from an account in the depositor's own name are accepted. */
    firstPartyOnly: z.boolean().optional(),
  })
  .strict();

export type BusinessDepositAccount = z.infer<typeof businessDepositAccountSchema>;

export const businessDepositAccountsSchema = z
  .record(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z]{3}$/, 'currency must be a 3-letter code'),
    businessDepositAccountSchema
  )
  .transform((rec) => {
    const out: Record<string, BusinessDepositAccount> = {};
    for (const [k, v] of Object.entries(rec)) out[k.trim().toUpperCase()] = v;
    return out;
  });

export const DEFAULT_FIRST_PARTY_NOTE =
  '1st party only: pay from a bank account in your own name. Third-party payments will be returned.';

/** The business's own receiving account for this onramp currency, if set and valid. */
export function resolveBusinessDepositAccount(
  metadata: unknown,
  currency: string
): BusinessDepositAccount | null {
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const all = (metadata as Record<string, unknown>)[ONRAMP_DEPOSIT_ACCOUNTS_KEY];
  if (all == null || typeof all !== 'object' || Array.isArray(all)) return null;
  const asset = currency.trim().toUpperCase();
  const entry = Object.entries(all as Record<string, unknown>).find(
    ([k]) => k.trim().toUpperCase() === asset
  )?.[1];
  if (entry == null) return null;
  const parsed = businessDepositAccountSchema.safeParse(entry);
  return parsed.success ? parsed.data : null;
}

export function buildBusinessDepositInfo(params: {
  account: BusinessDepositAccount;
  currency: string;
  amount: number;
  txnRef: string;
  depositByIso: string;
}): DepositInfo {
  const { account } = params;
  const asset = params.currency.trim().toUpperCase();
  const ref = staticDepositNarrationRef(params.txnRef);
  const firstParty = account.firstPartyOnly ? ` ${DEFAULT_FIRST_PARTY_NOTE}` : '';
  return {
    bankName: account.bankName,
    beneficiary: {
      name: account.accountName,
      address: account.beneficiaryAddress ?? '',
      ...(account.country ? { country: account.country } : {}),
    },
    wire: {
      routingNumber: account.bankCode ?? '',
      accountNumber: account.accountNumber,
    },
    ...(account.iban ? { iban: account.iban } : {}),
    ...(account.bic ? { bic: account.bic } : {}),
    ...(account.bankAddress ? { bankAddress: account.bankAddress } : {}),
    ...(account.firstPartyOnly ? { firstPartyOnly: true } : {}),
    reference: ref,
    depositBy: params.depositByIso,
    instruction:
      `Deposit exactly ${params.amount} ${asset} to the account above before ${params.depositByIso}. ` +
      `IMPORTANT: add this exact reference to the payment memo / narration: ${ref}. ` +
      `Transfers without this reference cannot be matched.${firstParty} ` +
      `Crypto is sent after ops confirms your fiat deposit.`,
  };
}
