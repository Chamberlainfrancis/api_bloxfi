/**
 * Offramp quote math: platform fee on the SOURCE crypto (gross), then the
 * provider transfer fee on the send side, then LP conversion to fiat.
 */

import type { PlatformFee } from '@/types/offramp';
import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';

export interface OfframpQuoteAmounts {
  sendGross: number;
  sendNet: number;
  receiveGross: number;
  baseReceiveNet: number;
  receiveNet: number;
  transferFeeInSend: number;
  platformFeeAmount: number;
  baseConversionRate: number;
  allInConversionRate: number;
}

export function computeOfframpQuoteAmounts(params: {
  sendAmount: number;
  baseConversionRate: number;
  feeInSendCurrency: number | null;
  platformFee: PlatformFee;
}): OfframpQuoteAmounts {
  const { sendAmount, baseConversionRate, platformFee } = params;
  const receiveGross = sendAmount * baseConversionRate;

  // Platform fee is retained from the source crypto (the only asset we custody
  // on an offramp), taken from the gross send before the transfer fee.
  const applied = applyOfframpPlatformFee(sendAmount, platformFee);
  const platformFeeAmount = applied.feeAmount;

  const usable =
    params.feeInSendCurrency != null && Number.isFinite(params.feeInSendCurrency);
  const transferFeeInSend =
    usable && params.feeInSendCurrency! > 0 ? params.feeInSendCurrency! : 0;

  const sendNet = Math.max(0, sendAmount - platformFeeAmount - transferFeeInSend);
  // Fiat the recipient would get with the transfer fee but WITHOUT the platform
  // markup — surfaced for transparency (see types/offramp.ts baseReceiveNet).
  const baseReceiveNet = Math.max(0, sendAmount - transferFeeInSend) * baseConversionRate;
  const receiveNet = sendNet * baseConversionRate;
  const allInConversionRate = sendAmount > 0 ? receiveNet / sendAmount : 0;

  return {
    sendGross: sendAmount,
    sendNet,
    receiveGross,
    baseReceiveNet,
    receiveNet,
    transferFeeInSend,
    platformFeeAmount,
    baseConversionRate,
    allInConversionRate,
  };
}

export function formatOfframpConversionRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0';
  return rate.toFixed(11);
}

export function formatOfframpInverseRate(conversionRate: number): string {
  if (!Number.isFinite(conversionRate) || conversionRate <= 0) return '0';
  return (1 / conversionRate).toFixed(6);
}
