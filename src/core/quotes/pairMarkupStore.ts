/**
 * In-memory pair markup rules used by findPairMarkup.
 *
 * Pricing stays synchronous: quotes read this module, and a background job
 * (jobs/pairMarkupRefresh.ts) plus every dashboard write reload it from the
 * PairMarkupSetting table. Until the first successful load the rules in
 * pairMarkup.config.ts apply. A failed reload keeps the last loaded rules, so
 * a database blip never drops a spread. After a successful load the table is
 * the source of truth: a (fiat, side) with no row has no bloxfi markup.
 */

import { logger } from '@/lib/logger';
import { PAIR_MARKUP_RULES, type PairMarkupRule } from '@/core/quotes/pairMarkup.config';

export interface PairMarkupSettingRow {
  fiat: string;
  side: string;
  cryptos: string;
  markupBps: number;
}

export type PairMarkupRulesSource = 'config' | 'database';

let rules: readonly PairMarkupRule[] = PAIR_MARKUP_RULES;
let source: PairMarkupRulesSource = 'config';
let loadedAt: Date | null = null;

export function getPairMarkupRules(): readonly PairMarkupRule[] {
  return rules;
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
    });
  }
  return out;
}

export function setPairMarkupRulesFromSettings(rows: ReadonlyArray<PairMarkupSettingRow>): void {
  rules = Object.freeze(rulesFromSettings(rows));
  source = 'database';
  loadedAt = new Date();
}

/** Returns false (and keeps the current rules) when the load fails. */
export async function refreshPairMarkupRules(
  load: () => Promise<PairMarkupSettingRow[]>
): Promise<boolean> {
  try {
    setPairMarkupRulesFromSettings(await load());
    return true;
  } catch (err) {
    logger.error({ err, source }, 'pair markup reload failed; keeping current rules');
    return false;
  }
}

export function _resetPairMarkupRulesForTests(): void {
  rules = PAIR_MARKUP_RULES;
  source = 'config';
  loadedAt = null;
}
