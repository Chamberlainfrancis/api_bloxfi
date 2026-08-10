import { describe, it, expect, vi } from 'vitest';
import { processWebhookEvent } from '@/core/webhooks/processWebhookEvent';

const ON_TXN = 'ON-aaaaaaaaaaaaaaaaaaaaaaaa';
const ON_PROV = 'prov-on-1';

function emptyOnrampRepos(onramp: {
  findOnrampByTxnRef: ReturnType<typeof vi.fn>;
  updateOnrampStatus: ReturnType<typeof vi.fn>;
  advanceOnrampAfterFiatWebhook?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      findUserById: vi.fn(),
      updateUser: vi.fn(),
      updateKybRailStatuses: vi.fn(),
    },
    onramp: {
      findOnrampById: vi.fn(),
      findOnrampByTxnRef: onramp.findOnrampByTxnRef,
      updateOnrampStatus: onramp.updateOnrampStatus,
      advanceOnrampAfterFiatWebhook: onramp.advanceOnrampAfterFiatWebhook,
    },
    offramp: {
      findOfframpById: vi.fn(),
      findOfframpByTxnRef: vi.fn(),
      updateOfframpStatus: vi.fn(),
    },
    highValueRequest: {
      findHighValueRequestById: vi.fn(),
      findHighValueRequestByRequestId: vi.fn(),
      updateHighValueRequestStatus: vi.fn(),
    },
  };
}

describe('processWebhookEvent onramp deposit.credited', () => {
  it('recovers EXPIRED onramp when LP credits fiat deposit after deposit window', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const advanceOnrampAfterFiatWebhook = vi.fn().mockResolvedValue(undefined);
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    const findOnrampByTxnRef = vi.fn().mockResolvedValue({
      id: 'onramp-expired',
      requestId: 'req-expired',
      status: 'EXPIRED',
      txnRef: ON_TXN,
      failedReason: 'Deposit window expired',
      providerRefs: { palremitOrchestrator: { provisionedAccountId: ON_PROV } },
      source: { currency: 'usd' },
      quoteInformation: { expiresAt: pastDue },
      depositInfo: { depositBy: pastDue },
    });

    await processWebhookEvent(
      emptyOnrampRepos({ findOnrampByTxnRef, updateOnrampStatus, advanceOnrampAfterFiatWebhook }),
      {
        eventId: 'evt-dep-expired',
        eventType: 'deposit.credited',
        timestamp: new Date().toISOString(),
        data: {
          client_reference: ON_TXN,
          deposit: {
            id: 'dep-fiat-1',
            mode: 'FIAT_DEPOSIT',
            asset: { code: 'USD' },
            credited_at: new Date().toISOString(),
            provisioned_account_id: ON_PROV,
          },
        },
      }
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'onramp-expired',
      'FIAT_PROCESSED',
      expect.objectContaining({ failedReason: null })
    );
    expect(advanceOnrampAfterFiatWebhook).toHaveBeenCalledWith('onramp-expired');
  });

  it('credits late fiat deposit without marking EXPIRED when window already passed', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const advanceOnrampAfterFiatWebhook = vi.fn().mockResolvedValue(undefined);
    const pastDue = new Date(Date.now() - 60_000).toISOString();
    const findOnrampByTxnRef = vi.fn().mockResolvedValue({
      id: 'onramp-late',
      requestId: 'req-late',
      status: 'AWAITING_FUNDS',
      txnRef: ON_TXN,
      providerRefs: { palremitOrchestrator: { provisionedAccountId: ON_PROV } },
      source: { currency: 'usd' },
      quoteInformation: { expiresAt: pastDue },
      depositInfo: { depositBy: pastDue },
    });

    await processWebhookEvent(
      emptyOnrampRepos({ findOnrampByTxnRef, updateOnrampStatus, advanceOnrampAfterFiatWebhook }),
      {
        eventId: 'evt-dep-late',
        eventType: 'deposit.credited',
        timestamp: new Date().toISOString(),
        data: {
          client_reference: ON_TXN,
          deposit: {
            id: 'dep-fiat-2',
            mode: 'FIAT_DEPOSIT',
            asset: { code: 'USD' },
            credited_at: new Date().toISOString(),
            provisioned_account_id: ON_PROV,
          },
        },
      }
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'onramp-late',
      'FIAT_PROCESSED',
      expect.objectContaining({ failedReason: null })
    );
    expect(updateOnrampStatus).not.toHaveBeenCalledWith('onramp-late', 'EXPIRED', expect.anything());
    expect(advanceOnrampAfterFiatWebhook).toHaveBeenCalledWith('onramp-late');
  });
});

