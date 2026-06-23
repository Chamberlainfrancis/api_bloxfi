import { describe, it, expect, vi } from 'vitest';
import {
  extractOnrampDepositDeadline,
  extractOfframpDepositDeadline,
  expireOnrampIfDepositPastDue,
  expireOfframpIfDepositPastDue,
  isDepositPastDue,
  shouldExpireOnrampStatus,
  shouldExpireOfframpStatus,
  DEPOSIT_EXPIRED_REASON,
} from '@/core/ramps/depositExpiry';

describe('deposit expiry helpers', () => {
  it('prefers depositBy over expiresAt within the same object', () => {
    const d = extractOnrampDepositDeadline({
      depositInfo: { depositBy: '2026-06-20T12:00:00.000Z', expiresAt: '2026-06-21T12:00:00.000Z' },
    });
    expect(d?.toISOString()).toBe('2026-06-20T12:00:00.000Z');
  });

  it('falls back to quote/rate expiresAt when depositBy is missing', () => {
    expect(
      extractOnrampDepositDeadline({
        quoteInformation: { expiresAt: '2026-06-20T12:00:00.000Z' },
      })?.toISOString()
    ).toBe('2026-06-20T12:00:00.000Z');
    expect(
      extractOfframpDepositDeadline({
        rateInformation: { expiresAt: '2026-06-20T12:00:00.000Z' },
      })?.toISOString()
    ).toBe('2026-06-20T12:00:00.000Z');
  });

  it('identifies awaiting deposit statuses', () => {
    expect(shouldExpireOnrampStatus('AWAITING_FUNDS')).toBe(true);
    expect(shouldExpireOnrampStatus('FIAT_PENDING')).toBe(true);
    expect(shouldExpireOnrampStatus('COMPLETED')).toBe(false);
    expect(shouldExpireOfframpStatus('AWAITING_CRYPTO')).toBe(true);
    expect(shouldExpireOfframpStatus('CRYPTO_PENDING')).toBe(true);
    expect(shouldExpireOfframpStatus('FIAT_PENDING')).toBe(false);
  });

  it('treats deadline at or before now as past due', () => {
    const now = new Date('2026-06-20T12:00:00.000Z');
    expect(isDepositPastDue(new Date('2026-06-20T12:00:00.000Z'), now)).toBe(true);
    expect(isDepositPastDue(new Date('2026-06-19T12:00:00.000Z'), now)).toBe(true);
    expect(isDepositPastDue(new Date('2026-06-21T12:00:00.000Z'), now)).toBe(false);
    expect(isDepositPastDue(null, now)).toBe(false);
  });
});

describe('expireOnrampIfDepositPastDue', () => {
  it('updates status when deposit window has passed', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const now = new Date('2026-06-21T00:00:00.000Z');
    const result = await expireOnrampIfDepositPastDue(
      {
        id: 'on-1',
        status: 'AWAITING_FUNDS',
        depositInfo: { depositBy: '2026-06-20T12:00:00.000Z' },
      },
      { updateOnrampStatus },
      now
    );
    expect(result).toBe('EXPIRED');
    expect(updateOnrampStatus).toHaveBeenCalledWith('on-1', 'EXPIRED', {
      failedReason: DEPOSIT_EXPIRED_REASON,
    });
  });

  it('does not update when still inside the deposit window', async () => {
    const updateOnrampStatus = vi.fn();
    const now = new Date('2026-06-19T00:00:00.000Z');
    const result = await expireOnrampIfDepositPastDue(
      {
        id: 'on-1',
        status: 'AWAITING_FUNDS',
        depositInfo: { depositBy: '2026-06-20T12:00:00.000Z' },
      },
      { updateOnrampStatus },
      now
    );
    expect(result).toBeNull();
    expect(updateOnrampStatus).not.toHaveBeenCalled();
  });
});

describe('expireOfframpIfDepositPastDue', () => {
  it('updates status when deposit window has passed', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const now = new Date('2026-06-21T00:00:00.000Z');
    const result = await expireOfframpIfDepositPastDue(
      {
        id: 'off-1',
        status: 'AWAITING_CRYPTO',
        depositInstructions: { depositBy: '2026-06-20T12:00:00.000Z' },
      },
      { updateOfframpStatus },
      now
    );
    expect(result).toBe('EXPIRED');
    expect(updateOfframpStatus).toHaveBeenCalledWith('off-1', 'EXPIRED', {
      failedReason: DEPOSIT_EXPIRED_REASON,
    });
  });
});
