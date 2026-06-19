import { describe, it, expect, vi } from 'vitest';
import { processWebhookEvent } from '@/core/webhooks/processWebhookEvent';

const TXN_REF = 'OFF-261e3c8c859393faf5ba6684';
const PROV_ID = '019ea7ad-bfa8-779c-8843-4c151af36a10';

function baseOfframp(overrides?: { status?: string; timeline?: Record<string, unknown> }) {
  return {
    id: 'offramp-1',
    status: overrides?.status ?? 'AWAITING_CRYPTO',
    txnRef: TXN_REF,
    providerRefs: {
      palremitOrchestrator: { provisionedAccountId: PROV_ID },
    },
    source: { currency: 'usdt', amount: 600250, chain: 'TRC20' },
    depositInstructions: { amount: '600250', currency: 'USDT', network: 'TRC20' },
    timeline: overrides?.timeline ?? { createdAt: '2026-06-08T14:00:00.000Z' },
    rateInformation: {},
  };
}

function depositCreditedPayload(amount: number) {
  return {
    eventId: 'evt-dep-1',
    eventType: 'deposit.credited' as const,
    timestamp: new Date().toISOString(),
    data: {
      client_reference: TXN_REF,
      deposit: {
        id: 'dep-1',
        mode: 'CRYPTO_DEPOSIT',
        asset: { code: 'USDT' },
        amount,
        network: 'TRC20',
        credited_at: new Date().toISOString(),
        provisioned_account_id: PROV_ID,
      },
    },
  };
}

const emptyRepos = {
  user: {
    findUserById: vi.fn(),
    updateUser: vi.fn(),
    updateKybRailStatuses: vi.fn(),
  },
  onramp: {
    findOnrampById: vi.fn(),
    findOnrampByTxnRef: vi.fn(),
    updateOnrampStatus: vi.fn(),
  },
  highValueRequest: {
    findHighValueRequestById: vi.fn(),
    findHighValueRequestByRequestId: vi.fn(),
    updateHighValueRequestStatus: vi.fn(),
  },
};

describe('processWebhookEvent offramp deposit.credited', () => {
  it('records partial deposit as CRYPTO_RECEIVED without triggering payout', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const advanceOfframpAfterCryptoWebhook = vi.fn().mockResolvedValue(undefined);
    const findOfframpByTxnRef = vi.fn().mockResolvedValue(baseOfframp());

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          advanceOfframpAfterCryptoWebhook,
        },
      },
      depositCreditedPayload(100)
    );

    expect(updateOfframpStatus).toHaveBeenCalledWith(
      'offramp-1',
      'CRYPTO_RECEIVED',
      expect.objectContaining({
        timeline: expect.objectContaining({
          cryptoReceivedAmount: 100,
          cryptoExpectedAmount: 600250,
        }),
        providerRefs: expect.objectContaining({
          palremitOrchestrator: expect.objectContaining({
            depositStatus: 'partial',
            cryptoReceivedAmount: 100,
          }),
        }),
      })
    );
    expect(advanceOfframpAfterCryptoWebhook).not.toHaveBeenCalled();
  });

  it('accumulates deposits and triggers payout only when quoted amount is met', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const advanceOfframpAfterCryptoWebhook = vi.fn().mockResolvedValue(undefined);
    const findOfframpByTxnRef = vi.fn().mockResolvedValue(
      baseOfframp({
        status: 'CRYPTO_RECEIVED',
        timeline: { cryptoReceivedAmount: 100, cryptoExpectedAmount: 600250 },
      })
    );

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          advanceOfframpAfterCryptoWebhook,
        },
      },
      depositCreditedPayload(600150)
    );

    expect(updateOfframpStatus).toHaveBeenCalledWith(
      'offramp-1',
      'CRYPTO_CONFIRMED',
      expect.objectContaining({
        timeline: expect.objectContaining({
          cryptoReceivedAmount: 600250,
          cryptoExpectedAmount: 600250,
          cryptoConfirmedAt: expect.any(String),
        }),
      })
    );
    expect(advanceOfframpAfterCryptoWebhook).toHaveBeenCalledWith('offramp-1');
  });

  it('triggers payout on single webhook when full amount is credited', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const advanceOfframpAfterCryptoWebhook = vi.fn().mockResolvedValue(undefined);
    const findOfframpByTxnRef = vi.fn().mockResolvedValue({
      ...baseOfframp(),
      source: { currency: 'usdt', amount: 100, chain: 'TRC20' },
      depositInstructions: { amount: '100', currency: 'USDT', network: 'TRC20' },
    });

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          advanceOfframpAfterCryptoWebhook,
        },
      },
      depositCreditedPayload(100)
    );

    expect(updateOfframpStatus).toHaveBeenCalledWith('offramp-1', 'CRYPTO_CONFIRMED', expect.any(Object));
    expect(advanceOfframpAfterCryptoWebhook).toHaveBeenCalledWith('offramp-1');
  });
});

