import { createHmac } from 'crypto';
import { logger } from '@/lib/logger';
import type { PartnerWebhookEnvelope } from '@/types/partnerWebhook';

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
): Promise<void> {
  const { url, secret } = await resolveUrlAndSecret(opts);
  if (!url) return;

  if (!secret) {
    logger.warn(
      { eventType: envelope.eventType, eventId: envelope.eventId },
      'partner webhook secret missing'
    );
    return;
  }

  const rawBody = JSON.stringify(envelope);
  const signature = signPartnerWebhookBody(rawBody, secret);
  const fetchFn = opts?.fetchFn ?? fetch;

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
      if (is2xx(response.status)) return;
    } catch {
      // timeout / network — retry
    }
  }

  logger.error(
    { eventType: envelope.eventType, eventId: envelope.eventId },
    'partner webhook delivery failed'
  );
}
