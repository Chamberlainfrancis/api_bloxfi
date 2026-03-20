/**
 * Palremit offramp: crypto → fiat via Deposits API (receive crypto) + Withdrawals API (fiat payout).
 * docs/palremit_integration_guide.md §5 (deposits), §6.1 (fiat withdrawal).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  createPalremitCryptoAddress,
  createPalremitFiatWithdrawal,
  confirmPalremitFiatWithdrawal,
  listPalremitCryptoDeposits,
} from '@/core/integrations/palremitLiquidity';
import { CHAIN_TO_PALREMIT_NETWORK } from '@/core/integrations/palremit';
import type { DepositInstructions } from '@/types/offramp';
import type { CreateOfframpRequest } from '@/types/offramp';

export interface PalremitOfframpDepositResult {
  /** Correlation: BloxFi offramp requestId (used for fiat withdrawal reference prefix). */
  correlationId: string;
  depositInstructions: DepositInstructions;
  /** Palremit crypto address metadata for deposit matching. */
  channelAddressId?: string;
}

function mapCryptoAddressToDepositInstructions(
  addr: { address: string; currency: string; network: string; channel_address_id?: string },
  amount: number,
  depositBy: string
): DepositInstructions {
  return {
    address: addr.address,
    amount: String(amount),
    currency: addr.currency,
    network: addr.network,
    depositBy,
    instruction: `Send exactly ${amount} ${addr.currency} on ${addr.network} to the address above by ${depositBy}`,
  };
}

/**
 * Create offramp receive leg: Palremit crypto deposit address for existing channel user (BloxFi userId).
 */
export async function createOfframpPalremitCryptoDeposit(
  liquidityRequest: PalremitLiquidityRequestFn,
  userId: string,
  body: Omit<CreateOfframpRequest, 'requestId'>,
  requestId: string,
  depositBy: string
): Promise<PalremitOfframpDepositResult | null> {
  const fromCurrency = body.source.currency.trim().toUpperCase();
  const sourceNetwork =
    CHAIN_TO_PALREMIT_NETWORK[body.source.chain.trim().toUpperCase()] ??
    body.source.chain.trim().toUpperCase();

  const addr = await createPalremitCryptoAddress(liquidityRequest, {
    channel_user_id: userId,
    currency: fromCurrency,
    network: sourceNetwork,
  });
  if (!addr?.address) return null;

  return {
    correlationId: requestId,
    depositInstructions: mapCryptoAddressToDepositInstructions(
      addr,
      body.source.amount,
      depositBy
    ),
    channelAddressId: addr.channel_address_id,
  };
}

/**
 * Build Palremit §6.1.3 fiat withdrawal destination_information from BloxFi Account region + holder.
 */
export function buildPalremitFiatDestinationInformation(
  accountHolder: unknown,
  regionDetails: unknown
): Record<string, string> {
  const holder = (accountHolder && typeof accountHolder === 'object'
    ? accountHolder
    : {}) as Record<string, unknown>;
  const region = (regionDetails && typeof regionDetails === 'object'
    ? regionDetails
    : {}) as Record<string, unknown>;
  const accountNumber =
    (region.accountNumber as string) ?? (region.account_number as string) ?? '';
  const bankName = (region.bankName as string) ?? (region.bank_name as string) ?? 'Bank';
  const bankCode = (region.bankCode as string) ?? (region.bank_code as string) ?? '00';
  const accountName =
    (holder.name as string) ?? (holder.account_name as string) ?? 'Account Holder';
  const country =
    typeof region.country === 'string' && region.country.length >= 2
      ? String(region.country).slice(0, 2).toUpperCase()
      : 'NG';
  return {
    account_unique: accountNumber,
    account_name: accountName,
    provider_name: bankName,
    provider_code: bankCode,
    country,
  };
}

const DEPOSIT_OK_STATUSES = ['successful', 'success', 'completed', 'confirmed'];

/**
 * After user sends crypto, list deposits and if matched, create + confirm fiat withdrawal.
 */
export async function tryPalremitOfframpFiatPayout(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: {
    offrampId: string;
    requestId: string;
    expectedCryptoAmount: number;
    depositAddress: string;
    sourceCurrency: string;
    sourceNetwork: string;
    destinationAmount: number;
    destinationCurrency: string;
    destinationInformation: Record<string, string>;
  }
): Promise<{ withdrawalReference: string } | null> {
  const deposits = await listPalremitCryptoDeposits(liquidityRequest, {
    currency: params.sourceCurrency,
    network: params.sourceNetwork,
    limit: 50,
  });
  if (!deposits?.length) return null;

  const normalizedAddr = params.depositAddress.toLowerCase();
  const match = deposits.find((d) => {
    const dest = (d.destination_address ?? '').toLowerCase();
    const okAddr = dest === normalizedAddr || dest.includes(normalizedAddr) || normalizedAddr.includes(dest);
    const amtOk = d.amount >= params.expectedCryptoAmount * 0.99;
    const st = (d.status ?? '').toLowerCase();
    const okStatus = DEPOSIT_OK_STATUSES.some((s) => st.includes(s));
    return okAddr && amtOk && okStatus;
  });
  if (!match) return null;

  const reference = `WTH-OFF-${params.offrampId.slice(0, 8)}-${params.requestId.slice(0, 8)}`;
  const created = await createPalremitFiatWithdrawal(liquidityRequest, {
    reference,
    destination_amount: params.destinationAmount,
    destination_currency: params.destinationCurrency.toUpperCase(),
    destination_type: 'bank_account',
    destination_information: params.destinationInformation,
  });
  if (!created?.reference) return null;

  const confirmed = await confirmPalremitFiatWithdrawal(liquidityRequest, created.reference);
  if (!confirmed) return null;

  return { withdrawalReference: created.reference };
}
