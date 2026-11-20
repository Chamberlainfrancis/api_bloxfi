import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/redis', () => ({ getRedis: vi.fn() }));
vi.mock('@/config', () => ({
  env: { API_KEY_HEADER: 'Authorization', RATE_LIMIT_WINDOW_SECONDS: 60, RATE_LIMIT_MAX_REQUESTS: 100 },
}));

import type { Request } from 'express';
import { rateLimitIdentifier } from '@/middleware/rateLimit';

function req(headers: Record<string, string>, ip = '10.0.0.1'): Request {
  return { headers, ip } as unknown as Request;
}

describe('rateLimitIdentifier', () => {
  it('buckets by the API key, so machines sharing a key share a limit', () => {
    const a = rateLimitIdentifier(req({ authorization: 'Bearer blxfi_abc' }, '10.0.0.1'));
    const b = rateLimitIdentifier(req({ authorization: 'Bearer blxfi_abc' }, '192.168.9.9'));
    expect(a).toBe(b);
    expect(a.startsWith('key:')).toBe(true);
    expect(a).not.toContain('blxfi_abc');
  });

  it('gives different keys different buckets, same IP or not', () => {
    const a = rateLimitIdentifier(req({ authorization: 'Bearer blxfi_abc' }));
    const b = rateLimitIdentifier(req({ authorization: 'Bearer blxfi_xyz' }));
    expect(a).not.toBe(b);
  });

  it('falls back to the IP when no credential is sent', () => {
    expect(rateLimitIdentifier(req({}))).toBe('ip:10.0.0.1');
  });
});
