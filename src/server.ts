/**
 * App entry. Load .env before any config is read.
 */
import 'dotenv/config';
import app from './app';
import { env } from './config';
import { closeRedis } from './services/redis';

const server = app.listen(env.PORT, () => {
  console.info(`BloxFi API listening on port ${env.PORT} (${env.NODE_ENV})`);
});

const shutdown = async (): Promise<void> => {
  server.close(async () => {
    await closeRedis();
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
