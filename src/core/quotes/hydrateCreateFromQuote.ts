import { usdOfframpOptionalMetadataSchema, usdPalremitTransferPurposeSchema } from '@/schemas/usdGlobalBank.zod';
import type {
  CreateOfframpDestinationInput,
  CreateOfframpRequest,
  CreateOfframpSourceInput,
} from '@/types/offramp';
import type { OfframpQuoteSnapshot, OnrampQuoteSnapshot } from '@/types/quote';
import type {
  CreateOnrampDestinationInput,
  CreateOnrampRequest,
  CreateOnrampSourceInput,
} from '@/types/onramp';

export function validateUsdOfframpMetadata(
  toCurrency: string,
  purposeOfPayment: string,
  metadata: Record<string, unknown> | undefined
): string | null {
  if (toCurrency.toLowerCase() !== 'usd') return null;
  const pp = usdPalremitTransferPurposeSchema.safeParse(purposeOfPayment.trim());
  if (!pp.success) return pp.error.errors[0]?.message ?? 'Invalid purposeOfPayment for USD';
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return 'metadata is required for USD offramp (isSelfTransfer)';
  }
  const mp = usdOfframpOptionalMetadataSchema.safeParse(metadata);
  if (!mp.success) return mp.error.errors[0]?.message ?? 'Invalid metadata for USD offramp';
  return null;
}

export function hydrateOfframpCreateFromQuote(
  snapshot: OfframpQuoteSnapshot,
  execution: {
    source: Pick<CreateOfframpSourceInput, 'userId' | 'externalWalletId'>;
    destination: Pick<
      CreateOfframpDestinationInput,
      'userId' | 'accountId' | 'purposeOfPayment' | 'transferType' | 'bankTransferMethod' | 'reference'
    >;
    metadata?: Record<string, unknown>;
  }
): Omit<CreateOfframpRequest, 'requestId'> {
  return {
    source: {
      userId: execution.source.userId,
      externalWalletId: execution.source.externalWalletId,
      amount: snapshot.sendAmount,
      currency: snapshot.fromCurrency,
      chain: snapshot.fromChain,
    },
    destination: {
      userId: execution.destination.userId,
      accountId: execution.destination.accountId,
      currency: snapshot.toCurrency,
      amount: snapshot.destinationAmount,
      purposeOfPayment: execution.destination.purposeOfPayment,
      transferType: execution.destination.transferType,
      bankTransferMethod: execution.destination.bankTransferMethod,
      reference: execution.destination.reference,
    },
    platformFee: snapshot.platformFee,
    ...(execution.metadata !== undefined ? { metadata: execution.metadata } : {}),
  };
}

export function hydrateOnrampCreateFromQuote(
  snapshot: OnrampQuoteSnapshot,
  execution: {
    source: Pick<CreateOnrampSourceInput, 'userId' | 'transferType'>;
    destination: Pick<CreateOnrampDestinationInput, 'userId' | 'externalWalletId'>;
    purposeOfPayment?: string;
  }
): Omit<CreateOnrampRequest, 'requestId'> {
  return {
    source: {
      userId: execution.source.userId,
      currency: snapshot.fromCurrency,
      amount: snapshot.sendAmount,
      transferType: execution.source.transferType,
    },
    destination: {
      userId: execution.destination.userId,
      externalWalletId: execution.destination.externalWalletId,
      currency: snapshot.toCurrency,
      chain: snapshot.destinationChain,
    },
    platformFee: snapshot.platformFee,
    purposeOfPayment: execution.purposeOfPayment,
  };
}
