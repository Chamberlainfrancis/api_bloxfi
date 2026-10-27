/**
 * Keeps the in-memory pair markup rules in step with the PairMarkupSetting
 * table, so a dashboard edit made on one instance reaches every instance.
 */

import { refreshPairMarkupRules } from '@/core/quotes/pairMarkupStore';
import { logger } from '@/lib/logger';

const INTERVAL_MS = 30 * 1000;

export async function reloadPairMarkupRules(): Promise<boolean> {
  const repo = await import('@/db/repositories/pairMarkup.repo');
  return refreshPairMarkupRules(() => repo.listPairMarkupSettings());
}

/** Loads now, then every 30s. Returns a function to stop the interval. */
export function startPairMarkupRefreshSchedule(): () => void {
  const run = (): void => {
    void reloadPairMarkupRules().catch((e) => {
      logger.error({ err: e }, 'pair markup refresh failed');
    });
  };
  run();
  const id = setInterval(run, INTERVAL_MS);
  return () => clearInterval(id);
}
