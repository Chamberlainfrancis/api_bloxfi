/**
 * Onramp quote math: fiat send → crypto receive. Dest-fixed inverts that
 * so the customer receives a locked crypto amount after platform + network fees.
 *
 * conversionRate is Palremit/customer FX: `rateCurrency` per `perCurrency`.
 * Typical onramp (fiat → USDT): to === perCurrency, sendFiat = crypto × rate.
 */

import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';
import type { PlatformFee } from '@/types/offramp';

export interface OnrampDestFixedAmounts {
  sendGross: number;
  receiveGross: number;
  receiveAfterPlatformFee: number;
  receiveNet: number;
  platformFeeAmount: number;
  transferFeeCrypto: number;
}

/** Fiat the customer must send to obtain `cryptoAmount` of `toCurrency` at `conversionRate`. */
export function fiatFromCrypto(params: {
  cryptoAmount: number;
  conversionRate: number;
  toCurrency: string;
  rateCurrency?: string | null;
  perCurrency?: string | null;
}): number {
  const { cryptoAmount, conversionRate } = params;
  if (!(cryptoAmount > 0) || !(conversionRate > 0)) return 0;
  const to = params.toCurrency.trim().toUpperCase();
  const rc = params.rateCurrency?.trim().toUpperCase();
  const pc = params.perCurrency?.trim().toUpperCase();
  if (rc && to === rc) return cryptoAmount / conversionRate;
  return cryptoAmount * conversionRate;
}

/**
 * Dest-fixed onramp: lock crypto receiveNet, back-solve fiat send.
 * Adds transfer fee then inverts the platform fee, then converts to fiat.
 */
export function solveOnrampSendFromDest(params: {
  destinationAmount: number;
  conversionRate: number;
  transferFeeCrypto: number | null;
  platformFee: PlatformFee;
  toCurrency: string;
  rateCurrency?: string | null;
  perCurrency?: string | null;
}): OnrampDestFixedAmounts {
  const dest = params.destinationAmount;
  const rate = params.conversionRate;
  const transferFeeCrypto =
    params.transferFeeCrypto != null &&
    Number.isFinite(params.transferFeeCrypto) &&
    params.transferFeeCrypto > 0
      ? params.transferFeeCrypto
      : 0;

  if (!(dest > 0) || !(rate > 0)) {
    return {
      sendGross: 0,
      receiveGross: 0,
      receiveAfterPlatformFee: 0,
      receiveNet: dest,
      platformFeeAmount: 0,
      transferFeeCrypto,
    };
  }

  const receiveAfterPlatformFee = dest + transferFeeCrypto;
  let receiveGross: number;
  if (params.platformFee.type === 'FLAT') {
    receiveGross = receiveAfterPlatformFee + Math.max(0, Number(params.platformFee.value));
  } else {
    const p = Math.max(0, Math.min(0.999999, Number(params.platformFee.value)));
    receiveGross = p >= 1 ? 0 : receiveAfterPlatformFee / (1 - p);
  }

  const applied = applyOfframpPlatformFee(Math.max(0, receiveGross), params.platformFee);
  const sendGross = fiatFromCrypto({
    cryptoAmount: applied.grossAmount,
    conversionRate: rate,
    toCurrency: params.toCurrency,
    rateCurrency: params.rateCurrency,
    perCurrency: params.perCurrency,
  });

  return {
    sendGross,
    receiveGross: applied.grossAmount,
    receiveAfterPlatformFee: applied.netAmount,
    receiveNet: dest,
    platformFeeAmount: applied.feeAmount,
    transferFeeCrypto,
  };
}
