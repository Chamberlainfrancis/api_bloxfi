/**
 * Offramp quote math: transfer fee on send, LP conversion, platform fee on fiat receive.
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

  const usable =
    params.feeInSendCurrency != null && Number.isFinite(params.feeInSendCurrency);
  const transferFeeInSend =
    usable && params.feeInSendCurrency! > 0 ? params.feeInSendCurrency! : 0;

  const sendNet = Math.max(0, sendAmount - transferFeeInSend);
  const baseReceiveNet = sendNet * baseConversionRate;
  const applied = applyOfframpPlatformFee(baseReceiveNet, platformFee);
  const allInConversionRate = sendAmount > 0 ? applied.netAmount / sendAmount : 0;

  return {
    sendGross: sendAmount,
    sendNet,
    receiveGross,
    baseReceiveNet,
    receiveNet: applied.netAmount,
    transferFeeInSend,
    platformFeeAmount: applied.feeAmount,
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
