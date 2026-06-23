import { describe, it, expect } from 'vitest';
import { resolveMarkStatus, toListRow, isValidStatus, isWithdrawalProcessing, sumProfitUsdc } from '@/core/admin/dashboard';

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
      beneficiaryName: null,
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

  it('prefers the explicit beneficiary account name over embedded user snapshots', () => {
    const row = {
      id: 'x',
      txnRef: null,
      status: 'COMPLETED',
      userId: 'u',
      source: { user: { firstName: 'Source', lastName: 'Person' } },
      destination: { user: { businessName: 'Dest Co' } },
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    expect(toListRow('offramp', row, 'Acme Bank Account').beneficiaryName).toBe('Acme Bank Account');
  });

  it('falls back to the embedded source user name, then destination user name', () => {
    const withSourceUser = {
      id: 'x',
      txnRef: null,
      status: 'COMPLETED',
      userId: 'u',
      source: { user: { firstName: 'Source', lastName: 'Person' } },
      destination: { user: { businessName: 'Dest Co' } },
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    expect(toListRow('onramp', withSourceUser).beneficiaryName).toBe('Source Person');

    const destOnly = {
      id: 'x',
      txnRef: null,
      status: 'COMPLETED',
      userId: 'u',
      source: {},
      destination: { user: { businessName: 'Dest Co' } },
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    expect(toListRow('onramp', destOnly).beneficiaryName).toBe('Dest Co');
  });

  it('returns null beneficiaryName when no names are available', () => {
    const row = {
      id: 'x',
      txnRef: null,
      status: 'COMPLETED',
      userId: 'u',
      source: {},
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    expect(toListRow('offramp', row).beneficiaryName).toBeNull();
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

describe('sumProfitUsdc', () => {
  it('sums amountUsdc and skips nulls / missing', () => {
    const rows = [
      { profit: { amountUsdc: '1.50000000' } },
      { profit: { amountUsdc: null } },
      { profit: null },
      {},
      { profit: { amountUsdc: '2.25000000' } },
    ];
    expect(sumProfitUsdc(rows)).toBe('3.75000000');
  });

  it('returns 0.00000000 for an empty set', () => {
    expect(sumProfitUsdc([])).toBe('0.00000000');
  });
});

describe('isWithdrawalProcessing', () => {
  it('is true when payout was sent and withdrawal status is pending', () => {
    expect(
      isWithdrawalProcessing('offramp', 'FIAT_PENDING', {
        palremitOrchestrator: { palremitWithdrawalId: 'wd-1', withdrawalStatus: 'pending' },
      })
    ).toBe(true);
    expect(
      isWithdrawalProcessing('onramp', 'CRYPTO_PENDING', {
        palremitOrchestrator: { withdrawalStatus: 'pending' },
      })
    ).toBe(true);
  });

  it('is false once the LP reports a terminal withdrawal status', () => {
    expect(
      isWithdrawalProcessing('offramp', 'FIAT_PENDING', {
        palremitOrchestrator: { withdrawalStatus: 'successful' },
      })
    ).toBe(false);
    expect(
      isWithdrawalProcessing('offramp', 'FAILED', {
        palremitOrchestrator: { withdrawalStatus: 'failed', markedManually: true },
      })
    ).toBe(false);
  });

  it('is false before payout has been sent to Palremit', () => {
    expect(
      isWithdrawalProcessing('offramp', 'CRYPTO_CONFIRMED', {
        palremitOrchestrator: { depositStatus: 'credited' },
      })
    ).toBe(false);
  });
});
