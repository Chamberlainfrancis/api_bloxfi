import { describe, it, expect } from 'vitest';
import { buildAuditTrail } from '@/core/admin/auditTrail';

describe('buildAuditTrail', () => {
  it('includes LP payout and platform fee failure for offramps', () => {
    const trail = buildAuditTrail(
      'offramp',
      {
        status: 'COMPLETED',
        createdAt: '2026-06-01T10:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
        depositInstructions: { address: '0xdep' },
        timeline: {
          cryptoConfirmedAt: '2026-06-01T10:30:00.000Z',
          fiatInitiatedAt: '2026-06-01T11:00:00.000Z',
          completedAt: '2026-06-01T11:30:00.000Z',
          fiatWithdrawalCompleted: true,
        },
        providerRefs: {
          palremitOrchestrator: {
            withdrawalStatus: 'successful',
            palremitWithdrawalId: 'wd-fiat-1',
          },
        },
        fees: {
          platformFee: {
            amount: '0.5',
            currency: 'USDC',
            walletAddress: '0xfee',
            settlementNetwork: 'MATIC',
            settlement: {
              status: 'failed',
              attemptedAt: '2026-06-01T11:45:00.000Z',
              completedAt: '2026-06-01T11:46:00.000Z',
              withdrawalId: 'wd-fee-1',
              notes: ['Palremit withdrawal request failed'],
            },
          },
        },
      },
      []
    );

    expect(trail.some((e) => e.label === 'Fiat payout completed')).toBe(true);
    const feeFail = trail.find((e) => e.label === 'Platform fee settlement failed');
    expect(feeFail?.severity).toBe('error');
    expect(feeFail?.detail).toContain('Palremit withdrawal request failed');
  });

  it('includes manual admin actions and onramp crypto completion', () => {
    const trail = buildAuditTrail(
      'onramp',
      {
        status: 'COMPLETED',
        createdAt: '2026-06-01T10:00:00.000Z',
        updatedAt: '2026-06-01T12:00:00.000Z',
        depositInfo: { reference: 'ref' },
        providerRefs: {
          palremitOrchestrator: {
            depositStatus: 'credited',
            withdrawalStatus: 'successful',
            palremitWithdrawalId: 'wd-crypto-1',
            completedAt: '2026-06-01T11:30:00.000Z',
          },
        },
        receipt: { transactionHash: '0xabc', completedAt: '2026-06-01T11:30:00.000Z' },
      },
      [
        {
          fromStatus: 'CRYPTO_PENDING',
          toStatus: 'COMPLETED',
          actor: 'Ops',
          note: 'confirmed with LP',
          createdAt: '2026-06-01T11:00:00.000Z',
        },
      ]
    );

    expect(trail.some((e) => e.label.startsWith('Manual status change'))).toBe(true);
    const completed = trail.find((e) => e.label === 'Crypto payout completed');
    expect(completed?.at).toBe('2026-06-01T11:30:00.000Z');
    expect(trail[0]?.label).toBe('Transaction created');
  });

  it('renders fee approval admin actions', () => {
    const trail = buildAuditTrail(
      'offramp',
      {
        status: 'COMPLETED',
        createdAt: '2026-06-01T10:00:00.000Z',
        fees: {
          platformFee: {
            settlement: { status: 'processing', attemptedAt: '2026-06-01T12:00:00.000Z' },
          },
        },
      },
      [
        {
          fromStatus: 'fee:pending',
          toStatus: 'fee:processing',
          actor: 'Alice',
          note: 'Approved platform fee settlement',
          createdAt: '2026-06-01T11:59:00.000Z',
        },
      ]
    );

    expect(trail.some((e) => e.label === 'Platform fee settlement approved')).toBe(true);
  });

  it('renders fee retry admin actions', () => {
    const trail = buildAuditTrail(
      'offramp',
      {
        status: 'COMPLETED',
        createdAt: '2026-06-01T10:00:00.000Z',
        fees: {
          platformFee: {
            settlement: { status: 'processing', attemptedAt: '2026-06-01T12:00:00.000Z' },
          },
        },
      },
      [
        {
          fromStatus: 'fee:failed',
          toStatus: 'fee:processing',
          actor: 'Alice',
          note: 'Retried platform fee settlement',
          createdAt: '2026-06-01T11:59:00.000Z',
        },
      ]
    );

    expect(trail.some((e) => e.label === 'Platform fee settlement retried')).toBe(true);
  });
});