describe('processWebhookEvent onramp withdrawal.successful', () => {
  it('completes onramp from CRYPTO_FAILED when LP confirms crypto payout', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampByTxnRef = vi.fn().mockResolvedValue({
      id: 'onramp-1',
      requestId: 'req-1',
      status: 'CRYPTO_FAILED',
      txnRef: 'ON-aaaaaaaaaaaaaaaaaaaaaaaa',
      providerRefs: {
        palremitOrchestrator: { provisionedAccountId: 'prov-1' },
      },
      source: { currency: 'usd' },
      quoteInformation: {},
    });

    await processWebhookEvent(
      {
        user: {
          findUserById: vi.fn(),
          updateUser: vi.fn(),
          updateKybRailStatuses: vi.fn(),
        },
        onramp: {
          findOnrampById: vi.fn(),
          findOnrampByTxnRef,
          updateOnrampStatus,
        },
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef: vi.fn(),
          updateOfframpStatus: vi.fn(),
        },
        highValueRequest: {
          findHighValueRequestById: vi.fn(),
          findHighValueRequestByRequestId: vi.fn(),
          updateHighValueRequestStatus: vi.fn(),
        },
      },
      {
        eventId: 'evt-1',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-lp-1',
            client_reference: 'ON-aaaaaaaaaaaaaaaaaaaaaaaa',
            state: 'successful',
            mode: 'CRYPTO_WITHDRAWAL',
            provider_external_ref: '0xhash',
          },
        },
      }
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'onramp-1',
      'COMPLETED',
      expect.objectContaining({
        failedReason: null,
        receipt: expect.objectContaining({
          palremitWithdrawalId: 'wd-lp-1',
          transactionHash: '0xhash',
          awaitingWebhookConfirmation: false,
        }),
      })
    );
  });

  it('completes onramp from CRYPTO_PENDING (normal happy path)', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampByTxnRef = vi.fn().mockResolvedValue({
      id: 'onramp-2',
      requestId: 'req-2',
      status: 'CRYPTO_PENDING',
      txnRef: 'ON-bbbbbbbbbbbbbbbbbbbbbbbb',
      providerRefs: {
        palremitOrchestrator: { palremitWithdrawalId: 'wd-stored' },
      },
      source: { currency: 'usd' },
      quoteInformation: {},
    });

    await processWebhookEvent(
      {
        user: {
          findUserById: vi.fn(),
          updateUser: vi.fn(),
          updateKybRailStatuses: vi.fn(),
        },
        onramp: {
          findOnrampById: vi.fn(),
          findOnrampByTxnRef,
          updateOnrampStatus,
        },
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef: vi.fn(),
          updateOfframpStatus: vi.fn(),
        },
        highValueRequest: {
          findHighValueRequestById: vi.fn(),
          findHighValueRequestByRequestId: vi.fn(),
          updateHighValueRequestStatus: vi.fn(),
        },
      },
      {
        eventId: 'evt-3',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-stored',
            client_reference: 'ON-bbbbbbbbbbbbbbbbbbbbbbbb',
            state: 'successful',
            mode: 'CRYPTO_WITHDRAWAL',
          },
        },
      }
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'onramp-2',
      'COMPLETED',
      expect.objectContaining({
        failedReason: null,
        receipt: expect.objectContaining({
          palremitWithdrawalId: 'wd-stored',
          completedAt: expect.any(String),
          awaitingWebhookConfirmation: false,
        }),
      })
    );
  });

  it('resolves client_reference from data when absent on withdrawal object', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampByTxnRef = vi.fn().mockResolvedValue({
      id: 'onramp-3',
      requestId: 'req-3',
      status: 'CRYPTO_PENDING',
      txnRef: 'ON-cccccccccccccccccccccccc',
      providerRefs: {},
      source: { currency: 'usd' },
      quoteInformation: {},
    });

    await processWebhookEvent(
      {
        user: {
          findUserById: vi.fn(),
          updateUser: vi.fn(),
          updateKybRailStatuses: vi.fn(),
        },
        onramp: {
          findOnrampById: vi.fn(),
          findOnrampByTxnRef,
          updateOnrampStatus,
        },
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef: vi.fn(),
          updateOfframpStatus: vi.fn(),
        },
        highValueRequest: {
          findHighValueRequestById: vi.fn(),
          findHighValueRequestByRequestId: vi.fn(),
          updateHighValueRequestStatus: vi.fn(),
        },
      },
      {
        eventId: 'evt-4',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          client_reference: 'ON-cccccccccccccccccccccccc',
          withdrawal: {
            id: 'wd-lp-3',
            state: 'successful',
          },
        },
      }
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith('onramp-3', 'COMPLETED', expect.any(Object));
  });

  it('ignores withdrawal.successful when onramp is already COMPLETED', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampByTxnRef = vi.fn().mockResolvedValue({
      id: 'onramp-1',
      requestId: 'req-1',
      status: 'COMPLETED',
      txnRef: 'ON-aaaaaaaaaaaaaaaaaaaaaaaa',
      providerRefs: {},
      source: { currency: 'usd' },
      quoteInformation: {},
    });

    await processWebhookEvent(
      {
        user: {
          findUserById: vi.fn(),
          updateUser: vi.fn(),
          updateKybRailStatuses: vi.fn(),
        },
        onramp: {
          findOnrampById: vi.fn(),
          findOnrampByTxnRef,
          updateOnrampStatus,
        },
        offramp: {
          findOfframpById: vi.fn(),
          findOfframpByTxnRef: vi.fn(),
          updateOfframpStatus: vi.fn(),
        },
        highValueRequest: {
          findHighValueRequestById: vi.fn(),
          findHighValueRequestByRequestId: vi.fn(),
          updateHighValueRequestStatus: vi.fn(),
        },
      },
      {
        eventId: 'evt-2',
        eventType: 'withdrawal.successful',
        timestamp: new Date().toISOString(),
        data: {
          withdrawal: {
            id: 'wd-lp-1',
            client_reference: 'ON-aaaaaaaaaaaaaaaaaaaaaaaa',
            state: 'successful',
            mode: 'CRYPTO_WITHDRAWAL',
          },
        },
      }
    );

    expect(updateOnrampStatus).not.toHaveBeenCalled();
  });
});
