/**
 * Palremit onramp: fiat → crypto via Currency API (quote) + crypto withdrawal to user wallet.
 * docs/palremit_integration_guide.md §6.2 (prepare + confirm crypto withdrawal).
 * Fiat is debited from your Palremit-integrated balance (source_currency / source_amount).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { preparePalremitCryptoWithdrawal, confirmPalremitCryptoWithdrawal } from '@/core/integrations/palremitLiquidity';
import { CHAIN_TO_PALREMIT_NETWORK } from '@/core/integrations/palremit';
import type { CreateOnrampRequest } from '@/types/onramp';

export interface PalremitOnrampWithdrawResult {
  prepareReference: string;
  /** After confirm — same reference chain */
  confirmed: boolean;
}

/**
 * Execute crypto payout to user's external wallet. Debits source_currency balance at Palremit.
 * Onramp fee: map FIX to app_fee in destination (crypto) currency; PERCENT as proportional app_fee on crypto leg.
 */
export async function executePalremitOnrampCryptoWithdrawal(
  liquidityRequest: PalremitLiquidityRequestFn,
  body: Omit<CreateOnrampRequest, 'requestId'>,
  requestId: string,
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
