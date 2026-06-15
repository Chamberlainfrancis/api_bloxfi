/**
 * App entry. Load .env before any config is read.
 */
import 'dotenv/config';
import app from '@/app';
import { env } from '@/config';
import { logger } from '@/lib/logger';
import { closeRedis } from '@/services/redis';
import { startWebhookRetentionSchedule } from '@/jobs/webhookRetention';

const stopWebhookRetention = startWebhookRetentionSchedule();

/** host:port/dbname only — never log credentials or query params. */
function dbTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return 'unparseable';
  }
}

const server = app.listen(env.PORT, () => {
  console.info(`BloxFi API listening on port ${env.PORT} (${env.NODE_ENV})`);
  // Logs which database the app connected to — the first thing to check when
  // the dashboard shows an empty table (wrong/empty DB vs. a real bug).
  logger.info({ db: dbTarget(env.DATABASE_URL), nodeEnv: env.NODE_ENV }, 'bloxfi db target');
});

const shutdown = async (): Promise<void> => {
  stopWebhookRetention();
  server.close(async () => {
    await closeRedis();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
