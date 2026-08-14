import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'crypto';
import { dispatchPartnerWebhook, signPartnerWebhookBody } from '@/core/partnerWebhooks/dispatch';
import type { PartnerWebhookEnvelope } from '@/types/partnerWebhook';

const envelope: PartnerWebhookEnvelope = {
  eventId: '11111111-1111-4111-8111-111111111111',
  eventType: 'user.created',
  occurredAt: '2026-08-14T14:00:00.000Z',
  data: { userId: 'u1' },
};

describe('dispatchPartnerWebhook', () => {
  it('does not fetch when url is unset', async () => {
    const fetchFn = vi.fn();
    await dispatchPartnerWebhook(envelope, { url: null, secret: 'x'.repeat(16), fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs JSON signed with HMAC-SHA256 of the exact raw body', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const secret = 's'.repeat(16);
    await dispatchPartnerWebhook(envelope, { url: 'https://partner.example/hooks', secret, fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://partner.example/hooks');
    const raw = init.body as string;
    expect(JSON.parse(raw)).toEqual(envelope);
    expect(init.headers['X-Webhook-Signature']).toBe(signPartnerWebhookBody(raw, secret));
    expect(init.headers['X-Webhook-Signature']).toBe(
      createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
    );
  });

  it('retries a 500 then succeeds', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'err' })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => '' });
    await dispatchPartnerWebhook(envelope, {
      url: 'https://partner.example/hooks',
      secret: 's'.repeat(16),
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not throw after three failures', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'err' });
    await expect(
      dispatchPartnerWebhook(envelope, {
        url: 'https://partner.example/hooks',
        secret: 's'.repeat(16),
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).resolves.toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
