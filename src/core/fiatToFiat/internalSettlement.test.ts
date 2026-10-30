import { describe, it, expect, vi, afterEach } from 'vitest';
import { FIAT_TO_FIAT_CONFIG } from '@/config/fiatToFiat';
import {
  checkFiatToFiatPair,
  trySettleFiatToFiatInternally,
  type FiatToFiatSettlementDeps,
  type SettlementOfframp,
  type SettlementOnramp,
} from '@/core/fiatToFiat/internalSettlement';

const NOW = new Date('2026-10-30T14:25:50Z');
const ADDRESS = 'TA4pjXofzbEKH3vzCyjtxAponCaSV2Piu1';

// Shapes taken from ON-4b971078d973eea2be71dbfa / OFF-184dbea0aeb86b5b605ba95a.
function onramp(over: Partial<SettlementOnramp> = {}): SettlementOnramp {
  return {
    id: 'on-1',
    userId: 'biz-1',
    txnRef: 'ON-4b971078d973eea2be71dbfa',
    status: 'FIAT_PROCESSED',
    quoteInformation: { flow: 'FIAT_TO_FIAT', rate: '1376.4' },
    destination: { amount: 48.190932, currency: 'usdt', chain: 'TRC20', walletAddress: ADDRESS },
    providerRefs: { palremitOrchestrator: { provisionedAccountId: 'prov-on', depositStatus: 'credited' } },
    ...over,
  };
}

function offramp(over: Partial<SettlementOfframp> = {}): SettlementOfframp {
  return {
    id: 'off-1',
    userId: 'biz-1',
    txnRef: 'OFF-184dbea0aeb86b5b605ba95a',
    status: 'AWAITING_CRYPTO',
    source: { amount: 48.190932, currency: 'usdt', chain: 'TRC20' },
    depositInstructions: {
      amount: '48.190932',
      address: ADDRESS,
      network: 'TRC20',
      currency: 'USDT',
      depositBy: '2026-10-31T16:22:54.598Z',
    },
    rateInformation: { flow: 'FIAT_TO_FIAT', rate: '0.86667684610' },
    timeline: { createdAt: '2026-10-30T14:23:01.811Z' },
    providerRefs: { palremitOrchestrator: { provisionedAccountId: 'prov-off' } },
    ...over,
  };
}

function deps(over: Partial<FiatToFiatSettlementDeps> = {}): FiatToFiatSettlementDeps {
  return {
    findOpenOfframpsByDepositAddress: vi.fn().mockResolvedValue([offramp()]),
    claimOfframpCrypto: vi.fn().mockResolvedValue(true),
    updateOnrampStatus: vi.fn().mockResolvedValue({}),
    afterOnrampCompleted: vi.fn(),
    advanceOfframpPayout: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...over,
  };
}

describe('checkFiatToFiatPair', () => {
  it('pairs the onramp with the offramp whose deposit address it pays', () => {
    expect(checkFiatToFiatPair(onramp(), offramp(), NOW)).toEqual({ ok: true, amount: 48.190932 });
  });

  it.each([
    ['onramp_not_fiat_to_fiat', onramp({ quoteInformation: { rate: '1' } }), offramp()],
    ['offramp_not_fiat_to_fiat', onramp(), offramp({ rateInformation: { rate: '1' } })],
    ['different_business', onramp(), offramp({ userId: 'biz-2' })],
    ['offramp_not_awaiting_crypto', onramp(), offramp({ status: 'CRYPTO_CONFIRMED' })],
    ['offramp_already_received_crypto', onramp(), offramp({ timeline: { cryptoReceivedAmount: 10 } })],
    ['address_mismatch', onramp({ destination: { ...(onramp().destination as object), walletAddress: 'TOther' } }), offramp()],
    ['asset_mismatch', onramp({ destination: { ...(onramp().destination as object), currency: 'usdc' } }), offramp()],
    ['network_mismatch', onramp({ destination: { ...(onramp().destination as object), chain: 'BEP20' } }), offramp()],
    ['memo_mismatch', onramp(), offramp({ depositInstructions: { ...(offramp().depositInstructions as object), memo: '123' } })],
    [
      'offramp_deposit_window_closed',
      onramp(),
      offramp({ depositInstructions: { ...(offramp().depositInstructions as object), depositBy: '2026-10-30T14:00:00Z' } }),
    ],
    ['amount_mismatch', onramp({ destination: { ...(onramp().destination as object), amount: 48.5 } }), offramp()],
  ])('refuses: %s', (reason, on, off) => {
    expect(checkFiatToFiatPair(on, off, NOW)).toEqual({ ok: false, reason });
  });

  it('accepts a sub-cent difference (deposit credited at 2dp)', () => {
    const on = onramp({ destination: { ...(onramp().destination as object), amount: 48.1909 } });
    expect(checkFiatToFiatPair(on, offramp(), NOW).ok).toBe(true);
  });

  it('compares EVM addresses case-insensitively but Tron exactly', () => {
    const evm = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
    const on = onramp({ destination: { amount: 10, currency: 'usdt', chain: 'BEP20', walletAddress: evm.toLowerCase() } });
    const off = offramp({
      source: { amount: 10 },
      depositInstructions: { amount: '10', address: evm, network: 'BEP20', currency: 'USDT', depositBy: '2026-10-31T00:00:00Z' },
    });
    expect(checkFiatToFiatPair(on, off, NOW).ok).toBe(true);

    const tron = onramp({ destination: { ...(onramp().destination as object), walletAddress: ADDRESS.toLowerCase() } });
    expect(checkFiatToFiatPair(tron, offramp(), NOW)).toEqual({ ok: false, reason: 'address_mismatch' });
  });
});

