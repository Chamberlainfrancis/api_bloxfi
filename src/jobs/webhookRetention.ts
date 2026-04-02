/**
 * Periodically delete inbound webhook audit rows older than retention (4 months).
 */

import { deleteWebhookInboundLogsReceivedBefore } from '@/db/repositories/webhookInboundLog.repo';

const INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

/** Rows with receivedAt before this instant are deleted (4 calendar months ago). */
function cutoffDate(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  return d;
}

export async function runWebhookRetentionOnce(): Promise<number> {
  const n = await deleteWebhookInboundLogsReceivedBefore(cutoffDate());
  if (n > 0) {
    console.info(`[webhookRetention] deleted ${n} WebhookInboundLog row(s) older than 4 months`);
  }
  return n;
}

/** Starts daily cleanup. Returns a function to stop the interval. */
export function startWebhookRetentionSchedule(): () => void {
  const id = setInterval(() => {
    void runWebhookRetentionOnce().catch((e) => {
      console.error('[webhookRetention] cleanup failed', e);
    });
  }, INTERVAL_MS);

  void runWebhookRetentionOnce().catch((e) => {
    console.error('[webhookRetention] initial cleanup failed', e);
  });

  return () => clearInterval(id);
}
