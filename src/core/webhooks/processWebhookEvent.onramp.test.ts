import { describe, it, expect, vi } from 'vitest';
import { processWebhookEvent } from '@/core/webhooks/processWebhookEvent';

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
