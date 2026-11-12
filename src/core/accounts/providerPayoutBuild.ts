/**
 * Validate + normalize a Palremit destination against live corridor requirements.
 * Shared by account create and account update.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { getPalremitWithdrawalCorridorDetail } from '@/core/integrations/palremitCorridors';
import { validateDestinationAgainstCorridorFields } from '@/core/integrations/palremitCorridorValidate';
import { normalizePalremitDestination } from '@/core/accounts/normalizePalremitDestination';
import type { PayoutCorridor, ProviderPayout } from '@/types/account';
import { buildWithdrawalFromAccount } from '@/core/integrations/palremitOfframp';
import {
  PayoutDestinationInvalidError,
  validatePalremitDestination,
  type PalremitDestinationProblem,
} from '@/core/integrations/palremitDestinationCheck';
import {
  applyPurposePolicyToFields,
  DEFAULT_PURPOSE_POLICY,
  destinationPurposeErrors,
  type PurposePolicy,
} from '@/core/payoutPurposes';

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
  destinationInput: Record<string, unknown>,
  policy: PurposePolicy = DEFAULT_PURPOSE_POLICY
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
    applyPurposePolicyToFields(detail.destination_fields, policy)
  );
  const errors = [...destinationPurposeErrors(destination, policy), ...validation.errors];
  if (errors.length > 0) {
    const msg = errors.map((e) => `${e.path}: ${e.message}`).join('; ');
    throw new Error(`INVALID_ACCOUNT: ${msg}`);
  }

  const providerPayout: ProviderPayout = {
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

  await assertPalremitAcceptsDestination(liquidityRequest, providerPayout, policy);
  return providerPayout;
}

// Filled in when the offramp is created (purpose from the offramp, email and
// date of birth from the customer), so a saved account may lack them.
const FILLED_AT_OFFRAMP = new Set([
  'destination.extras.transfer_purpose',
  'destination.beneficiary.dob',
  'destination.beneficiary.email',
]);

function blocksAccount(e: PalremitDestinationProblem): boolean {
  return !(e.code === 'required' && FILLED_AT_OFFRAMP.has(e.field));
}

/**
 * Ask Palremit whether the payout it would build from this account passes its
 * checks (province codes, postal formats, address country, ...). Rejects with
 * the field errors; lets the account through if Palremit can't answer.
 */
async function assertPalremitAcceptsDestination(
  liquidityRequest: PalremitLiquidityRequestFn,
  providerPayout: ProviderPayout,
  policy: PurposePolicy
): Promise<void> {
  const body = buildWithdrawalFromAccount({
    txnRef: 'account-validate',
    destinationAmount: 1,
    providerPayout,
    purposePolicy: policy,
  });
  if (!body) return;
  delete body.amount;
  const check = await validatePalremitDestination(liquidityRequest, body);
  if (check.status !== 'invalid') return;
  const errors = check.errors.filter(blocksAccount);
  if (errors.length > 0) throw new PayoutDestinationInvalidError(errors);
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
