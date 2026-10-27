/**
 * Ops-editable bloxfi FX spread per (fiat, side), shown and edited on the
 * dashboard Rates tab. buy = onramp (fiat → crypto), sell = offramp
 * (crypto → fiat). Only bloxfi's own markup lives here; currency-api rates
 * are not touched.
 *
 * Every write is audited and reloads the in-memory rules used by quotes
 * (core/quotes/pairMarkupStore.ts), so new quotes on this instance use the
 * change at once and other instances within one refresh interval.
 */

export type PairMarkupSide = 'buy' | 'sell';

/** The crypto/stable legs a rule can apply to. */
export const PAIR_MARKUP_CRYPTOS = ['USD', 'USDT', 'USDC'] as const;

/** 1000 bps = 10%. The largest spread today is EUR onramp at 240 bps; anything above 10% is a typo. */
export const PAIR_MARKUP_MAX_BPS = 1000;

export interface PairMarkupKey {
  fiat: string;
  side: PairMarkupSide;
}

export interface PairMarkupSetting extends PairMarkupKey {
  id: string;
  /** Comma-separated upper-case codes, e.g. "USD,USDT,USDC". */
  cryptos: string;
  markupBps: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PairMarkupRepo {
  listPairMarkupSettings(): Promise<PairMarkupSetting[]>;
  findPairMarkupSettingById(id: string): Promise<PairMarkupSetting | null>;
  findPairMarkupSettingByKey(key: PairMarkupKey): Promise<PairMarkupSetting | null>;
  upsertPairMarkupSetting(
    key: PairMarkupKey,
    data: { cryptos: string; markupBps: number; updatedBy: string | null }
  ): Promise<PairMarkupSetting>;
  deletePairMarkupSettingById(id: string): Promise<void>;
}

export interface PairMarkupAuditRepo {
  createAdminAction(data: {
    txnType: 'pair_markup';
    txnId: string;
    fromStatus: string;
    toStatus: string;
    note?: string | null;
    actor?: string | null;
  }): Promise<unknown>;
}

export interface PairMarkupDeps {
  repo: PairMarkupRepo;
  audit: PairMarkupAuditRepo;
  /** Reload the in-memory pricing rules after a write. */
  reload: () => Promise<boolean>;
}

export class PairMarkupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairMarkupValidationError';
  }
}

/** Audit id for a rule: `EUR:sell`. */
export function pairMarkupKeyLabel(key: PairMarkupKey): string {
  return `${key.fiat}:${key.side}`;
}

function describe(setting: Pick<PairMarkupSetting, 'markupBps' | 'cryptos'>): string {
  return `${setting.markupBps} bps (${setting.cryptos})`;
}

export function normalizePairMarkupInput(input: {
  fiat: string;
  side: PairMarkupSide;
  cryptos?: ReadonlyArray<string> | string | null;
  markupBps: number;
}): { key: PairMarkupKey; cryptos: string; markupBps: number } {
  const fiat = input.fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(fiat)) {
    throw new PairMarkupValidationError('fiat must be a 3-letter currency code, e.g. EUR');
  }
  if (input.side !== 'buy' && input.side !== 'sell') {
    throw new PairMarkupValidationError('side must be buy (onramp) or sell (offramp)');
  }

  const raw = input.cryptos == null || input.cryptos === ''
    ? PAIR_MARKUP_CRYPTOS.filter((c) => c !== fiat)
    : (typeof input.cryptos === 'string' ? input.cryptos.split(',') : [...input.cryptos]);
  const cryptos = Array.from(new Set(raw.map((c) => c.trim().toUpperCase()).filter(Boolean)));
  if (cryptos.length === 0) throw new PairMarkupValidationError('choose at least one of USD, USDT, USDC');
  const allowed = new Set<string>(PAIR_MARKUP_CRYPTOS);
  const bad = cryptos.filter((c) => !allowed.has(c) || c === fiat);
  if (bad.length) {
    throw new PairMarkupValidationError(`cryptos must be from USD, USDT, USDC and not the fiat itself (got ${bad.join(', ')})`);
  }
  // Keep a stable order so "USDC,USD" and "USD,USDC" are the same setting.
  const ordered = PAIR_MARKUP_CRYPTOS.filter((c) => cryptos.includes(c));

  const rawBps = Number(input.markupBps);
  if (!Number.isFinite(rawBps) || rawBps < 0 || rawBps > PAIR_MARKUP_MAX_BPS) {
    throw new PairMarkupValidationError(`markup must be between 0 and ${PAIR_MARKUP_MAX_BPS} bps`);
  }
  // Compare in hundredths with a tolerance: 1.1 * 100 is 110.00000000000001 in floats.
  const hundredths = Math.round(rawBps * 100);
  if (Math.abs(rawBps * 100 - hundredths) > 1e-6) {
    throw new PairMarkupValidationError('markup can have at most 2 decimal places (e.g. 12.5 bps)');
  }
  const markupBps = hundredths / 100;

  return { key: { fiat, side: input.side }, cryptos: ordered.join(','), markupBps };
}

export async function listPairMarkupSettings(deps: Pick<PairMarkupDeps, 'repo'>): Promise<PairMarkupSetting[]> {
  return deps.repo.listPairMarkupSettings();
}

/** Create or replace the rule for (fiat, side). An unchanged rule is not rewritten or audited. */
export async function savePairMarkupSetting(
  deps: PairMarkupDeps,
  input: {
    fiat: string;
    side: PairMarkupSide;
    cryptos?: ReadonlyArray<string> | string | null;
    markupBps: number;
    actor?: string | null;
  }
): Promise<PairMarkupSetting> {
  const { key, cryptos, markupBps } = normalizePairMarkupInput(input);
  const actor = input.actor?.trim() || null;
  const previous = await deps.repo.findPairMarkupSettingByKey(key);
  if (previous && previous.markupBps === markupBps && previous.cryptos === cryptos) return previous;

  const saved = await deps.repo.upsertPairMarkupSetting(key, { cryptos, markupBps, updatedBy: actor });
  await deps.audit.createAdminAction({
    txnType: 'pair_markup',
    txnId: pairMarkupKeyLabel(key),
    fromStatus: previous ? describe(previous) : '',
    toStatus: describe(saved),
    note: previous ? 'Rate markup updated' : 'Rate markup added',
    actor,
  });
  await deps.reload();
  return saved;
}

/** Removing a rule means that pair gets no bloxfi markup (the currency-api B2B rate is served). */
export async function deletePairMarkupSetting(
  deps: PairMarkupDeps,
  id: string,
  actor?: string | null
): Promise<boolean> {
  const existing = await deps.repo.findPairMarkupSettingById(id);
  if (!existing) return false;
  await deps.repo.deletePairMarkupSettingById(existing.id);
  await deps.audit.createAdminAction({
    txnType: 'pair_markup',
    txnId: pairMarkupKeyLabel(existing),
    fromStatus: describe(existing),
    toStatus: '',
    note: 'Rate markup removed',
    actor: actor?.trim() || null,
  });
  await deps.reload();
  return true;
}
