import { describe, it, expect, vi } from 'vitest';
import { rateLimitIdentifier } from '@/middleware/rateLimit';

vi.mock('@/config', () => ({
  env: { API_KEY: 'live-key', API_KEY_HEADER: 'Authorization', RATE_LIMIT_WINDOW_SECONDS: 60, RATE_LIMIT_MAX_REQUESTS: 600 },
}));
vi.mock('@/services/redis', () => ({ getRedis: () => ({}) }));

describe('rateLimitIdentifier', () => {
  it('counts the real API key as one budget, whatever the IP', () => {
    const a = rateLimitIdentifier({ headers: { authorization: 'Bearer live-key' }, ip: '1.1.1.1' });
    const b = rateLimitIdentifier({ headers: { authorization: 'Bearer live-key' }, ip: '2.2.2.2' });
    expect(a).toBe(b);
    expect(a.startsWith('key:')).toBe(true);
    expect(a).not.toContain('live-key');
  });

  it('falls back to the IP for a missing or wrong key', () => {
    expect(rateLimitIdentifier({ headers: {}, ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
    expect(rateLimitIdentifier({ headers: { authorization: 'Bearer nope' }, ip: '1.1.1.1' })).toBe('ip:1.1.1.1');
  });
});
