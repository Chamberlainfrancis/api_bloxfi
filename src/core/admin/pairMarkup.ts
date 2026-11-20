/**
 * Ops-editable bloxfi FX spread per (fiat, side, source coins), shown and
 * edited on the dashboard Rates tab. A fiat and side can have several rows
 * as long as no coin is in two of them, e.g. USD offramps: USDT at 25 bps and
 * USDC at 20 bps. buy = onramp (fiat → crypto), sell = offramp
 * (crypto → fiat). Only bloxfi's own markup lives here; currency-api rates
 * are not touched. There are no rates in code: an offramp currency with no
 * sell row cannot be quoted or created.
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
  /** Sell rows: refuse to quote without the payout provider's live rate. Always true on buy rows. */
  requireProviderRate: boolean;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PairMarkupWriteData {
  cryptos: string;
  markupBps: number;
  requireProviderRate: boolean;
  updatedBy: string | null;
}

/** Reads and writes inside one transaction that holds the table's write lock. */
export interface PairMarkupWriteTx {
  listPairMarkupSettingsForKey(key: PairMarkupKey): Promise<PairMarkupSetting[]>;
  findPairMarkupSettingById(id: string): Promise<PairMarkupSetting | null>;
  createPairMarkupSetting(key: PairMarkupKey, data: PairMarkupWriteData): Promise<PairMarkupSetting>;
  updatePairMarkupSetting(id: string, data: Partial<PairMarkupWriteData>): Promise<PairMarkupSetting>;
  deletePairMarkupSettingById(id: string): Promise<void>;
}

export interface PairMarkupRepo {
  listPairMarkupSettings(): Promise<PairMarkupSetting[]>;
  findPairMarkupSettingById(id: string): Promise<PairMarkupSetting | null>;
  deletePairMarkupSettingById(id: string): Promise<void>;
  /** Runs fn in one transaction; concurrent saves wait, so two rows can never claim the same coin. */
  withPairMarkupWriteLock<T>(fn: (tx: PairMarkupWriteTx) => Promise<T>): Promise<T>;
  /** Upper-case payout currencies of offramps created since `since`. */
  listRecentOfframpCurrencies(since: Date): Promise<string[]>;
}

/** How far back the Rates tab looks for offramp currencies that have no sell markup. */
export const PAUSED_OFFRAMP_LOOKBACK_DAYS = 90;

/**
 * Recent offramp currencies that have a coin with no sell row: offramps from
 * that coin to that currency are refused until a markup is saved. A currency
 * with no sell row at all is listed alone ("NGN"); one with some coins priced
 * lists the missing ones ("USD from USDC"). Sorted, upper-case.
 */
export function pausedOfframpCurrencies(
  settings: ReadonlyArray<Pick<PairMarkupSetting, 'fiat' | 'side'> & { cryptos?: string }>,
  recentCurrencies: ReadonlyArray<string>
): string[] {
  const covered = new Map<string, Set<string>>();
  for (const s of settings) {
    if (s.side !== 'sell') continue;
    const fiat = s.fiat.toUpperCase();
    const set = covered.get(fiat) ?? new Set<string>();
    const coins = s.cryptos == null ? defaultCryptosFor(fiat) : splitCodes(s.cryptos);
    for (const c of coins) set.add(c);
    covered.set(fiat, set);
  }
  const out = new Set<string>();
  for (const c of recentCurrencies) {
    const fiat = c.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(fiat)) continue;
    const have = covered.get(fiat);
    if (!have) {
      out.add(fiat);
      continue;
    }
    const missing = defaultCryptosFor(fiat).filter((x) => !have.has(x));
    if (missing.length) out.add(`${fiat} from ${missing.join(', ')}`);
  }
  return [...out].sort();
}

function splitCodes(cryptos: string): string[] {
  return cryptos.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean);
}

/** USD, USDT, USDC without the fiat itself (a USD row can't price USD). */
function defaultCryptosFor(fiat: string): string[] {
  return PAIR_MARKUP_CRYPTOS.filter((c) => c !== fiat);
}

