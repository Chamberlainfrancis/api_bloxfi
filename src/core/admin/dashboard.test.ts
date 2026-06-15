import { describe, it, expect } from 'vitest';
import { resolveMarkStatus, toListRow, isValidStatus } from '@/core/admin/dashboard';

describe('resolveMarkStatus', () => {
  it('maps success to COMPLETED for both types', () => {
    expect(resolveMarkStatus('onramp', 'success')).toBe('COMPLETED');
    expect(resolveMarkStatus('offramp', 'success')).toBe('COMPLETED');
  });

  it('maps failed to FIAT_FAILED for onramp (no generic FAILED in its enum)', () => {
    expect(resolveMarkStatus('onramp', 'failed')).toBe('FIAT_FAILED');
  });

  it('maps failed to FAILED for offramp', () => {
    expect(resolveMarkStatus('offramp', 'failed')).toBe('FAILED');
  });
});

describe('toListRow', () => {
  it('derives amount/currency from source and ISO-formats createdAt', () => {
    const row = {
      id: 'abc',
      txnRef: 'ON-123',
      status: 'CREATED',
      userId: 'user-1',
      source: { currency: 'USD', amount: 100 },
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    expect(toListRow('onramp', row)).toEqual({
      id: 'abc',
      txnRef: 'ON-123',
      type: 'onramp',
      status: 'CREATED',
      userId: 'user-1',
      amount: 100,
      currency: 'USD',
      createdAt: '2026-06-15T10:00:00.000Z',
    });
  });

  it('returns null amount/currency when source is missing fields', () => {
    const row = {
      id: 'x',
      txnRef: null,
      status: 'COMPLETED',
      userId: 'u',
      source: {},
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    const out = toListRow('offramp', row);
    expect(out.amount).toBeNull();
    expect(out.currency).toBeNull();
  });
});

describe('isValidStatus', () => {
  it('accepts a valid status for the type', () => {
    expect(isValidStatus('onramp', 'AWAITING_FUNDS')).toBe(true);
    expect(isValidStatus('offramp', 'REFUNDED')).toBe(true);
  });

  it('rejects a status that does not belong to the type', () => {
    expect(isValidStatus('onramp', 'REFUNDED')).toBe(false);
    expect(isValidStatus('offramp', 'AWAITING_FUNDS')).toBe(false);
    expect(isValidStatus('onramp', 'NONSENSE')).toBe(false);
  });
});
