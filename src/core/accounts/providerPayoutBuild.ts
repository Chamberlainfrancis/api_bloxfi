/**
 * Validate + normalize a Palremit destination against live corridor requirements.
 * Shared by account create and account update.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { getPalremitWithdrawalCorridorDetail } from '@/core/integrations/palremitCorridors';
import { validateDestinationAgainstCorridorFields } from '@/core/integrations/palremitCorridorValidate';
import { normalizePalremitDestination } from '@/core/accounts/normalizePalremitDestination';
import type { PayoutCorridor, ProviderPayout } from '@/types/account';

export function ensureBeneficiaryType(
  destination: Record<string, unknown>,
  beneficiaryType: PayoutCorridor['beneficiaryType']
): void {
  const ben = destination.beneficiary;
  if (ben != null && typeof ben === 'object' && !Array.isArray(ben)) {
    const b = ben as Record<string, unknown>;
    if (b.type == null || b.type === '') {
      b.type = beneficiaryType;
    }
  }
}

export async function buildValidatedProviderPayout(
  liquidityRequest: PalremitLiquidityRequestFn,
  corridor: PayoutCorridor,
  destinationInput: Record<string, unknown>
): Promise<ProviderPayout> {
  const destination = normalizePalremitDestination({ ...destinationInput });
  ensureBeneficiaryType(destination, corridor.beneficiaryType);

  const detail = await getPalremitWithdrawalCorridorDetail(liquidityRequest, {
    asset: corridor.asset,
    country: corridor.country,
    destinationType: corridor.destinationType,
    beneficiaryType: corridor.beneficiaryType,
  });

  const validation = validateDestinationAgainstCorridorFields(
    destination,
    detail.destination_fields
  );
  if (!validation.valid) {
    const msg = validation.errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`INVALID_ACCOUNT: ${msg}`);
  }

  return {
    provider: 'palremit',
    schemaVersion: 2,
    corridor: {
      asset: corridor.asset,
      country: corridor.country,
      destinationType: corridor.destinationType,
      beneficiaryType: corridor.beneficiaryType,
    },
    destination,
    requirementsSnapshot: {
      fetchedAt: new Date().toISOString(),
      corridor: detail.corridor as unknown as Record<string, unknown>,
      destinationFields: detail.destination_fields,
    },
  };
}

export function rethrowPalremitCorridorError(e: unknown): never {
  if (e instanceof Error) {
    if (e.message === 'PALREMIT_CORRIDOR_UNSUPPORTED') {
      throw new Error('INVALID_ACCOUNT: payout corridor not supported');
    }
    if (
      e.message === 'PALREMIT_CORRIDORS_UNAVAILABLE' ||
      e.message === 'PALREMIT_CORRIDOR_INVALID_RESPONSE'
    ) {
      throw new Error('PALREMIT_CORRIDORS_UNAVAILABLE');
    }
    if (e.message.startsWith('INVALID_ACCOUNT:')) throw e;
  }
  throw e;
}
