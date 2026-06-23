import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { randomBytes } from 'crypto';
import { env } from '@/config';
import { errorMiddleware } from '@/middleware/error';
import { authMiddleware } from '@/middleware/auth';
import { rateLimitMiddleware } from '@/middleware/rateLimit';
import { v1Router } from '@/api/v1';
import { webhooksRouter } from '@/api/v1/webhooks/routes';
import { pingDb } from '@/db/repositories/health.repo';
import { sendSuccess } from '@/utils';
import { getRedis } from '@/services/redis';
import { adminRouter } from '@/api/admin/routes';
import { renderDashboardHtml } from '@/api/admin/page';
import { getTotalRealizedProfitUsdc } from '@/core/admin/dashboard';

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

// Inbound LP webhooks: raw body for signature verification; no API key auth
app.use(
  '/api/v1/webhooks',
  express.raw({ type: 'application/json', limit: '1mb' }),
  rateLimitMiddleware,
  webhooksRouter
);

app.use(express.json({ limit: '10mb' }));

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

// Liveness: no auth (same as Postman "Health check"; /ready is for DB+Redis readiness).
app.get('/api/v1/health', (_req, res) => {
  sendSuccess(res, { status: 'ok', timestamp: new Date().toISOString() });
});

// Internal ops dashboard (NO AUTH — do not expose publicly).
// See docs/superpowers/specs/2026-06-15-bloxfi-admin-dashboard-design.md
// The page's inline <script> is blocked by helmet's default CSP (script-src
// 'self'); serve it with a per-request nonce so the script runs.
app.get('/dashboard', async (_req, res) => {
  const nonce = randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      "style-src 'self' 'unsafe-inline'",
      // https: so beneficiary document thumbnails (presigned S3 URLs) can render.
      "img-src 'self' data: https:",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  // Best-effort: show 0 if DB is unavailable rather than failing the page load.
  const totalProfitUsdc = await getTotalRealizedProfitUsdc().catch(() => '0.00000000');
  res.type('html').send(renderDashboardHtml(nonce, totalProfitUsdc));
});
app.use('/dashboard/api', adminRouter);

app.use('/api/v1', rateLimitMiddleware, authMiddleware(), v1Router);

app.use(errorMiddleware);

export default app;
