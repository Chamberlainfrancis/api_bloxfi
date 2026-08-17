import { describe, it, expect, vi } from 'vitest';
import { schedulePartnerWebhook, type OutboundWebhookStore } from '@/core/partnerWebhooks/emit';

function memoryStore(): OutboundWebhookStore & {
  pending: Array<Record<string, unknown>>;
  finals: Array<Record<string, unknown>>;
} {
  const pending: Array<Record<string, unknown>> = [];
  const finals: Array<Record<string, unknown>> = [];
  return {
    pending,
    finals,
    async createPending(input) {
      pending.push(input);
      return 'log-1';
    },
    async finalize(id, result) {
      finals.push({ id, ...result });
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20));
}

describe('schedulePartnerWebhook outbound log', () => {
  it('stores skipped_no_url when destination is unset', async () => {
    const store = memoryStore();
    schedulePartnerWebhook(
      'user.created',
      { userId: 'u1' },
      {
        url: null,
        secret: 's'.repeat(16),
        id: () => 'evt-1',
        now: () => new Date('2026-08-14T14:00:00.000Z'),
        store,
      }
    );
    await flush();
    expect(store.pending).toHaveLength(1);
    expect(store.pending[0].eventId).toBe('evt-1');
    expect(store.pending[0].destination).toBeNull();
    expect(store.finals).toEqual([
      expect.objectContaining({ id: 'log-1', outcome: 'skipped_no_url', attempts: 0, destination: null }),
    ]);
  });

  it('stores delivered after a 2xx POST', async () => {
    const store = memoryStore();
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    schedulePartnerWebhook(
      'account.created',
      { accountId: 'a1' },
      {
        url: 'https://partner.example/hooks',
        secret: 's'.repeat(16),
        fetchFn: fetchFn as unknown as typeof fetch,
        store,
      }
    );
    await flush();
    expect(store.pending[0].destination).toBe('https://partner.example/hooks');
    expect(store.finals).toEqual([
      expect.objectContaining({
        outcome: 'delivered',
        attempts: 1,
        httpStatus: 200,
        destination: 'https://partner.example/hooks',
      }),
    ]);
  });

  it('stores skipped_no_secret when secret is missing', async () => {
    const store = memoryStore();
    const fetchFn = vi.fn();
    schedulePartnerWebhook(
      'user.created',
      { userId: 'u1' },
      {
        url: 'https://partner.example/hooks',
        secret: null,
        fetchFn: fetchFn as unknown as typeof fetch,
        store,
      }
    );
    await flush();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(store.finals).toEqual([
      expect.objectContaining({
        outcome: 'skipped_no_secret',
        attempts: 0,
        destination: 'https://partner.example/hooks',
      }),
    ]);
  });

  it('still POSTs when the outbound log create throws', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const store: OutboundWebhookStore = {
      async createPending() {
        throw new Error('db down');
      },
      async finalize() {
        throw new Error('should not finalize');
      },
    };
    schedulePartnerWebhook(
      'user.created',
      { userId: 'u1' },
      {
        url: 'https://partner.example/hooks',
        secret: 's'.repeat(16),
        fetchFn: fetchFn as unknown as typeof fetch,
        store,
      }
    );
    await flush();
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it('stores failed after three non-2xx attempts', async () => {
    const store = memoryStore();
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    schedulePartnerWebhook(
      'onramp.created',
      { onrampId: 'o1' },
      {
        url: 'https://partner.example/hooks',
        secret: 's'.repeat(16),
        fetchFn: fetchFn as unknown as typeof fetch,
        store,
      }
    );
    await flush();
    expect(store.finals).toEqual([
      expect.objectContaining({ outcome: 'failed', attempts: 3, httpStatus: 500 }),
    ]);
  });
});
