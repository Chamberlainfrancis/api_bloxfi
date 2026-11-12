/**
 * Palremit Liquidity — POST /v1/withdrawals/validate-destination.
 *
 * Runs the checks Palremit's POST /v1/withdrawals runs on a payout destination
 * (provider schema, province codes, postal formats, address country, purposes
 * the payout partner rejects) without creating anything. We call it when a
 * beneficiary account is saved and before an offramp's deposit instructions are
 * issued, so bad bank or address data is caught before the client pays.
 *
 * If Palremit can't answer (network, 5xx, older Palremit without the route) we
 * let the request through and log it: withdrawal create still validates.
 */

import { logger } from '@/lib/logger';
import { isHttpError } from '@/services/http';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

export interface PalremitDestinationProblem {
  field: string;
  code: string;
  message: string;
  hint?: string;
}

export type PalremitDestinationCheck =
  | { status: 'valid'; warnings: PalremitDestinationProblem[] }
  | { status: 'invalid'; errors: PalremitDestinationProblem[]; warnings: PalremitDestinationProblem[] }
  | { status: 'unavailable' };

const PATH = '/v1/withdrawals/validate-destination';

function problems(raw: unknown): PalremitDestinationProblem[] {
  if (!Array.isArray(raw)) return [];
  const out: PalremitDestinationProblem[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const message = typeof o.message === 'string' ? o.message : '';
    const field = typeof o.field === 'string' ? o.field : typeof o.path === 'string' ? o.path : '';
    if (!message && !field) continue;
    out.push({
      field,
      code: typeof o.code === 'string' ? o.code : 'invalid',
      message: message || `${field} is invalid`,
      ...(typeof o.hint === 'string' && o.hint ? { hint: o.hint } : {}),
    });
  }
  return out;
}

/** Field errors from a Palremit 400 `validation_failed` body ({ details: [{ path, code }] }). */
function zodDetails(raw: unknown): PalremitDestinationProblem[] {
  if (raw == null || typeof raw !== 'object') return [];
  const details = (raw as Record<string, unknown>).details;
  if (!Array.isArray(details)) return [];
  return details
    .filter((d): d is { path: string; code?: string } => d != null && typeof (d as { path?: unknown }).path === 'string')
    .map((d) => ({
      field: d.path,
      code: typeof d.code === 'string' ? d.code : 'invalid',
      message: `${d.path} is invalid`,
    }));
}

/**
 * @param body A Palremit fiat withdrawal body: asset, country, destination_type,
 *   destination and optionally amount. Other keys are ignored by Palremit.
 */
export async function validatePalremitDestination(
  request: PalremitLiquidityRequestFn,
  body: Record<string, unknown>
): Promise<PalremitDestinationCheck> {
  const payload: Record<string, unknown> = {
    asset: body.asset,
    country: body.country,
    destination_type: body.destination_type,
    destination: body.destination,
    ...(typeof body.amount === 'number' ? { amount: body.amount } : {}),
  };
  try {
    const res = await request<Record<string, unknown>>(PATH, { method: 'POST', body: payload });
    if (res.status !== 200 || res.data == null || typeof res.data.valid !== 'boolean') {
      logger.warn({ path: PATH, httpStatus: res.status }, 'palremit.validate_destination.unexpected_response');
      return { status: 'unavailable' };
    }
    const warnings = problems(res.data.warnings);
    if (res.data.valid) return { status: 'valid', warnings };
    const errors = problems(res.data.errors);
    return errors.length > 0
      ? { status: 'invalid', errors, warnings }
      : { status: 'valid', warnings };
  } catch (e) {
    // Palremit rejects a malformed body with 400 validation_failed: that is a
    // real problem with the destination, not an outage.
    if (isHttpError(e) && e.status === 400) {
      const data = e.data as Record<string, unknown> | undefined;
      if (data?.error === 'validation_failed') {
        const errors = zodDetails(data);
        if (errors.length > 0) return { status: 'invalid', errors, warnings: [] };
      }
    }
    logger.warn(
      {
        path: PATH,
        httpStatus: isHttpError(e) ? e.status : undefined,
        err: e instanceof Error ? e.message : String(e),
      },
      'palremit.validate_destination.unavailable'
    );
    return { status: 'unavailable' };
  }
}

/** One line per problem, e.g. "destination.beneficiary.address.state_province must be one of: … (send the code GD for 'Guangdong')". */
export function formatDestinationProblems(errors: PalremitDestinationProblem[]): string {
  return errors.map((e) => (e.hint ? `${e.message} (${e.hint})` : e.message)).join('; ');
}

/** Thrown when Palremit says a payout destination would be rejected. */
export class PayoutDestinationInvalidError extends Error {
  constructor(public readonly errors: PalremitDestinationProblem[]) {
    super(`Payout details are invalid: ${formatDestinationProblems(errors)}`);
    this.name = 'PayoutDestinationInvalidError';
    Object.setPrototypeOf(this, PayoutDestinationInvalidError.prototype);
  }
}
