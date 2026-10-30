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
  fees: {
    platformFee: {
      type: 'FLAT',
      value: '0.5',
      amount: '0.5',
      currency: 'usdt',
      walletAddress: '0xFee',
    },
  },
  developerFee: null,
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

  it('skips the on-chain send when the fiat-to-fiat leg settles internally', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampById = vi.fn().mockResolvedValue({ ...baseRow, status: 'FIAT_PROCESSED', quoteInformation: { flow: 'FIAT_TO_FIAT' } });
    const execute = vi.fn();
    const settle = vi.fn().mockResolvedValue(true);

    await advanceOnrampIfFiatProcessed({ findOnrampById, updateOnrampStatus }, 'onramp-1', execute, settle);

    expect(settle).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'onramp-1', status: 'FIAT_PROCESSED', quoteInformation: { flow: 'FIAT_TO_FIAT' } })
    );
    expect(execute).not.toHaveBeenCalled();
    expect(updateOnrampStatus).not.toHaveBeenCalled();
  });

  it('sends on-chain as before when internal settlement declines', async () => {
    const updateOnrampStatus = vi.fn().mockResolvedValue({});
    const findOnrampById = vi.fn().mockResolvedValue({ ...baseRow, status: 'FIAT_PROCESSED' });
    const execute = vi.fn().mockResolvedValue({ withdrawalId: 'w-1', rawWithdrawalRequest: {}, rawWithdrawalResponse: {} });
    const settle = vi.fn().mockResolvedValue(false);

    await advanceOnrampIfFiatProcessed({ findOnrampById, updateOnrampStatus }, 'onramp-1', execute, settle);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(updateOnrampStatus).toHaveBeenCalledWith('onramp-1', 'CRYPTO_INITIATED');
  });
});
