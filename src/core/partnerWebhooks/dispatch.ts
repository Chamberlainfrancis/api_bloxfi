import { createHmac } from 'crypto';
import { logger } from '@/lib/logger';
import type { PartnerWebhookEnvelope } from '@/types/partnerWebhook';

export type DispatchResult =
  | { outcome: 'skipped_no_url'; attempts: 0 }
  | { outcome: 'skipped_no_secret'; attempts: 0 }
  | { outcome: 'delivered'; attempts: number; httpStatus: number }
  | { outcome: 'failed'; attempts: number; httpStatus?: number; errorMessage?: string };

export type DispatchOpts = {
  url?: string | null;
  secret?: string | null;
  fetchFn?: typeof fetch;
  now?: () => Date;
  id?: () => string;
};

const MAX_ATTEMPTS = 3;
const TIMEOUT_MS = 5000;

export function signPartnerWebhookBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

function is2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

async function resolveUrlAndSecret(
  opts?: DispatchOpts
): Promise<{ url?: string | null; secret?: string | null }> {
  if (opts?.url !== undefined && opts?.secret !== undefined) {
    return { url: opts.url, secret: opts.secret };
  }
  const { env } = await import('@/config/env');
  return {
    url: opts?.url !== undefined ? opts.url : env.PARTNER_WEBHOOK_URL,
    secret: opts?.secret !== undefined ? opts.secret : env.PARTNER_WEBHOOK_SECRET,
  };
}

export async function dispatchPartnerWebhook(
  envelope: PartnerWebhookEnvelope,
  opts?: DispatchOpts
): Promise<DispatchResult> {
  const { url, secret } = await resolveUrlAndSecret(opts);
  if (!url) return { outcome: 'skipped_no_url', attempts: 0 };

  if (!secret) {
    logger.warn(
      { eventType: envelope.eventType, eventId: envelope.eventId },
      'partner webhook secret missing'
    );
    return { outcome: 'skipped_no_secret', attempts: 0 };
  }

  const rawBody = JSON.stringify(envelope);
  const signature = signPartnerWebhookBody(rawBody, secret);
  const fetchFn = opts?.fetchFn ?? fetch;

  let lastStatus: number | undefined;
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchFn(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body: rawBody,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastStatus = response.status;
      if (is2xx(response.status)) {
        return { outcome: 'delivered', attempts: attempt, httpStatus: response.status };
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  logger.error(
    { eventType: envelope.eventType, eventId: envelope.eventId },
    'partner webhook delivery failed'
  );
  return {
    outcome: 'failed',
    attempts: MAX_ATTEMPTS,
    ...(lastStatus !== undefined ? { httpStatus: lastStatus } : {}),
    ...(lastError ? { errorMessage: lastError } : {}),
  };
}
