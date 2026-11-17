/**
 * In-memory pair markup rules used by findPairMarkup.
 *
 * Pricing stays synchronous: quotes read this module, and a background job
 * (jobs/pairMarkupRefresh.ts) plus every dashboard write reload it from the
 * PairMarkupSetting table. There are no rates in code: until the first
 * successful load nothing is priced (pricing throws PALREMIT_RATES_UNAVAILABLE).
 * A failed reload keeps the last loaded rules, so a database blip never drops
 * a spread. An offramp pair with no row cannot be quoted or created.
 */

import { logger } from '@/lib/logger';
import type { PairMarkupRule } from '@/core/quotes/pairMarkup.config';

export interface PairMarkupSettingRow {
  fiat: string;
  side: string;
  cryptos: string;
  markupBps: number;
  /** Missing = true (older callers and tests). */
  requireProviderRate?: boolean | null;
}

export type PairMarkupRulesSource = 'none' | 'database';

let rules: readonly PairMarkupRule[] = Object.freeze([]);
let source: PairMarkupRulesSource = 'none';
let loadedAt: Date | null = null;
// Each reload takes a ticket; a slower, older reload never overwrites a newer one.
let loadsStarted = 0;
let newestApplied = 0;

export function getPairMarkupRules(): readonly PairMarkupRule[] {
  return rules;
}

export function pairMarkupRulesLoaded(): boolean {
  return source === 'database';
}

export function getPairMarkupRulesStatus(): { source: PairMarkupRulesSource; loadedAt: Date | null } {
  return { source, loadedAt };
}

export function splitCryptos(cryptos: string): string[] {
  return cryptos
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

/** Rows with an unknown side or no cryptos are skipped, never guessed. */
export function rulesFromSettings(rows: ReadonlyArray<PairMarkupSettingRow>): PairMarkupRule[] {
  const out: PairMarkupRule[] = [];
  for (const row of rows) {
    const side = row.side.trim().toLowerCase();
    const crypto = splitCryptos(row.cryptos);
    if ((side !== 'buy' && side !== 'sell') || crypto.length === 0) continue;
    if (!Number.isFinite(row.markupBps) || row.markupBps < 0) continue;
    out.push({
      fiat: row.fiat.trim().toUpperCase(),
      crypto,
      markup: row.markupBps / 10000,
      sides: [side],
      ...(side === 'sell' ? { requireProviderRate: row.requireProviderRate !== false } : {}),
    });
  }
  return out;
}

export function setPairMarkupRulesFromSettings(rows: ReadonlyArray<PairMarkupSettingRow>): void {
  rules = Object.freeze(rulesFromSettings(rows));
  source = 'database';
  loadedAt = new Date();
}

/**
 * Returns false (and keeps the current rules) when the load fails. A load that
 * finishes after a newer one was applied is dropped, so a background tick that
 * started before a dashboard edit can't put the old value back.
 */
export async function refreshPairMarkupRules(
  load: () => Promise<PairMarkupSettingRow[]>
): Promise<boolean> {
  const ticket = ++loadsStarted;
  try {
    const rows = await load();
    if (ticket < newestApplied) return true;
    setPairMarkupRulesFromSettings(rows);
    newestApplied = ticket;
    return true;
  } catch (err) {
    logger.error({ err, source }, 'pair markup reload failed; keeping current rules');
    return false;
  }
}

export function _resetPairMarkupRulesForTests(): void {
  rules = Object.freeze([]);
  source = 'none';
  loadedAt = null;
  loadsStarted = 0;
  newestApplied = 0;
}