describe('processWebhookEvent offramp withdrawal.successful (fiat)', () => {
  it('marks offramp COMPLETED and triggers fee settlement hook', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const afterOfframpCompleted = vi.fn();
    const findOfframpByTxnRef = vi.fn().mockResolvedValue({
      id: 'offramp-1',
      status: 'FIAT_PENDING',
      txnRef: TXN_REF,
      providerRefs: { palremitOrchestrator: { palremitWithdrawalId: 'wd-fiat-1' } },
      source: {},
      depositInstructions: null,
      timeline: { fiatWithdrawalId: 'wd-fiat-1' },
      rateInformation: {},
    });

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          afterOfframpCompleted,
        },
      },
      {
        eventId: 'evt-wd-1',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-fiat-1',
            client_reference: TXN_REF,
            state: 'successful',
            mode: 'FIAT_WITHDRAWAL',
          },
        },
      }
    );

    expect(updateOfframpStatus).toHaveBeenCalledWith('offramp-1', 'COMPLETED', expect.any(Object));
    expect(afterOfframpCompleted).toHaveBeenCalledWith('offramp-1');
  });

  it('does not treat fee client_reference as fiat offramp completion', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const afterOfframpCompleted = vi.fn();
    const applyPlatformFeeWithdrawalWebhook = vi.fn().mockResolvedValue(true);
    const findOfframpByTxnRef = vi.fn();

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          afterOfframpCompleted,
          applyPlatformFeeWithdrawalWebhook,
        },
      },
      {
        eventId: 'evt-fee-1',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-fee-1',
            client_reference: `${TXN_REF}-FEE`,
            state: 'successful',
            mode: 'CRYPTO_WITHDRAWAL',
            settlement_reference: '0xabc',
          },
        },
      }
    );

    expect(findOfframpByTxnRef).not.toHaveBeenCalled();
    expect(updateOfframpStatus).not.toHaveBeenCalled();
    expect(afterOfframpCompleted).not.toHaveBeenCalled();
    expect(applyPlatformFeeWithdrawalWebhook).toHaveBeenCalledWith(
      TXN_REF,
      expect.objectContaining({ client_reference: `${TXN_REF}-FEE` }),
      'completed'
    );
  });

  it('completes offramp from FAILED when LP later confirms fiat payout', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const afterOfframpCompleted = vi.fn();
    const findOfframpByTxnRef = vi.fn().mockResolvedValue({
      id: 'offramp-failed',
      status: 'FAILED',
      txnRef: TXN_REF,
      failedReason: 'Marked failed by operator',
      providerRefs: {
        palremitOrchestrator: {
          palremitWithdrawalId: 'wd-fiat-1',
          withdrawalStatus: 'failed',
          markedManually: true,
        },
      },
      source: {},
      depositInstructions: null,
      timeline: { fiatWithdrawalId: 'wd-fiat-1' },
      rateInformation: {},
    });

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          afterOfframpCompleted,
        },
      },
      {
        eventId: 'evt-wd-recover',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-fiat-1',
            client_reference: TXN_REF,
            state: 'successful',
            mode: 'FIAT_WITHDRAWAL',
          },
        },
      }
    );

    expect(updateOfframpStatus).toHaveBeenCalledWith(
      'offramp-failed',
      'COMPLETED',
      expect.objectContaining({ failedReason: null })
    );
    expect(afterOfframpCompleted).toHaveBeenCalledWith('offramp-failed');
  });

  it('ignores withdrawal.successful for FAILED offramp not marked manually', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const afterOfframpCompleted = vi.fn();
    const findOfframpByTxnRef = vi.fn().mockResolvedValue({
      id: 'offramp-lp-failed',
      status: 'FAILED',
      txnRef: TXN_REF,
      failedReason: 'PALREMIT_WITHDRAW_FAILED',
      providerRefs: {
        palremitOrchestrator: {
          palremitWithdrawalId: 'wd-fiat-1',
          withdrawalStatus: 'failed',
        },
      },
      source: {},
      depositInstructions: null,
      timeline: { fiatWithdrawalId: 'wd-fiat-1' },
      rateInformation: {},
    });

    await processWebhookEvent(
      {
        ...emptyRepos,
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef,
          updateOfframpStatus,
          afterOfframpCompleted,
        },
      },
      {
        eventId: 'evt-wd-ignore',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-fiat-1',
            client_reference: TXN_REF,
            state: 'successful',
            mode: 'FIAT_WITHDRAWAL',
          },
        },
      }
    );

    expect(updateOfframpStatus).not.toHaveBeenCalled();
    expect(afterOfframpCompleted).not.toHaveBeenCalled();
  });
});
