import { describe, it, expect, vi } from 'vitest';
import { advanceOnrampIfFiatProcessed } from '@/core/onramps/advanceOnrampPayout';

const baseRow = {
  id: 'onramp-1',
  requestId: 'req-1',
  userId: 'user-1',
  txnRef: 'ON-abc123',
  source: {
    userId: 'user-1',
    currency: 'usd',
    amount: 100,
  },
  destination: {
    userId: 'user-1',
    currency: 'usdt',
    chain: 'POLYGON',
    walletAddress: '0xabc',
    externalWalletId: 'wallet-1',
    amount: 99.5,
  },
  developerFee: { amount: '0.5', currency: 'usdt' },
  receipt: null,
  providerRefs: { palremitOrchestrator: { provisionedAccountId: 'prov-1' } },
};

describe('advanceOnrampIfFiatProcessed', () => {
  it('sets CRYPTO_PENDING (not CRYPTO_FAILED) when Palremit withdrawal API returns null', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampById = vi
      .fn()
      .mockResolvedValueOnce({ ...baseRow, status: 'FIAT_PROCESSED' })
      .mockResolvedValue({ ...baseRow, status: 'CRYPTO_INITIATED' });

    await advanceOnrampIfFiatProcessed(
      { findOnrampById, updateOnrampStatus },
      'onramp-1',
      async () => null
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith('onramp-1', 'CRYPTO_INITIATED');
    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'onramp-1',
      'CRYPTO_PENDING',
      expect.objectContaining({
        failedReason: null,
        receipt: expect.objectContaining({ awaitingWebhookConfirmation: true }),
        providerRefs: expect.objectContaining({
          palremitOrchestrator: expect.objectContaining({ withdrawalInitiationFailed: true }),
        }),
      })
    );
    expect(updateOnrampStatus).not.toHaveBeenCalledWith('onramp-1', 'CRYPTO_FAILED', expect.anything());
  });

  it('stores withdrawal id and clears failedReason when Palremit withdrawal API succeeds', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampById = vi
      .fn()
      .mockResolvedValueOnce({ ...baseRow, status: 'FIAT_PROCESSED' })
      .mockResolvedValue({ ...baseRow, status: 'CRYPTO_INITIATED' });

    await advanceOnrampIfFiatProcessed(
      { findOnrampById, updateOnrampStatus },
      'onramp-1',
      async () => ({
        withdrawalId: 'wd-99',
        rawWithdrawalRequest: { client_reference: 'ON-abc123' },
        rawWithdrawalResponse: { data: { id: 'wd-99' } },
      })
    );

    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'onramp-1',
      'CRYPTO_PENDING',
      expect.objectContaining({
        failedReason: null,
        receipt: expect.objectContaining({
          palremitWithdrawalId: 'wd-99',
          awaitingWebhookConfirmation: true,
        }),
      })
    );
  });
});
