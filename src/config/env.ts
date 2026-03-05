import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  API_KEY_HEADER: z.string().default('Authorization'),
  CORS_ORIGINS: z.string().optional(),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().min(1).default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().min(1).default(100),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().min(1).default(86400),
  // S3-compatible object storage (e.g. Railway bucket)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Optional: LP (liquidity provider) base URL and API key for future onramp/offramp integrations
  LP_BASE_URL: z.string().url().optional(),
  LP_API_KEY: z.string().optional(),
  // Currency API: rates for onramp/offramp (docs/exchange-rates-api.md). Takes precedence if set.
  CURRENCY_API_URL: z.string().url().optional(),
  // Palremit LP: liquidity API (ramp, deposits, withdrawals) and currency API (rates)
  PALREMIT_LIQUIDITY_URL: z.string().url().optional(),
  PALREMIT_CURRENCY_URL: z.string().url().optional(),
  PALREMIT_ACCESS_KEY: z.string().optional(),
  // Inbound webhooks from LPs: HMAC SHA256 verification (webhook_id + timestamp + body)
  WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    throw new Error(`Invalid environment: ${messages}`);
  }
  return parsed.data;
}

export const env = loadEnv();
