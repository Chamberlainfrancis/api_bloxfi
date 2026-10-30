import { describe, it, expect, vi } from 'vitest';
import {
  OfframpLinkError,
  resolveOfframpLink,
  type LinkableOfframp,
  type OfframpLinkDeps,
  type OfframpLinkInput,
} from '@/core/fiatToFiat/offrampLink';

const NOW = new Date('2026-10-30T14:23:10Z');
const ADDRESS = 'TA4pjXofzbEKH3vzCyjtxAponCaSV2Piu1';
const REF = 'OFF-184dbea0aeb86b5b605ba95a';

function offramp(over: Partial<LinkableOfframp> = {}): LinkableOfframp {
  return {
    id: 'off-1',
    userId: 'biz-1',
    txnRef: REF,
    status: 'AWAITING_CRYPTO',
    source: { amount: 48.190932, currency: 'usdt', chain: 'TRC20' },
    depositInstructions: {
      amount: '48.190932',
      address: ADDRESS,
      network: 'TRC20',
      currency: 'USDT',
      depositBy: '2026-10-31T16:22:54.598Z',
    },
    rateInformation: { flow: 'FIAT_TO_FIAT' },
    timeline: {},
    ...over,
  };
}

function input(over: Partial<OfframpLinkInput> = {}): OfframpLinkInput {
  return {
    offrampId: REF,
    userId: 'biz-1',
    quote: { flow: 'FIAT_TO_FIAT', toCurrency: 'usdt', destinationChain: 'TRC20', receiveNet: 48.190932 },
    ...over,
  };
}

function deps(off: LinkableOfframp | null = offramp(), live: Array<{ txnRef: string | null }> = []): OfframpLinkDeps {
  return {
    findOfframpByTxnRef: vi.fn().mockResolvedValue(off),
    findLiveOnrampsForOfframp: vi.fn().mockResolvedValue(live),
    now: () => NOW,
  };
}

async function expectLinkError(p: Promise<unknown>, code: string, message: string | RegExp) {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(OfframpLinkError);
  expect((err as OfframpLinkError).code).toBe(code);
  if (typeof message === 'string') expect((err as Error).message).toBe(message);
  else expect((err as Error).message).toMatch(message);
}

describe('resolveOfframpLink', () => {
  it("returns the offramp's deposit address as the crypto destination", async () => {
    const d = deps();
    await expect(resolveOfframpLink(d, input())).resolves.toEqual({ offrampId: REF, address: ADDRESS, memo: null });
    expect(d.findLiveOnrampsForOfframp).toHaveBeenCalledWith(REF, ADDRESS);
  });

  it('carries the deposit memo through', async () => {
    const off = offramp({ depositInstructions: { ...(offramp().depositInstructions as object), memo: '42' } });
    await expect(resolveOfframpLink(deps(off), input())).resolves.toMatchObject({ memo: '42' });
  });

  it('accepts a matching externalWalletId address (transition period)', async () => {
    await expect(resolveOfframpLink(deps(), input({ walletAddress: ADDRESS }))).resolves.toMatchObject({ address: ADDRESS });
  });

  it('rejects an unknown offramp', async () => {
    await expectLinkError(
      resolveOfframpLink(deps(null), input()),
      'NOT_FOUND',
      'destination.offrampId does not match an offramp for this business'
    );
  });

  it("rejects another business's offramp as not found", async () => {
    await expectLinkError(resolveOfframpLink(deps(offramp({ userId: 'biz-2' })), input()), 'NOT_FOUND', /does not match/);
  });

  it.each([
    ['no quote', input({ quote: null }), offramp()],
    ['onramp quote not fiat-to-fiat', input({ quote: { ...input().quote!, flow: undefined } }), offramp()],
    ['offramp not fiat-to-fiat', input(), offramp({ rateInformation: {} })],
  ])('rejects outside the fiat-to-fiat flow: %s', async (_label, inp, off) => {
    await expectLinkError(
      resolveOfframpLink(deps(off), inp),
      'INVALID_REQUEST',
      'destination.offrampId is only allowed in the fiat-to-fiat flow'
    );
  });

  it.each([
    ['already funded', offramp({ status: 'CRYPTO_CONFIRMED' })],
    ['completed', offramp({ status: 'COMPLETED' })],
    ['expired', offramp({ status: 'EXPIRED' })],
    ['partly received', offramp({ timeline: { cryptoReceivedAmount: 5 } })],
    [
      'deposit window closed',
      offramp({ depositInstructions: { ...(offramp().depositInstructions as object), depositBy: '2026-10-30T14:00:00Z' } }),
    ],
  ])('rejects an offramp that is not awaiting crypto: %s', async (_label, off) => {
    await expectLinkError(resolveOfframpLink(deps(off), input()), 'INVALID_REQUEST', `offramp ${REF} is not awaiting crypto`);
  });

  it('rejects a different asset or chain', async () => {
    await expectLinkError(
      resolveOfframpLink(deps(), input({ quote: { ...input().quote!, destinationChain: 'BEP20' } })),
      'INVALID_REQUEST',
      `onramp pays USDT/BEP20 but offramp ${REF} expects USDT/TRC20`
    );
  });

  it('rejects an amount that differs by more than a cent', async () => {
    await expectLinkError(
      resolveOfframpLink(deps(), input({ quote: { ...input().quote!, receiveNet: 50 } })),
      'INVALID_REQUEST',
      'onramp amount 50 USDT does not match offramp deposit 48.190932 USDT'
    );
  });

  it('accepts a sub-cent difference', async () => {
    await expect(resolveOfframpLink(deps(), input({ quote: { ...input().quote!, receiveNet: 48.19 } }))).resolves.toBeTruthy();
  });

  it('rejects an externalWalletId that points somewhere else', async () => {
    await expectLinkError(
      resolveOfframpLink(deps(), input({ walletAddress: 'TOtherAddress' })),
      'INVALID_REQUEST',
      `destination.externalWalletId address is not the deposit address of ${REF}`
    );
  });

  it('rejects an offramp another live onramp already funds (two same-amount pairs cannot cross)', async () => {
    await expectLinkError(
      resolveOfframpLink(deps(offramp(), [{ txnRef: 'ON-other' }]), input()),
      'CONFLICT',
      `offramp ${REF} is already linked to ON-other`
    );
  });
});
