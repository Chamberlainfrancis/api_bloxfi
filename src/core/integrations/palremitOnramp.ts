/**
 * Palremit onramp: `/deposits/create_fiat_deposit` for bank instructions; §6.2 crypto withdrawal after fiat processed.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  createPalremitFiatDeposit,
  preparePalremitCryptoWithdrawal,
  confirmPalremitCryptoWithdrawal,
} from '@/core/integrations/palremitLiquidity';
import { CHAIN_TO_PALREMIT_NETWORK } from '@/core/integrations/palremit';
import type { CreateOnrampRequest } from '@/types/onramp';
import type { DepositInfo } from '@/types/onramp';

function pickStr(d: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = d[k];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

function nestedObject(d: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const v = d[key];
  if (v != null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/**
 * Map LP `create_fiat_deposit` payload to BloxFi DepositInfo (handles common snake/camel keys).
 */
export function mapPalremitFiatDepositResponseToDepositInfo(
  raw: Record<string, unknown>,
  bloxRequestId: string,
  depositByIso: string,
  sourceAmount: number,
  sourceCurrencyUpper: string
): DepositInfo {
  const payment = nestedObject(raw, 'payment_information') ?? nestedObject(raw, 'paymentInformation');

  const ref =
    pickStr(raw, ['reference', 'deposit_reference', 'depositReference', 'id']) ??
    (payment ? pickStr(payment, ['reference', 'narration', 'narrative']) : undefined) ??
    bloxRequestId;

  const bankName =
    pickStr(raw, ['bank_name', 'bankName', 'provider_name', 'providerName']) ??
    (payment ? pickStr(payment, ['bank_name', 'bankName', 'bank']) : undefined) ??
    'Palremit';

  const accountNumber =
    pickStr(raw, ['account_number', 'accountNumber', 'account_unique', 'accountUnique']) ??
    (payment ? pickStr(payment, ['account_number', 'accountNumber', 'account']) : undefined);

  const routing =
    pickStr(raw, ['routing_number', 'routingNumber', 'sort_code', 'sortCode', 'bank_code', 'bankCode']) ??
    (payment
      ? pickStr(payment, ['routing_number', 'routingNumber', 'sort_code', 'bank_code'])
      : undefined);

  const beneficiaryName =
    pickStr(raw, ['beneficiary_name', 'beneficiaryName', 'account_name', 'accountName']) ??
    (payment ? pickStr(payment, ['beneficiary_name', 'account_name']) : undefined) ??
    'Beneficiary';

  const wire =
    accountNumber != null && accountNumber !== '' || routing != null && routing !== ''
      ? { routingNumber: routing ?? '', accountNumber: accountNumber ?? '' }
      : undefined;

  const pixKey = pickStr(raw, ['pix_key', 'pixKey']) ?? (payment ? pickStr(payment, ['pix_key', 'pixKey']) : undefined);
  const pix = pixKey ? { pixKey } : undefined;

  return {
    bankName,
    beneficiary: {
      name: beneficiaryName,
      address: pickStr(raw, ['beneficiary_address', 'beneficiaryAddress']) ?? '',
    },
    ach: undefined,
    wire,
    pix,
    reference: ref,
    depositBy: depositByIso,
    instruction: `Deposit ${sourceAmount} ${sourceCurrencyUpper} using reference ${ref} before ${depositByIso}. Crypto is sent after your fiat deposit is confirmed.`,
  };
}

export async function createOnrampPalremitFiatDeposit(
  liquidityRequest: PalremitLiquidityRequestFn,
  params: {
    firstName: string;
    lastName: string;
    email: string;
    currency: string;
    amount: number;
    bloxRequestId: string;
    depositByIso: string;
  }
): Promise<DepositInfo | null> {
  const data = await createPalremitFiatDeposit(liquidityRequest, {
    first_name: params.firstName,
    last_name: params.lastName,
    email: params.email,
    currency: params.currency.toUpperCase(),
    amount: params.amount,
  });
  if (!data) return null;
  return mapPalremitFiatDepositResponseToDepositInfo(
    data,
    params.bloxRequestId,
    params.depositByIso,
    params.amount,
    params.currency.toUpperCase()
  );
}

export interface PalremitOnrampWithdrawResult {
  prepareReference: string;
  confirmed: boolean;
}

export async function executePalremitOnrampCryptoWithdrawal(
  liquidityRequest: PalremitLiquidityRequestFn,
  body: Omit<CreateOnrampRequest, 'requestId'>,
  _requestId: string,
  receiveNetCryptoAmount: number,
  destinationAddress: string
): Promise<PalremitOnrampWithdrawResult | null> {
  const fromCurrency = body.source.currency.trim().toUpperCase();
  const destCurrency = body.destination.currency.trim().toUpperCase();
  const destNetwork =
    CHAIN_TO_PALREMIT_NETWORK[body.destination.chain.trim().toUpperCase()] ??
    body.destination.chain.trim().toUpperCase();

  let appFee: number | undefined;
  let appFeeCurrency: string | undefined;
  if (body.fee.type === 'FIX') {
    appFee = body.fee.value;
    appFeeCurrency = destCurrency;
  } else {
    appFee = receiveNetCryptoAmount * body.fee.value;
    appFeeCurrency = destCurrency;
  }

  const prepared = await preparePalremitCryptoWithdrawal(liquidityRequest, {
    source_amount: body.source.amount,
    source_currency: fromCurrency,
    destination_currency: destCurrency,
    destination_network: destNetwork,
    destination_address: destinationAddress,
    destination_token: 'default',
    app_fee: appFee,
    app_fee_currency: appFeeCurrency,
  });
  if (!prepared?.reference) return null;

  const confirmed = await confirmPalremitCryptoWithdrawal(liquidityRequest, prepared.reference);
  if (!confirmed) return null;

  return { prepareReference: prepared.reference, confirmed: true };
}
