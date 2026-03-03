import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from './config';
import { errorMiddleware } from './middleware/error';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rateLimit';
import { v1Router } from './api/v1';
import { pingDb } from './db/repositories/health.repo';
import { hashApiKey, findActiveApiKeyByKeyHash } from './db/repositories/apiKey.repo';
import { getRedis } from './services/redis';

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
      : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

// Validate 32-char API key against DB (hash lookup; supports rotation via isActive).
const validateApiKey = async (token: string) => {
  const keyHash = hashApiKey(token);
  const row = await findActiveApiKeyByKeyHash(keyHash);
  return row ? { partnerId: row.partnerId, keyPrefix: row.keyPrefix, environment: row.environment } : null;
};

// Readiness: ping DB and Redis (no auth/rate limit). For load balancers and local checks.
app.get('/ready', async (_req, res) => {
  const [database, redis] = await Promise.all([
    pingDb(),
    getRedis()
      .ping()
      .then(() => true)
      .catch(() => false),
  ]);
  const ok = database && redis;
  res.status(ok ? 200 : 503).json({
    success: true,
    data: { database: database ? 'ok' : 'error', redis: redis ? 'ok' : 'error' },
  });
});

app.use('/api/v1', rateLimitMiddleware, authMiddleware({ validateApiKey }), v1Router);

app.use(errorMiddleware);

export default app;
