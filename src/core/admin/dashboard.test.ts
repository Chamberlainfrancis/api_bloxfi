import { describe, it, expect } from 'vitest';
import { resolveMarkStatus, toListRow, isValidStatus, isWithdrawalProcessing, sumProfitUsdc, extractFiatPayoutError, canRetryOfframpFiatPayout, toPendingFeeSettlementRow, mergeFeeSettlementPages, platformFeeSettlementStatus } from '@/core/admin/dashboard';

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

describe('extractFiatPayoutError', () => {
  it('reads from timeline then providerRefs', () => {
    expect(
      extractFiatPayoutError({
        timeline: { fiatPayoutLastError: 'timeline error' },
        providerRefs: { palremitOrchestrator: { fiatPayoutLastError: 'orch error' } },
      })
    ).toBe('timeline error');
    expect(
      extractFiatPayoutError({
        providerRefs: { palremitOrchestrator: { fiatPayoutLastError: 'orch error' } },
      })
    ).toBe('orch error');
    expect(extractFiatPayoutError({})).toBeNull();
  });
});

describe('canRetryOfframpFiatPayout', () => {
  it('allows handoff retry in CRYPTO_CONFIRMED without a withdrawal id', () => {
    expect(
      canRetryOfframpFiatPayout({
        status: 'CRYPTO_CONFIRMED',
        timeline: {},
        providerRefs: {},
      })
    ).toBe(true);
    expect(
      canRetryOfframpFiatPayout({
        status: 'CRYPTO_CONFIRMED',
        timeline: { fiatWithdrawalId: 'wd-1' },
        providerRefs: {},
      })
    ).toBe(false);
    expect(canRetryOfframpFiatPayout({ status: 'FIAT_PENDING', timeline: {}, providerRefs: {} })).toBe(
      false
    );
  });

  it('allows reissue when Palremit reports failed or stored status is failed', () => {
    expect(
      canRetryOfframpFiatPayout({
        status: 'COMPLETED',
        timeline: { fiatWithdrawalId: 'wd-1' },
        lpWithdrawalState: 'failed',
      })
    ).toBe(true);
    expect(
      canRetryOfframpFiatPayout({
        status: 'COMPLETED',
        timeline: { fiatWithdrawalId: 'wd-1' },
        lpWithdrawalState: 'refunded',
      })
    ).toBe(true);
    expect(
      canRetryOfframpFiatPayout({
        status: 'FIAT_PENDING',
        timeline: { fiatWithdrawalId: 'wd-1' },
        providerRefs: { palremitOrchestrator: { withdrawalStatus: 'failed' } },
      })
    ).toBe(true);
    expect(
      canRetryOfframpFiatPayout({
        status: 'COMPLETED',
        timeline: { fiatWithdrawalId: 'wd-1' },
        lpWithdrawalState: 'successful',
      })
    ).toBe(false);
  });

  it('does not allow retry while Palremit is still processing', () => {
    expect(
      canRetryOfframpFiatPayout({
        status: 'FIAT_PENDING',
        timeline: { fiatWithdrawalId: 'wd-1' },
        providerRefs: { palremitOrchestrator: { withdrawalStatus: 'failed' } },
        lpWithdrawalState: 'processing',
      })
    ).toBe(false);
    expect(
      canRetryOfframpFiatPayout({
        status: 'FIAT_PENDING',
        timeline: { fiatWithdrawalId: 'wd-1' },
        lpWithdrawalState: 'pending',
      })
    ).toBe(false);
  });
});

describe('fee settlement queue rows', () => {
  const onrampRow = {
    id: 'on-1',
    txnRef: 'ON-635d8fecfbc6926c9333ad98',
    source: { amount: 5015.6, currency: 'usd' },
    destination: { amount: 5000.07, currency: 'usdc' },
    fees: {
      platformFee: {
        amount: '7.51138179',
        currency: 'usdc',
        walletAddress: '0xFee',
        settlementNetwork: 'MATIC',
        settlementCurrency: 'USDC',
        settlement: { status: 'pending', attemptedAt: '2026-10-02T09:00:00.000Z' },
      },
    },
    createdAt: new Date('2026-09-30T11:03:12.644Z'),
  };

  it('tags rows with their ramp type', () => {
    const row = toPendingFeeSettlementRow('onramp', onrampRow);
    expect(row).toMatchObject({
      id: 'on-1',
      type: 'onramp',
      settlementStatus: 'pending',
      feeAmount: '7.51138179',
      walletAddress: '0xFee',
      settlementNetwork: 'MATIC',
    });
    expect(platformFeeSettlementStatus(onrampRow.fees)).toBe('pending');
    expect(platformFeeSettlementStatus({})).toBeNull();
  });

  it('merges onramp and offramp pages newest first with a shared cursor', () => {
    const on = toPendingFeeSettlementRow('onramp', onrampRow);
    const offNew = { ...on, id: 'off-1', type: 'offramp' as const, createdAt: '2026-10-01T00:00:00.000Z' };
    const offOld = { ...on, id: 'off-2', type: 'offramp' as const, createdAt: '2026-09-01T00:00:00.000Z' };
    const page = mergeFeeSettlementPages(
      [
        { items: [on], hasMore: false },
        { items: [offNew, offOld], hasMore: false },
      ],
      2
    );
    expect(page.items.map((i) => i.id)).toEqual(['off-1', 'on-1']);
    expect(page.nextCursor).toBe(on.createdAt);

    const last = mergeFeeSettlementPages([{ items: [on], hasMore: false }, { items: [], hasMore: false }], 25);
    expect(last.nextCursor).toBeNull();
  });
});
