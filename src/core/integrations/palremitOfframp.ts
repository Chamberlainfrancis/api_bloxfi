/**
 * Palremit offramp flow: ensure customer, create offramp order, map to our DTOs.
 * Uses API_INTEGRATION_GUIDE §4.1 (customer profile) and §4.3 (create offramp order).
 */

import type { PalremitLiquidityRequestFn } from './palremitLiquidity';
import {
  createPalremitCustomerProfile,
  createPalremitOfframpOrder,
  type PalremitOfframpOrder,
} from './palremitLiquidity';
import { CHAIN_TO_PALREMIT_NETWORK } from './palremit';
import type { DepositInstructions } from '../../types/offramp';
import type { CreateOfframpRequest } from '../../types/offramp';

export interface PalremitOfframpResult {
  reference: string;
  depositInstructions: DepositInstructions;
  destinationAmount?: number;
}

function buildCustomerProfileFromUser(businessInfo: unknown): {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  country: string;
} {
  const info = (businessInfo && typeof businessInfo === 'object'
    ? businessInfo
    : {}) as Record<string, unknown>;
  const legalName = (info.legalName as string) ?? (info.tradingName as string) ?? '';
  const [first = '', ...rest] = legalName.trim().split(/\s+/);
  const last = rest.join(' ') || 'N/A';
  const address = info.registeredAddress as Record<string, unknown> | undefined;
  const country = (address?.country as string) ?? (info.country as string) ?? 'NG';
  const countryCode = typeof country === 'string' && country.length >= 2 ? country.slice(0, 2).toUpperCase() : 'NG';
  return {
    first_name: first || 'Customer',
    last_name: last || 'User',
    email: (info.email as string) ?? '',
    phone: (info.phone as string) ?? '+2340000000000',
    date_of_birth: (info.dateOfBirth as string) ?? (info.date_of_birth as string) ?? '1990-01-01',
    country: countryCode,
  };
}

function buildDestinationInformation(
  accountHolder: unknown,
  regionDetails: unknown
): Record<string, string> {
  const holder = (accountHolder && typeof accountHolder === 'object'
    ? accountHolder
    : {}) as Record<string, unknown>;
  const region = (regionDetails && typeof regionDetails === 'object'
    ? regionDetails
    : {}) as Record<string, unknown>;
  return {
    bank_name: (region.bankName as string) ?? (region.bank_name as string) ?? 'Bank',
    bank_code: (region.bankCode as string) ?? (region.bank_code as string) ?? '00',
    account_number: (region.accountNumber as string) ?? (region.account_number as string) ?? '',
    account_name: (holder.name as string) ?? (holder.account_name as string) ?? 'Account Holder',
  };
}

function mapOrderToDepositInstructions(
  order: PalremitOfframpOrder,
  depositBy: string
): DepositInstructions {
  const pi = order.payment_information;
  return {
    address: pi?.address ?? '',
    amount: pi?.amount != null ? String(pi.amount) : '',
    currency: pi?.currency ?? order.source_currency ?? '',
    network: pi?.network_code ?? order.source_network ?? '',
    networkName: pi?.network_name,
    token: pi?.token,
    depositBy,
    instruction: pi?.address
      ? `Send exactly ${pi?.amount ?? ''} ${pi?.currency ?? ''} to the address above by ${depositBy}`
      : undefined,
  };
}

/**
 * Create offramp via Palremit: ensure customer profile exists, then create offramp order.
 * Returns reference, deposit instructions, and destination amount for the core to persist.
 */
export async function createOfframpViaPalremit(
  liquidityRequest: PalremitLiquidityRequestFn,
  user: { businessInfo: unknown },
  account: { accountHolder: unknown; regionDetails: unknown; paymentRail: string },
  body: Omit<CreateOfframpRequest, 'requestId'>,
  depositBy: string
): Promise<PalremitOfframpResult | null> {
  const profile = buildCustomerProfileFromUser(user.businessInfo);
  if (!profile.email) return null;

  const customer = await createPalremitCustomerProfile(liquidityRequest, profile);
  if (!customer) return null;

  const fromCurrency = body.source.currency.trim().toUpperCase();
  const toCurrency = body.destination.currency.trim().toUpperCase();
  const sourceNetwork =
    CHAIN_TO_PALREMIT_NETWORK[body.source.chain.trim().toUpperCase()] ?? body.source.chain.trim().toUpperCase();
  const destinationInformation = buildDestinationInformation(
    account.accountHolder,
    account.regionDetails
  );
  if (!destinationInformation.account_number) return null;

  const appFee =
    body.platformFee.type === 'FLAT'
      ? { value: body.platformFee.value, unit: toCurrency }
      : undefined;
  // For PERCENTAGE we could compute a fixed fee from estimated amount; Palremit app_fee is fixed value
  const orderBody = {
    customer_id: customer._id,
    source_amount: body.source.amount,
    source_currency: fromCurrency,
    source_network: sourceNetwork,
    destination_type: 'bank_account' as const,
    destination_currency: toCurrency,
    destination_information: destinationInformation,
    app_fee: appFee,
  };

  const order = await createPalremitOfframpOrder(liquidityRequest, orderBody);
  if (!order) return null;

  const depositInstructions = mapOrderToDepositInstructions(order, depositBy);
  return {
    reference: order.reference,
    depositInstructions,
    destinationAmount: order.destination_amount,
  };
}