describe('trySettleFiatToFiatInternally', () => {
  afterEach(() => {
    FIAT_TO_FIAT_CONFIG.internalSettlement = true;
  });

  it('funds the offramp, completes the onramp and starts the offramp payout', async () => {
    const d = deps();
    await expect(trySettleFiatToFiatInternally(d, onramp())).resolves.toBe(true);

    expect(d.findOpenOfframpsByDepositAddress).toHaveBeenCalledWith('biz-1', ADDRESS);
    expect(d.claimOfframpCrypto).toHaveBeenCalledWith(
      'off-1',
      ['AWAITING_CRYPTO', 'CRYPTO_PENDING'],
      expect.objectContaining({
        timeline: expect.objectContaining({
          cryptoReceivedAmount: 48.190932,
          cryptoExpectedAmount: 48.190932,
          cryptoConfirmedAt: NOW.toISOString(),
          fiatToFiatSettlement: expect.objectContaining({ method: 'internal', onrampTxnRef: 'ON-4b971078d973eea2be71dbfa' }),
        }),
        providerRefs: expect.objectContaining({
          palremitOrchestrator: expect.objectContaining({ provisionedAccountId: 'prov-off', depositStatus: 'credited' }),
        }),
      })
    );
    expect(d.updateOnrampStatus).toHaveBeenCalledWith(
      'on-1',
      'COMPLETED',
      expect.objectContaining({
        receipt: expect.objectContaining({
          provider: 'internal',
          awaitingWebhookConfirmation: false,
          fiatToFiatSettlement: expect.objectContaining({ offrampTxnRef: 'OFF-184dbea0aeb86b5b605ba95a', amount: 48.190932 }),
        }),
        providerRefs: expect.objectContaining({
          palremitOrchestrator: expect.objectContaining({ provisionedAccountId: 'prov-on', withdrawalStatus: 'settled_internally' }),
        }),
      })
    );
    expect(d.afterOnrampCompleted).toHaveBeenCalledWith('on-1');
    expect(d.advanceOfframpPayout).toHaveBeenCalledWith('off-1');
  });

  it('claims the offramp before completing the onramp', async () => {
    const order: string[] = [];
    const d = deps({
      claimOfframpCrypto: vi.fn(async () => {
        order.push('claim');
        return true;
      }),
      updateOnrampStatus: vi.fn(async () => {
        order.push('onramp');
        return {};
      }),
      advanceOfframpPayout: vi.fn(async () => {
        order.push('payout');
      }),
    });
    await trySettleFiatToFiatInternally(d, onramp());
    expect(order).toEqual(['claim', 'onramp', 'payout']);
  });

  it('falls back to the on-chain send when another writer claimed the offramp first', async () => {
    const d = deps({ claimOfframpCrypto: vi.fn().mockResolvedValue(false) });
    await expect(trySettleFiatToFiatInternally(d, onramp())).resolves.toBe(false);
    expect(d.updateOnrampStatus).not.toHaveBeenCalled();
    expect(d.advanceOfframpPayout).not.toHaveBeenCalled();
  });

  it('falls back when no open offramp matches', async () => {
    const d = deps({ findOpenOfframpsByDepositAddress: vi.fn().mockResolvedValue([offramp({ userId: 'biz-2' })]) });
    await expect(trySettleFiatToFiatInternally(d, onramp())).resolves.toBe(false);
    expect(d.claimOfframpCrypto).not.toHaveBeenCalled();
  });

  it('refuses to guess when two open offramps share the deposit address', async () => {
    const d = deps({
      findOpenOfframpsByDepositAddress: vi
        .fn()
        .mockResolvedValue([offramp(), offramp({ id: 'off-2', txnRef: 'OFF-second' })]),
    });
    await expect(trySettleFiatToFiatInternally(d, onramp())).resolves.toBe(false);
    expect(d.claimOfframpCrypto).not.toHaveBeenCalled();
  });

  it('skips plain crypto onramps without looking anything up', async () => {
    const d = deps();
    await expect(trySettleFiatToFiatInternally(d, onramp({ quoteInformation: {} }))).resolves.toBe(false);
    expect(d.findOpenOfframpsByDepositAddress).not.toHaveBeenCalled();
  });

  it('only acts on FIAT_PROCESSED onramps', async () => {
    const d = deps();
    await expect(trySettleFiatToFiatInternally(d, onramp({ status: 'CRYPTO_PENDING' }))).resolves.toBe(false);
    expect(d.findOpenOfframpsByDepositAddress).not.toHaveBeenCalled();
  });

  it('does nothing when the kill switch is off', async () => {
    FIAT_TO_FIAT_CONFIG.internalSettlement = false;
    const d = deps();
    await expect(trySettleFiatToFiatInternally(d, onramp())).resolves.toBe(false);
    expect(d.findOpenOfframpsByDepositAddress).not.toHaveBeenCalled();
  });

  it('still reports settled when the offramp payout start throws (payout retried by its own paths)', async () => {
    const d = deps({ advanceOfframpPayout: vi.fn().mockRejectedValue(new Error('LP down')) });
    await expect(trySettleFiatToFiatInternally(d, onramp())).resolves.toBe(true);
    expect(d.updateOnrampStatus).toHaveBeenCalledWith('on-1', 'COMPLETED', expect.anything());
  });
});
