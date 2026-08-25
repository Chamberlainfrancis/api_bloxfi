import { describe, it, expect, vi } from 'vitest';
import { processWebhookEvent } from '@/core/webhooks/processWebhookEvent';

const ACCOUNT_ID = '1e3f2495-6d3d-42d6-97be-9e9f35d5dfc3';
const PROV_ID = 'prov-account-graph-1';

function emptyRepos(account: {
  findAccountById: ReturnType<typeof vi.fn>;
  updateProviderIssuance: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      findUserById: vi.fn(),
      updateUser: vi.fn(),
      updateKybRailStatuses: vi.fn(),
    },
    account: {
      findAccountById: account.findAccountById,
      updateProviderIssuance: account.updateProviderIssuance,
    },
    onramp: {
      findOnrampById: vi.fn(),
      findOnrampByTxnRef: vi.fn(),
      updateOnrampStatus: vi.fn(),
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

describe('processWebhookEvent account Graph issuance', () => {
  it('marks Account active on provisioned_account.active', async () => {
    const findAccountById = vi.fn().mockResolvedValue({
      id: ACCOUNT_ID,
      userId: 'user-briana',
      railType: 'onramp',
      provisionedAccountId: PROV_ID,
      providerIssuanceStatus: 'pending',
    });
    const updateProviderIssuance = vi.fn().mockResolvedValue({});

    await processWebhookEvent(emptyRepos({ findAccountById, updateProviderIssuance }), {
      eventId: 'evt-acc-active',
      eventType: 'provisioned_account.active',
      timestamp: new Date().toISOString(),
      data: {
        account: {
          id: PROV_ID,
          client_reference: ACCOUNT_ID,
          mode: 'FIAT_DEPOSIT_KYC',
          state: 'active',
          deposit_instructions: {
            kind: 'fiat_account',
            account_number: '9992740191426913',
            bank_code: '084106768',
            bank_name: 'Oval Bank',
            account_holder_name: 'Gilles Eykelberg',
            reference: 'GRAPH-WH-1',
          },
        },
      },
    });

    expect(updateProviderIssuance).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({
        providerIssuanceStatus: 'active',
        provisionedAccountId: PROV_ID,
        depositDetails: expect.objectContaining({
          accountNumber: '9992740191426913',
          reference: 'GRAPH-WH-1',
        }),
      })
    );
  });

  it('marks Account failed on provisioned_account.failed', async () => {
    const findAccountById = vi.fn().mockResolvedValue({
      id: ACCOUNT_ID,
      userId: 'user-briana',
      railType: 'onramp',
      provisionedAccountId: PROV_ID,
      providerIssuanceStatus: 'pending',
    });
    const updateProviderIssuance = vi.fn().mockResolvedValue({});

    await processWebhookEvent(emptyRepos({ findAccountById, updateProviderIssuance }), {
      eventId: 'evt-acc-failed',
      eventType: 'provisioned_account.failed',
      timestamp: new Date().toISOString(),
      data: {
        account: {
          id: PROV_ID,
          client_reference: ACCOUNT_ID,
          mode: 'FIAT_DEPOSIT_KYC',
          state: 'failed',
          failure_reason: {
            message: 'Poor image quality on the driving licence. Graph could not finish verification.',
          },
        },
      },
    });

    expect(updateProviderIssuance).toHaveBeenCalledWith(
      ACCOUNT_ID,
      expect.objectContaining({
        providerIssuanceStatus: 'failed',
        providerIssuanceFailureReason:
          'Poor image quality on the driving licence. provider could not finish verification.',
      })
    );
  });
});