/** Same coins in the canonical USD, USDT, USDC order. */
function orderCryptos(cryptos: Iterable<string>): string {
  const set = new Set(cryptos);
  return PAIR_MARKUP_CRYPTOS.filter((c) => set.has(c)).join(',');
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

export class PairMarkupNotFoundError extends Error {
  constructor(message = 'Rate markup not found') {
    super(message);
    this.name = 'PairMarkupNotFoundError';
  }
}

/** Audit id for a rule: `EUR:sell`. */
export function pairMarkupKeyLabel(key: PairMarkupKey): string {
  return `${key.fiat}:${key.side}`;
}

function describe(
  setting: Pick<PairMarkupSetting, 'markupBps' | 'cryptos' | 'side'> & { requireProviderRate?: boolean }
): string {
  const base = `${setting.markupBps} bps (${setting.cryptos})`;
  if (setting.side !== 'sell') return base;
  return setting.requireProviderRate === false ? `${base}, provider rate optional` : `${base}, provider rate required`;
}

export function normalizePairMarkupInput(input: {
  fiat: string;
  side: PairMarkupSide;
  cryptos?: ReadonlyArray<string> | string | null;
  markupBps: number;
  requireProviderRate?: boolean | null;
}): { key: PairMarkupKey; cryptos: string; markupBps: number; requireProviderRate: boolean } {
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
  const ordered = orderCryptos(cryptos);

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

  // Only offramps floor at the provider rate; buy rows always store true.
  const requireProviderRate = input.side === 'sell' ? input.requireProviderRate !== false : true;

  return { key: { fiat, side: input.side }, cryptos: ordered, markupBps, requireProviderRate };
}

export async function listPairMarkupSettings(deps: Pick<PairMarkupDeps, 'repo'>): Promise<PairMarkupSetting[]> {
  return deps.repo.listPairMarkupSettings();
}

interface AuditEntry {
  key: PairMarkupKey;
  from: string;
  to: string;
  note: string;
}

/**
 * Create or edit one row. With `id`, that row is edited (its currency and
 * direction can't change). Without `id`, the row for the same currency,
 * direction and coins is edited, or a new row is added.
 *
 * Coins the saved row claims are taken out of the other rows for the same
 * currency and direction in the same transaction, so a coin is always priced
 * by exactly one row and there is no gap: saving USD sell USDT at 25 bps
 * while "USDT,USDC 20 bps" exists leaves "USDC 20 bps" and "USDT 25 bps".
 * A row left with no coins is removed. An unchanged save writes nothing.
 */
export async function savePairMarkupSetting(
  deps: PairMarkupDeps,
  input: {
    id?: string | null;
    fiat: string;
    side: PairMarkupSide;
    cryptos?: ReadonlyArray<string> | string | null;
    markupBps: number;
    requireProviderRate?: boolean | null;
    actor?: string | null;
  }
): Promise<PairMarkupSetting> {
  const { key, cryptos, markupBps, requireProviderRate } = normalizePairMarkupInput(input);
  const actor = input.actor?.trim() || null;
  const id = input.id?.trim() || null;

  const { saved, entries } = await deps.repo.withPairMarkupWriteLock(async (tx) => {
    const rows = await tx.listPairMarkupSettingsForKey(key);
    let target: PairMarkupSetting | null;
    if (id) {
      target = rows.find((r) => r.id === id) ?? null;
      if (!target) {
        const other = await tx.findPairMarkupSettingById(id);
        if (!other) throw new PairMarkupNotFoundError();
        throw new PairMarkupValidationError(
          `this row is ${other.fiat} ${other.side}; its currency and direction can't be changed. Add a new row instead.`
        );
      }
    } else {
      target = rows.find((r) => r.cryptos === cryptos) ?? null;
    }

    if (
      target &&
      target.cryptos === cryptos &&
      target.markupBps === markupBps &&
      target.requireProviderRate === requireProviderRate
    ) {
      return { saved: target, entries: [] as AuditEntry[] };
    }

    const claimed = new Set(cryptos.split(','));
    const out: AuditEntry[] = [];
    for (const other of rows) {
      if (target && other.id === target.id) continue;
      const otherCoins = splitCodes(other.cryptos);
      if (!otherCoins.some((c) => claimed.has(c))) continue;
      const remaining = orderCryptos(otherCoins.filter((c) => !claimed.has(c)));
      if (!remaining) {
        await tx.deletePairMarkupSettingById(other.id);
        out.push({ key, from: describe(other), to: '', note: `Rate markup removed: ${other.cryptos} now priced by the new row` });
      } else {
        const narrowed = await tx.updatePairMarkupSetting(other.id, { cryptos: remaining, updatedBy: actor });
        const moved = otherCoins.filter((c) => claimed.has(c)).join(',');
        out.push({ key, from: describe(other), to: describe(narrowed), note: `Rate markup narrowed: ${moved} moved to its own row` });
      }
    }

    const data = { cryptos, markupBps, requireProviderRate, updatedBy: actor };
    const row = target ? await tx.updatePairMarkupSetting(target.id, data) : await tx.createPairMarkupSetting(key, data);
    out.push({
      key,
      from: target ? describe(target) : '',
      to: describe(row),
      note: target ? 'Rate markup updated' : 'Rate markup added',
    });
    return { saved: row, entries: out };
  });

  if (entries.length === 0) return saved;
  for (const e of entries) {
    await deps.audit.createAdminAction({
      txnType: 'pair_markup',
      txnId: pairMarkupKeyLabel(e.key),
      fromStatus: e.from,
      toStatus: e.to,
      note: e.note,
      actor,
    });
  }
  await deps.reload();
  return saved;
}

/**
 * Removing a sell row pauses offramps from its coins to that currency (quotes
 * and creates are refused). Removing a buy row means onramps use the currency-api B2B rate.
 */
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
