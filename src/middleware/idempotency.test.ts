import { createServer, type AddressInfo } from 'node:http';
import express from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisStore = new Map<string, string>();

vi.mock('@/config', () => ({
  env: { IDEMPOTENCY_TTL_SECONDS: 86400 },
}));

vi.mock('@/services/redis', () => ({
  getRedis: () => ({
    set: async (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
      if (nx === 'NX' && redisStore.has(key)) return null;
      redisStore.set(key, value);
      return 'OK';
    },
    del: async (key: string) => {
      const existed = redisStore.delete(key);
      return existed ? 1 : 0;
    },
  }),
}));

import { idempotencyMiddleware } from '@/middleware/idempotency';
import { errorMiddleware } from '@/middleware/error';
import { AppError } from '@/types/errors';

const ID = '3c959e82-f3b5-4b2d-94a6-5d8e805b6806';

function makeApp(onOnramp: express.RequestHandler) {
  const app = express();
  const v1 = express.Router();
  const onramps = express.Router();
  const accounts = express.Router();

  onramps.post('/', idempotencyMiddleware, onOnramp);
  accounts.post('/users/:userId/accounts', idempotencyMiddleware, (_req, res) => {
    res.status(201).json({ ok: true, route: 'accounts' });
  });

  v1.use('/onramps', onramps);
  v1.use(accounts);
  app.use('/api/v1', v1);
  app.use(errorMiddleware);
  return app;
}

async function withServer(
  app: express.Express,
  fn: (base: string) => Promise<void>
): Promise<void> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function post(
  base: string,
  path: string,
  requestId: string
): Promise<{ status: number; body: { error?: { message?: string } } }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { requestId, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as { error?: { message?: string } };
  return { status: res.status, body };
}

describe('idempotencyMiddleware', () => {
  beforeEach(() => {
    redisStore.clear();
  });

  it('scopes the Redis key by method and route so the same requestId can be used on onramps and accounts', async () => {
    const app = makeApp((_req, res) => {
      res.status(201).json({ ok: true, route: 'onramps' });
    });
    await withServer(app, async (base) => {
      const account = await post(base, '/api/v1/users/user-1/accounts', ID);
      const onramp = await post(base, '/api/v1/onramps', ID);
      expect(account.status).toBe(201);
      expect(onramp.status).toBe(201);
      expect([...redisStore.keys()].sort()).toEqual([
        `idempotency:POST:/api/v1/onramps:${ID}`,
        `idempotency:POST:/api/v1/users/user-1/accounts:${ID}`,
      ]);
    });
  });

  it('releases the Redis key when the handler returns 4xx so the same requestId can be retried', async () => {
    const app = makeApp((_req, res) => {
      res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'bad body' } });
    });
    await withServer(app, async (base) => {
      const first = await post(base, '/api/v1/onramps', ID);
      expect(first.status).toBe(400);
      expect(redisStore.size).toBe(0);

      const second = await post(base, '/api/v1/onramps', ID);
      expect(second.status).toBe(400);
    });
  });

  it('releases the Redis key when the handler calls next(err) with a 4xx AppError', async () => {
    const app = makeApp((_req, _res, next) => {
      next(new AppError('Quote not found, expired, or already used', 'INVALID_REQUEST', 400));
    });
    await withServer(app, async (base) => {
      const first = await post(base, '/api/v1/onramps', ID);
      expect(first.status).toBe(400);
      expect(redisStore.size).toBe(0);

      const second = await post(base, '/api/v1/onramps', ID);
      expect(second.status).toBe(400);
    });
  });

  it('keeps the Redis key after 2xx so a replay of the same route+requestId is 409', async () => {
    const app = makeApp((_req, res) => {
      res.status(201).json({ ok: true });
    });
    await withServer(app, async (base) => {
      const first = await post(base, '/api/v1/onramps', ID);
      const second = await post(base, '/api/v1/onramps', ID);
      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body.error?.message).toBe('Duplicate requestId; request is canceled');
      expect(redisStore.has(`idempotency:POST:/api/v1/onramps:${ID}`)).toBe(true);
    });
  });
});
