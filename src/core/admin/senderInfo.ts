/**
 * Ops-editable sender / payee name per (ramp type, currency, optional rail).
 *
 * - offramp: the name the beneficiary sees as the payout sender.
 * - onramp: the payee name shown on the customer's deposit details.
 *
 * Settings are resolved onto a transfer when it is created (see
 * createOfframp / createOnramp). Editing a setting never changes existing
 * transfers. The resolver is pure so it can be unit-tested without Prisma.
 */

import { logger } from '@/lib/logger';

export type SenderInfoRampType = 'onramp' | 'offramp';

export const SENDER_NAME_MAX_LENGTH = 140;

export interface SenderInfoKey {
  rampType: SenderInfoRampType;
  currency: string;
  /** Lower-case rail; '' means "any rail". */
  rail: string;
}

export interface SenderInfoSetting extends SenderInfoKey {
  id: string;
  senderName: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** What createOfframp / createOnramp stash on the new transfer. */
export interface ResolvedSenderInfo {
  senderName: string;
  settingId: string;
  source: 'ops_setting';
}

export interface SenderInfoRepo {
  listSenderInfoSettings(): Promise<SenderInfoSetting[]>;
  findSenderInfoSettingsForCurrency(
    rampType: SenderInfoRampType,
    currency: string
  ): Promise<SenderInfoSetting[]>;
  findSenderInfoSettingById(id: string): Promise<SenderInfoSetting | null>;
  findSenderInfoSettingByKey(key: SenderInfoKey): Promise<SenderInfoSetting | null>;
  upsertSenderInfoSetting(
    key: SenderInfoKey,
    data: { senderName: string; updatedBy: string | null }
  ): Promise<SenderInfoSetting>;
  deleteSenderInfoSettingById(id: string): Promise<void>;
}

export interface SenderInfoAuditRepo {
  createAdminAction(data: {
    txnType: 'sender_info';
    txnId: string;
    fromStatus: string;
    toStatus: string;
    note?: string | null;
    actor?: string | null;
  }): Promise<unknown>;
}

export function normalizeSenderInfoKey(input: {
  rampType: SenderInfoRampType;
  currency: string;
  rail?: string | null;
}): SenderInfoKey {
  return {
    rampType: input.rampType,
    currency: input.currency.trim().toUpperCase(),
    rail: (input.rail ?? '').trim().toLowerCase(),
  };
}

/** Audit id for a setting: `offramp:NGN:local_bank` / `onramp:GBP:any`. */
export function senderInfoKeyLabel(key: SenderInfoKey): string {
  return `${key.rampType}:${key.currency}:${key.rail || 'any'}`;
}

/**
 * Pick the setting for a transfer: exact rail match first, then the
 * any-rail ('') setting, else null. Inputs are normalised here so callers
 * can pass whatever casing they have.
 */
export function resolveSenderInfoSetting(
  settings: ReadonlyArray<SenderInfoSetting>,
  input: { rampType: SenderInfoRampType; currency: string; rail?: string | null }
): SenderInfoSetting | null {
  const key = normalizeSenderInfoKey(input);
  const matches = settings.filter(
    (s) =>
      s.rampType === key.rampType &&
      s.currency.trim().toUpperCase() === key.currency &&
      typeof s.senderName === 'string' &&
      s.senderName.trim() !== ''
  );
  const railOf = (s: SenderInfoSetting): string => (s.rail ?? '').trim().toLowerCase();
  if (key.rail) {
    const exact = matches.find((s) => railOf(s) === key.rail);
    if (exact) return exact;
  }
  return matches.find((s) => railOf(s) === '') ?? null;
}

export function toResolvedSenderInfo(setting: SenderInfoSetting): ResolvedSenderInfo {
  return { senderName: setting.senderName.trim(), settingId: setting.id, source: 'ops_setting' };
}

/**
 * Repo-backed resolver used at transfer creation. A lookup failure is logged
 * and treated as "no setting": this runs after the deposit account is
 * provisioned, and a display label must never fail the transfer.
 */
export async function resolveSenderInfoForTransfer(
  repo: Pick<SenderInfoRepo, 'findSenderInfoSettingsForCurrency'>,
  input: { rampType: SenderInfoRampType; currency: string; rail?: string | null }
): Promise<ResolvedSenderInfo | null> {
  const key = normalizeSenderInfoKey(input);
  if (!key.currency) return null;
  try {
    const candidates = await repo.findSenderInfoSettingsForCurrency(key.rampType, key.currency);
    const hit = resolveSenderInfoSetting(candidates, key);
    return hit ? toResolvedSenderInfo(hit) : null;
  } catch (err) {
    logger.error({ err, key }, 'sender info lookup failed; using default sender name');
    return null;
  }
}

// --- dashboard actions ------------------------------------------------------

export interface SenderInfoDeps {
  repo: SenderInfoRepo;
  audit: SenderInfoAuditRepo;
}

export async function listSenderInfoSettings(deps: Pick<SenderInfoDeps, 'repo'>): Promise<SenderInfoSetting[]> {
  return deps.repo.listSenderInfoSettings();
}

export class SenderInfoValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SenderInfoValidationError';
  }
}

/**
 * Create or replace the setting for (type, currency, rail). A blank name
 * removes the setting instead (same as DELETE). Returns null when removed.
 */
export async function saveSenderInfoSetting(
  deps: SenderInfoDeps,
  input: {
    rampType: SenderInfoRampType;
    currency: string;
    rail?: string | null;
    senderName: string;
    actor?: string | null;
  }
): Promise<SenderInfoSetting | null> {
  const key = normalizeSenderInfoKey(input);
  if (!key.currency) throw new SenderInfoValidationError('currency is required');
  const senderName = input.senderName.trim();
  if (senderName.length > SENDER_NAME_MAX_LENGTH) {
    throw new SenderInfoValidationError(`senderName must be at most ${SENDER_NAME_MAX_LENGTH} characters`);
  }
  const actor = input.actor?.trim() || null;
  const previous = await deps.repo.findSenderInfoSettingByKey(key);

  if (!senderName) {
    if (previous) await removeSetting(deps, previous, actor);
    return null;
  }
  if (previous && previous.senderName === senderName) return previous;

  const saved = await deps.repo.upsertSenderInfoSetting(key, { senderName, updatedBy: actor });
  await deps.audit.createAdminAction({
    txnType: 'sender_info',
    txnId: senderInfoKeyLabel(key),
    fromStatus: previous?.senderName ?? '',
    toStatus: senderName,
    note: previous ? 'Sender name updated' : 'Sender name added',
    actor,
  });
  return saved;
}

export async function deleteSenderInfoSetting(
  deps: SenderInfoDeps,
  id: string,
  actor?: string | null
): Promise<boolean> {
  const existing = await deps.repo.findSenderInfoSettingById(id);
  if (!existing) return false;
  await removeSetting(deps, existing, actor?.trim() || null);
  return true;
}

async function removeSetting(
  deps: SenderInfoDeps,
  setting: SenderInfoSetting,
  actor: string | null
): Promise<void> {
  await deps.repo.deleteSenderInfoSettingById(setting.id);
  await deps.audit.createAdminAction({
    txnType: 'sender_info',
    txnId: senderInfoKeyLabel(setting),
    fromStatus: setting.senderName,
    toStatus: '',
    note: 'Sender name removed',
    actor,
  });
}
