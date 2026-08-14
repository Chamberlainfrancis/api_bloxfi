import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  /**
   * Simple Bearer auth for our API: `Authorization: Bearer <API_KEY>`.
   * Keep this secret and rotate as needed.
   */
  API_KEY: z.string().min(16, "API_KEY is required"),
  API_KEY_HEADER: z.string().default("Authorization"),
  CORS_ORIGINS: z.string().optional(),
  /**
   * Shared passcode required to mark transactions from the (no-auth) admin
   * dashboard. Defaults to "pr2026"; override in env to rotate.
   */
  DASHBOARD_MARK_SECRET: z.string().min(1).default("pr2026"),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().min(1).default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().min(1).default(100),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().min(1).default(86400),
  // S3-compatible object storage (e.g. Railway bucket)
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  // Palremit Liquidity Orchestrator: Bearer secret + /v1/*. Default host https://liquidity.palremit.com if unset.
  PALREMIT_LIQUIDITY_URL: z.string().url().optional(),
  /** One-time secret from tenant signup / rotate. */
  PALREMIT_LIQUIDITY_SECRET: z.string().min(1, "PALREMIT_LIQUIDITY_SECRET is required"),
  /**
   * This api_bloxfi instance's tenant_id on the orchestrator. Used by the admin
   * dashboard to gate provider-customer calls when enriching the business list.
   */
  PALREMIT_LIQUIDITY_TENANT_ID: z.string().min(1).optional(),
  PALREMIT_CURRENCY_URL: z.string().url().optional(),
  /** HMAC for inbound orchestrator webhooks (`X-Webhook-Signature`). */
  WEBHOOK_SECRET: z.string().min(1, "WEBHOOK_SECRET is required"),
  /**
   * Accept Palremit deliveries with no signature when the orchestrator has no usable signing secret.
   * Use only with additional transport controls (mTLS, IP allowlist, private link). Default: reject unsigned.
   */
  WEBHOOK_ALLOW_UNSIGNED: z
    .string()
    .optional()
    .transform((s) => s === "true" || s === "1"),
  /** Outbound partner webhook URL. Unset = do not send. */
  PARTNER_WEBHOOK_URL: z.string().url().optional(),
  /** HMAC secret for outbound partner webhooks. Required when PARTNER_WEBHOOK_URL is set. */
  PARTNER_WEBHOOK_SECRET: z.string().min(16).optional(),
}).superRefine((v, ctx) => {
  if (v.PARTNER_WEBHOOK_URL && !v.PARTNER_WEBHOOK_SECRET) {
    ctx.addIssue({
      code: "custom",
      path: ["PARTNER_WEBHOOK_SECRET"],
      message: "required when PARTNER_WEBHOOK_URL is set",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const messages = parsed.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
    throw new Error(`Invalid environment: ${messages}`);
  }
  return parsed.data;
}

export const env = loadEnv();
