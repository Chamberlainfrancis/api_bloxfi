/**
 * Palremit withdrawal fee/quote preview (POST /v1/withdrawals/quote).
 *
 * BloxFi's only counterparty is Palremit. This fetches the payout fee Palremit
 * will charge for a withdrawal BEFORE we create it, so the fee can be deducted
 * from the customer's receive amount and shown transparently. The response is
 * provider-neutral: it never names a downstream provider or funding asset.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

export interface PalremitWithdrawalQuoteFee {
  kind: string;
  amount: string;
  currency: string;
}

export interface PalremitWithdrawalFeeQuote {
  /** True when Palremit can't preview a fee for this corridor (treat fee as unknown, not zero). */
  feeUnavailable: boolean;
  fees: PalremitWithdrawalQuoteFee[];
  totalFee: { amount: string; currency: string } | null;
  destinationAmount: string | null;
  effectiveRate: string | null;
  expiresAt: string | null;
}

export interface FetchWithdrawalFeeQuoteInput {
  /** Withdrawal asset: payout fiat for fiat corridors; crypto for crypto_address. */
  asset: string;
  /** Withdrawal amount (payout fiat for fiat; crypto for crypto_address). */
  amount: number;
  destinationType: string;
  country?: string | null;
  network?: string | null;
  beneficiaryType?: 'individual' | 'business' | null;
}

interface RawQuoteBody {
  fee_unavailable?: unknown;
  fees?: unknown;
  total_fee?: unknown;
  destination_amount?: unknown;
  effective_rate?: unknown;
  expires_at?: unknown;
}

function parseFees(raw: unknown): PalremitWithdrawalQuoteFee[] {
  if (!Array.isArray(raw)) return [];
  const out: PalremitWithdrawalQuoteFee[] = [];
  for (const f of raw) {
    if (f == null || typeof f !== 'object') continue;
    const o = f as Record<string, unknown>;
    const kind = typeof o.kind === 'string' ? o.kind : '';
    const amount = typeof o.amount === 'string' ? o.amount : '';
    const currency = typeof o.currency === 'string' ? o.currency : '';
    if (kind && amount && currency) out.push({ kind, amount, currency });
  }
  return out;
}

function parseTotalFee(raw: unknown): { amount: string; currency: string } | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return typeof o.amount === 'string' && typeof o.currency === 'string'
    ? { amount: o.amount, currency: o.currency }
    : null;
}

/**
 * Fetch the Palremit payout fee quote. Returns null on transport/HTTP failure
 * so callers can fail soft (treat the fee as unknown) rather than block a ramp.
 */
export async function fetchPalremitWithdrawalFeeQuote(
  liquidityRequest: PalremitLiquidityRequestFn,
  input: FetchWithdrawalFeeQuoteInput
): Promise<PalremitWithdrawalFeeQuote | null> {
  const amount = typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : 0;
  if (amount <= 0) return null;

  const body: Record<string, unknown> = {
    asset: input.asset.trim().toUpperCase(),
    amount,
    destination_type: input.destinationType,
  };
  if (input.country && input.country.trim()) body.country = input.country.trim().toUpperCase();
  if (input.network && input.network.trim()) body.network = input.network.trim();
  if (input.beneficiaryType) body.beneficiary_type = input.beneficiaryType;

  let res: { status: number; data: RawQuoteBody };
  try {
    res = await liquidityRequest<RawQuoteBody>('/v1/withdrawals/quote', { method: 'POST', body });
  } catch {
    return null;
  }
  if (res.status !== 200 || res.data == null || typeof res.data !== 'object') return null;

  const d = res.data;
  return {
    feeUnavailable: d.fee_unavailable === true,
    fees: parseFees(d.fees),
    totalFee: parseTotalFee(d.total_fee),
    destinationAmount: typeof d.destination_amount === 'string' ? d.destination_amount : null,
    effectiveRate: typeof d.effective_rate === 'string' ? d.effective_rate : null,
    expiresAt: typeof d.expires_at === 'string' ? d.expires_at : null,
  };
}
