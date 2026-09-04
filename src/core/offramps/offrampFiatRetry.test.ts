import { describe, expect, it } from 'vitest';
import {
  canReissueOfframpFiatPayout,
  canRetryOfframpHandoff,
  decideOfframpFiatRetry,
  offrampFiatWithdrawalId,
} from '@/core/offramps/offrampFiatRetry';

describe('offrampFiatWithdrawalId', () => {
  it('prefers timeline then orchestrator', () => {
    expect(offrampFiatWithdrawalId({ timeline: { fiatWithdrawalId: ' a ' } })).toBe('a');
    expect(
      offrampFiatWithdrawalId({
        providerRefs: { palremitOrchestrator: { palremitWithdrawalId: 'b' } },
      })
    ).toBe('b');
  });
});

describe('canRetryOfframpHandoff', () => {
  it('allows CRYPTO_CONFIRMED with no payout id', () => {
    expect(canRetryOfframpHandoff({ status: 'CRYPTO_CONFIRMED', timeline: {} })).toBe(true);
    expect(
      canRetryOfframpHandoff({
        status: 'CRYPTO_CONFIRMED',
        timeline: { fiatWithdrawalId: 'wd-1' },
      })
    ).toBe(false);
    expect(canRetryOfframpHandoff({ status: 'FIAT_PENDING', timeline: {} })).toBe(false);
  });
});

describe('canReissueOfframpFiatPayout', () => {
  it('allows when Palremit reports failed or stored status is failed', () => {
    expect(canReissueOfframpFiatPayout({ withdrawalId: 'wd', lpState: 'failed' })).toBe(true);
    expect(canReissueOfframpFiatPayout({ withdrawalId: 'wd', lpState: 'refunded' })).toBe(true);
    expect(
      canReissueOfframpFiatPayout({
        withdrawalId: 'wd',
        lpState: null,
        storedWithdrawalStatus: 'failed',
      })
    ).toBe(true);
    expect(canReissueOfframpFiatPayout({ withdrawalId: 'wd', lpState: 'processing' })).toBe(false);
    expect(canReissueOfframpFiatPayout({ withdrawalId: 'wd', lpState: 'successful' })).toBe(false);
    expect(canReissueOfframpFiatPayout({ withdrawalId: '', lpState: 'failed' })).toBe(false);
  });
});

describe('decideOfframpFiatRetry', () => {
  it('handoffs when no payout id exists', () => {
    expect(decideOfframpFiatRetry({ withdrawalId: '', lpState: null })).toEqual({
      action: 'handoff',
    });
  });

  it('reissues a failed or refunded Palremit payout', () => {
    expect(decideOfframpFiatRetry({ withdrawalId: 'wd-1', lpState: 'failed' })).toEqual({
      action: 'reissue',
      withdrawalId: 'wd-1',
    });
    expect(decideOfframpFiatRetry({ withdrawalId: 'wd-1', lpState: 'refunded' })).toEqual({
      action: 'reissue',
      withdrawalId: 'wd-1',
    });
  });

  it('rejects in-flight and successful payouts', () => {
    expect(decideOfframpFiatRetry({ withdrawalId: 'wd-1', lpState: 'processing' })).toEqual({
      action: 'reject',
      code: 'PAYOUT_IN_PROGRESS',
      message: 'Fiat payout is still processing at Palremit and cannot be retried',
      statusCode: 409,
    });
    expect(decideOfframpFiatRetry({ withdrawalId: 'wd-1', lpState: 'pending' })).toMatchObject({
      action: 'reject',
      code: 'PAYOUT_IN_PROGRESS',
      statusCode: 409,
    });
    expect(decideOfframpFiatRetry({ withdrawalId: 'wd-1', lpState: 'successful' }).action).toBe(
      'reject'
    );
  });
});
