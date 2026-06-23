# Offramp Quote-First + Source-Currency Platform Fee — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make offramp creation quote-first only, and denominate the offramp platform fee in the source crypto (`fromCurrency`) so settlement to USDC no longer round-trips through a phantom destination-fiat amount.

**Architecture:** Removing the direct (quoteless) create path deletes the second, inconsistent fee-computation branch, leaving the quote builder (`computeOfframpQuoteAmounts` + `createOfframpQuote`) as the single source of truth for offramp fees. The fee fix then lives in exactly one place. Settlement code is unchanged — it already converts `fees.platformFee.currency → settlementCurrency` with a same-currency no-op.

**Tech Stack:** TypeScript, Vitest, Zod, Express. Path alias `@/` → `src/`. Run tests with `npx vitest run <path>`.

## Global Constraints

- Platform fee denomination currency = `fromCurrency` (source crypto). Settlement currency = `platformFee.currency` field, default `USDC` (unchanged).
- Platform fee base = **gross source crypto** (`sendAmount`), applied **before** the transfer fee.
- Crypto amounts format to 8 decimal places; fiat amounts to 2.
- `POST /offramps` requires a `quoteId`. No direct/quoteless create path remains.
- Onramp is out of scope and must not change.
- Follow existing file/test conventions; do not restructure unrelated code.

Reference spec: `OFFRAMP_PLATFORM_FEE_SOURCE_CURRENCY.md`.

---

### Task 1: Platform fee on source crypto in the quote math

**Files:**
- Modify: `src/core/quotes/computeOfframpQuoteAmounts.ts`
- Test: `src/core/quotes/computeOfframpQuoteAmounts.test.ts`

**Interfaces:**
- Consumes: `applyOfframpPlatformFee(grossAmount: number, fee: PlatformFee)` from `@/core/payments/applyOfframpPlatformFee` (returns `{ feeAmount, netAmount, grossAmount }`).
- Produces: `computeOfframpQuoteAmounts({ sendAmount, baseConversionRate, feeInSendCurrency, platformFee }) → OfframpQuoteAmounts` where `platformFeeAmount` is now in **source crypto**, `sendNet = sendAmount − platformFeeCrypto − transferFeeInSend`, `receiveNet = sendNet × rate`, `baseReceiveNet = (sendAmount − transferFeeInSend) × rate` (fiat, no platform fee).

- [ ] **Step 1: Replace the existing test with source-currency expectations**

Overwrite `src/core/quotes/computeOfframpQuoteAmounts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeOfframpQuoteAmounts } from '@/core/quotes/computeOfframpQuoteAmounts';
import type { PlatformFee } from '@/types/offramp';

const platformFeeOnePct: PlatformFee = {
  type: 'PERCENTAGE',
  value: 0.01,
  walletAddress: '0xFee',
};

describe('computeOfframpQuoteAmounts', () => {
  it('takes the platform fee from the source crypto (gross), before the transfer fee', () => {
    const amounts = computeOfframpQuoteAmounts({
      sendAmount: 1000,
      baseConversionRate: 0.9984,
      feeInSendCurrency: 19.6068404,
      platformFee: platformFeeOnePct,
    });
    // platform fee = 1% of 1000 = 10 (USDT, source crypto)
    expect(amounts.platformFeeAmount).toBeCloseTo(10, 8);
    // sendNet = 1000 - 10 - 19.6068404 = 970.3931596 (source crypto)
    expect(amounts.sendNet).toBeCloseTo(970.3931596, 6);
    // receiveNet = sendNet * 0.9984
    expect(amounts.receiveNet).toBeCloseTo(968.840730, 4);
    // baseReceiveNet = (1000 - 19.6068404) * 0.9984 (no platform fee)
    expect(amounts.baseReceiveNet).toBeCloseTo(978.823730, 4);
    expect(amounts.allInConversionRate).toBeCloseTo(0.968840730, 8);
  });

  it('treats a null transfer fee as zero (fail-soft) and still deducts the platform fee', () => {
    const amounts = computeOfframpQuoteAmounts({
      sendAmount: 100,
      baseConversionRate: 1500,
      feeInSendCurrency: null,
      platformFee: platformFeeOnePct,
    });
    expect(amounts.platformFeeAmount).toBeCloseTo(1, 8); // 1% of 100
    expect(amounts.sendNet).toBeCloseTo(99, 8);
    expect(amounts.receiveNet).toBeCloseTo(148500, 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/quotes/computeOfframpQuoteAmounts.test.ts`
Expected: FAIL (`platformFeeAmount` currently equals 1% of the fiat receive, not 10).

- [ ] **Step 3: Rewrite the implementation**

Replace the body of `computeOfframpQuoteAmounts` in `src/core/quotes/computeOfframpQuoteAmounts.ts`. Update the header comment and the function:

```ts
/**
 * Offramp quote math: platform fee on the SOURCE crypto (gross), then the
 * provider transfer fee on the send side, then LP conversion to fiat.
 */

import type { PlatformFee } from '@/types/offramp';
import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';

export interface OfframpQuoteAmounts {
  sendGross: number;
  sendNet: number;
  receiveGross: number;
  baseReceiveNet: number;
  receiveNet: number;
  transferFeeInSend: number;
  platformFeeAmount: number;
  baseConversionRate: number;
  allInConversionRate: number;
}

export function computeOfframpQuoteAmounts(params: {
  sendAmount: number;
  baseConversionRate: number;
  feeInSendCurrency: number | null;
  platformFee: PlatformFee;
}): OfframpQuoteAmounts {
  const { sendAmount, baseConversionRate, platformFee } = params;
  const receiveGross = sendAmount * baseConversionRate;

  // Platform fee is retained from the source crypto (the only asset we custody
  // on an offramp), taken from the gross send before the transfer fee.
  const applied = applyOfframpPlatformFee(sendAmount, platformFee);
  const platformFeeAmount = applied.feeAmount;

  const usable =
    params.feeInSendCurrency != null && Number.isFinite(params.feeInSendCurrency);
  const transferFeeInSend =
    usable && params.feeInSendCurrency! > 0 ? params.feeInSendCurrency! : 0;

  const sendNet = Math.max(0, sendAmount - platformFeeAmount - transferFeeInSend);
  // Fiat the recipient would get with the transfer fee but WITHOUT the platform
  // markup — surfaced for transparency (see types/offramp.ts baseReceiveNet).
  const baseReceiveNet = Math.max(0, sendAmount - transferFeeInSend) * baseConversionRate;
  const receiveNet = sendNet * baseConversionRate;
  const allInConversionRate = sendAmount > 0 ? receiveNet / sendAmount : 0;

  return {
    sendGross: sendAmount,
    sendNet,
    receiveGross,
    baseReceiveNet,
    receiveNet,
    transferFeeInSend,
    platformFeeAmount,
    baseConversionRate,
    allInConversionRate,
  };
}

export function formatOfframpConversionRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0';
  return rate.toFixed(11);
}

export function formatOfframpInverseRate(conversionRate: number): string {
  if (!Number.isFinite(conversionRate) || conversionRate <= 0) return '0';
  return (1 / conversionRate).toFixed(6);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/quotes/computeOfframpQuoteAmounts.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/quotes/computeOfframpQuoteAmounts.ts src/core/quotes/computeOfframpQuoteAmounts.test.ts
git commit -m "fix(offramp): compute platform fee on source crypto in quote math"
```

---

### Task 2: Record the platform fee in source currency in the quote builder

**Files:**
- Modify: `src/core/quotes/createOfframpQuote.ts`
- Test: Create `src/core/quotes/createOfframpQuote.test.ts`

**Interfaces:**
- Consumes: `computeOfframpQuoteAmounts` (Task 1); `applyOfframpPlatformFee`; `resolveTransferFeeInSendCurrency`.
- Produces: a snapshot whose `fees.platformFee.currency === fromCurrency`, `fees.platformFee.amount` at 8dp, `fees.platformFee.settlementCurrency` unchanged; provider fee quoted on the post-platform-fee fiat basis.

- [ ] **Step 1: Write the failing test**

Create `src/core/quotes/createOfframpQuote.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createOfframpQuote } from '@/core/quotes/createOfframpQuote';
import type { GetOfframpRatesResponse } from '@/types/offramp';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';

vi.mock('@/db/repositories/rampQuote.repo', () => ({
  createRampQuote: vi.fn(async ({ payload }) => ({
    id: 'q_1',
    expiresAt: new Date('2026-06-23T01:00:00Z'),
    payload,
  })),
}));

function rateResponse(conversionRate: string): GetOfframpRatesResponse {
  return {
    fromCurrency: 'usdt',
    toCurrency: 'eur',
    conversionRate,
    inverseRate: String(1 / (parseFloat(conversionRate) || 1)),
    rateValidUntil: new Date('2026-06-23T00:30:00Z').toISOString(),
    minimumAmount: '10',
    maximumAmount: '100000',
    estimatedProcessingTime: '1-3 business days',
    availableRails: [],
  } as unknown as GetOfframpRatesResponse;
}

function makeOptions() {
  return {
    getRateFromPalremit: vi.fn(async () => rateResponse('0.85')),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    getProviderWithdrawalFeeQuote: vi.fn(async () => null),
  };
}

describe('createOfframpQuote', () => {
  it('denominates the platform fee in the source crypto (fromCurrency) at crypto precision', async () => {
    await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'DE', destinationType: 'local_bank' },
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
      },
      makeOptions()
    );

    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls[0][0].payload as {
      fees: { platformFee: { currency: string; amount: string; settlementCurrency: string } };
      quote: { platformFee?: { currency?: string; amount: string } };
    };

    expect(snapshot.fees.platformFee.currency).toBe('usdt');     // source crypto
    expect(snapshot.fees.platformFee.amount).toBe('10.00000000'); // 1% of 1000, 8dp
    expect(snapshot.fees.platformFee.settlementCurrency).toBe('USDC');
    expect(snapshot.quote.platformFee?.currency).toBe('usdt');
    expect(snapshot.quote.platformFee?.amount).toBe('10.00000000');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/quotes/createOfframpQuote.test.ts`
Expected: FAIL (`fees.platformFee.currency` is currently `eur`; amount is `.toFixed(2)`).

- [ ] **Step 3: Implement the changes**

In `src/core/quotes/createOfframpQuote.ts`, inside `createOfframpQuote`, replace the block from `const grossReceive = …` down through the `fees` object. Add the `applyOfframpPlatformFee` import at the top alongside the existing imports:

```ts
import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';
```

Replace the pricing block:

```ts
  const grossReceive = input.amount * baseRateNum;

  // Platform fee is taken from the source crypto (gross). The provider fee is
  // quoted on the fiat that remains AFTER the platform fee, matching the math.
  const platformApplied = applyOfframpPlatformFee(input.amount, input.platformFee);
  const afterPlatformFiat = platformApplied.netAmount * baseRateNum;

  const feeQuote = await options.getProviderWithdrawalFeeQuote({
    asset: toCurrency,
    amount: afterPlatformFiat,
    destinationType: input.corridor.destinationType,
    country: input.corridor.country,
    beneficiaryType: input.corridor.beneficiaryType ?? undefined,
  });

  const feeInSendCurrency = await resolveTransferFeeInSendCurrency({
    feeQuote,
    sendCurrency: fromCurrency,
    getRate: (from, to, chain) => options.getRateFromPalremit(from, to, chain),
  });

  const amounts = computeOfframpQuoteAmounts({
    sendAmount: input.amount,
    baseConversionRate: baseRateNum,
    feeInSendCurrency,
    platformFee: input.platformFee,
  });

  if (amounts.sendNet <= 0) {
    throw new Error('AMOUNT_TOO_LOW_AFTER_FEES');
  }

  const usable =
    feeInSendCurrency != null && Number.isFinite(feeInSendCurrency);

  const quote: RampFeePreview = {
    sendGross: { amount: String(input.amount), currency: fromCurrency },
    sendNet: { amount: amounts.sendNet.toFixed(8), currency: fromCurrency },
    receiveGross: { amount: amounts.receiveGross.toFixed(2), currency: toCurrency },
    baseReceiveNet: { amount: amounts.baseReceiveNet.toFixed(2), currency: toCurrency },
    receiveNet: { amount: amounts.receiveNet.toFixed(2), currency: toCurrency },
    platformFee: {
      type: input.platformFee.type,
      value: input.platformFee.value,
      walletAddress: input.platformFee.walletAddress,
      currency: fromCurrency,
      ...(input.platformFee.network?.trim() ? { network: input.platformFee.network.trim() } : {}),
      amount: amounts.platformFeeAmount.toFixed(8),
    },
    transferFee: {
      fees: feeQuote?.fees ?? [],
      total: feeQuote?.totalFee ?? null,
      unavailable: !usable,
    },
  };

  const allInRate = formatOfframpConversionRate(amounts.allInConversionRate);
  const expiresAt = parseQuoteExpiry(rateResponse.rateValidUntil);

  const rateInformation: RateInformation = {
    rate: allInRate,
    conversionRate: allInRate,
    inverseRate: formatOfframpInverseRate(amounts.allInConversionRate),
    fromCurrency,
    toCurrency,
    fromChain: resolvedChain,
    expiresAt: expiresAt.toISOString(),
  };

  const fees: OfframpFees = {
    platformFee: {
      type: input.platformFee.type,
      value: String(input.platformFee.value),
      amount: amounts.platformFeeAmount.toFixed(8),
      currency: fromCurrency,
      walletAddress: input.platformFee.walletAddress,
      settlementCurrency: input.platformFee.currency?.trim().toUpperCase() || 'USDC',
      ...(input.platformFee.network?.trim()
        ? { settlementNetwork: input.platformFee.network.trim() }
        : {}),
    },
    transferFee: quote.transferFee,
  };
```

Note: this removes the old standalone `AMOUNT_TOO_LOW_AFTER_FEES` guard that compared `feeInSendCurrency >= input.amount` — the new `amounts.sendNet <= 0` check supersedes it (it accounts for both the platform fee and the transfer fee). Delete the old guard block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/quotes/createOfframpQuote.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/quotes/createOfframpQuote.ts src/core/quotes/createOfframpQuote.test.ts
git commit -m "fix(offramp): record platform fee in source currency in quote builder"
```

---

### Task 3: Require `quoteId` in the offramp create schema

**Files:**
- Modify: `src/api/v1/offramps/schemas.ts:70-155` (the `superRefine` in `createOfframpBodySchema`)
- Test: `src/api/v1/offramps/schemas.test.ts`

**Interfaces:**
- Produces: `createOfframpBodySchema` rejects any payload without `quoteId`, and rejects `platformFee` / direct `source.amount|currency|chain` / `destination.amount|currency` whenever present.

- [ ] **Step 1: Write the failing tests**

Append to `src/api/v1/offramps/schemas.test.ts` (import `createOfframpBodySchema` if not already imported at the top of the file):

```ts
import { createOfframpBodySchema } from '@/api/v1/offramps/schemas';

describe('createOfframpBodySchema — quote-first only', () => {
  const base = {
    requestId: '11111111-1111-1111-1111-111111111111',
    source: {
      userId: '22222222-2222-2222-2222-222222222222',
      externalWalletId: '33333333-3333-3333-3333-333333333333',
    },
    destination: {
      userId: '22222222-2222-2222-2222-222222222222',
      accountId: '44444444-4444-4444-4444-444444444444',
      purposeOfPayment: 'family_support',
    },
  };

  it('rejects a create without quoteId', () => {
    const r = createOfframpBodySchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('accepts a create with quoteId and identity fields', () => {
    const r = createOfframpBodySchema.safeParse({
      ...base,
      quoteId: '55555555-5555-5555-5555-555555555555',
    });
    expect(r.success).toBe(true);
  });

  it('rejects platformFee when quoteId is present', () => {
    const r = createOfframpBodySchema.safeParse({
      ...base,
      quoteId: '55555555-5555-5555-5555-555555555555',
      platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' },
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/api/v1/offramps/schemas.test.ts`
Expected: FAIL (a quoteless create currently succeeds).

- [ ] **Step 3: Update the schema**

In `src/api/v1/offramps/schemas.ts`, replace the `.superRefine((val, ctx) => { … })` body for `createOfframpBodySchema` so the quote branch is mandatory. Keep the identity-field checks and the USD metadata block; remove the direct-create `else` branch:

```ts
  .superRefine((val, ctx) => {
    if (!val.requestId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestId'], message: 'requestId is required' });
    }
    if (!val.quoteId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['quoteId'], message: 'quoteId is required (quote-first offramp)' });
    }
    if (!val.source.userId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'userId'], message: 'source.userId is required' });
    }
    if (!val.source.externalWalletId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['source', 'externalWalletId'],
        message: 'source.externalWalletId is required',
      });
    }
    if (!val.destination.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'userId'],
        message: 'destination.userId is required',
      });
    }
    if (!val.destination.accountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['destination', 'accountId'],
        message: 'destination.accountId is required',
      });
    }

    if (val.platformFee) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['platformFee'],
        message: 'platformFee must be omitted; it is fixed by the quote',
      });
    }
    for (const field of ['amount', 'currency', 'chain'] as const) {
      const v = val.source[field];
      if (v != null && v !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['source', field],
          message: `source.${field} must be omitted; it is fixed by the quote`,
        });
      }
    }
    for (const field of ['currency', 'amount'] as const) {
      const v = val.destination[field];
      if (v != null && v !== '') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['destination', field],
          message: `destination.${field} must be omitted; it is fixed by the quote`,
        });
      }
    }

    const destCcy = (val.destination.currency ?? '').trim().toUpperCase();
    if (destCcy === 'USD') {
      const pp = usdPalremitTransferPurposeSchema.safeParse(val.destination.purposeOfPayment.trim());
      if (!pp.success) {
        for (const e of pp.error.errors) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: e.message,
            path: ['destination', 'purposeOfPayment'],
          });
        }
      }

      const m = val.metadata;
      if (m == null || typeof m !== 'object' || Array.isArray(m)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadata'],
          message: 'metadata is required for USD offramp (isSelfTransfer)',
        });
        return;
      }
      const mp = usdOfframpOptionalMetadataSchema.safeParse(m);
      if (!mp.success) {
        for (const e of mp.error.errors) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: e.message,
            path: ['metadata', ...e.path],
          });
        }
      }
    }
  });
```

Note: the USD `destination.currency` check stays harmless — when quote-first the client omits `destination.currency`, so `destCcy` is `''` and the USD block is skipped. The USD purpose/metadata validation for USD corridors is enforced again at the controller against `snapshot.toCurrency` (existing `validateUsdOfframpMetadata` call).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/api/v1/offramps/schemas.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/v1/offramps/schemas.ts src/api/v1/offramps/schemas.test.ts
git commit -m "feat(offramp): require quoteId on create (quote-first only)"
```

---

### Task 4: Remove the direct branch from the create controller

**Files:**
- Modify: `src/api/v1/offramps/controllers.ts:273-300` (the `else` branch and the options passed to `offrampCore.createOfframp`)

**Interfaces:**
- Consumes: `offrampCore.createOfframp(..., { lockedQuote, resolvePalremitNetwork, createPalremitDeposit })` — note `getRateFromPalremit` and `getProviderWithdrawalFeeQuote` are dropped (Task 5 removes them from the core signature).

- [ ] **Step 1: Delete the direct `else` branch**

In `src/api/v1/offramps/controllers.ts`, the `quoteId` is now always present (Task 3). Remove the `else { body = { …direct… } }` branch so the handler always hydrates from the snapshot. The code immediately before `const result = await offrampCore.createOfframp(` should end with the `quoteId` block closing brace — delete:

```ts
    } else {
      body = {
        source: parsed.data.source as CreateOfframpSourceInput,
        destination: parsed.data.destination as CreateOfframpDestinationInput,
        platformFee: parsed.data.platformFee!,
        metadata: parsed.data.metadata,
      };
    }
```

If `parsed.data.quoteId` was guarded by `if (parsed.data.quoteId) { … }`, keep the block contents but the `if` is now always true; you may leave the `if` as a defensive guard or unwrap it — leaving it is fine.

- [ ] **Step 2: Drop the now-unused options**

In the `offrampCore.createOfframp(...)` call, remove the `getRateFromPalremit` and `getProviderWithdrawalFeeQuote` options (they are only used by the deleted direct path). The options object becomes:

```ts
      {
        resolvePalremitNetwork: (coinCode, chainFromClient, field) =>
          resolvePalremitNetworkOrThrow(palremitLiquidity, coinCode, chainFromClient, field),
        createPalremitDeposit: (userCtx, b, rid, depositBy, txnRef) =>
          createOfframpPalremitCryptoDeposit(palremitLiquidity, userCtx, b, rid, depositBy, txnRef),
        ...(lockedQuote ? { lockedQuote } : {}),
      }
```

Remove any now-unused imports flagged by the compiler (e.g. `CreateOfframpSourceInput` / `CreateOfframpDestinationInput` if no longer referenced; `fetchPalremitWithdrawalFeeQuote`, `getRateFromPalremit` helper) — let the build in Step 3 tell you.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (fix any unused-import errors surfaced).

- [ ] **Step 4: Commit**

```bash
git add src/api/v1/offramps/controllers.ts
git commit -m "refactor(offramp): drop direct create branch in controller"
```

---

### Task 5: Make `lockedQuote` required in the core and delete the direct path

**Files:**
- Modify: `src/core/offramps/createOfframp.ts` (options interface lines 28-72; derivation lines 194-203; the non-locked `else` branch lines ~246-328)
- Test: `src/core/offramps/createOfframp.test.ts` (rewrite for quote-only)

**Interfaces:**
- Consumes: `OfframpQuoteSnapshot` (from `@/types/quote`) as the required `lockedQuote`.
- Produces: `createOfframp` reads all pricing (`cryptoAmount`, `fiatNet`, `rate`, `inverseRate`, `rateInformation`, `fees`, `depositBy`) from `lockedQuote`; throws `QUOTE_REQUIRED` if absent. `getRateFromPalremit` and `getProviderWithdrawalFeeQuote` removed from `CreateOfframpOptions`.

- [ ] **Step 1: Rewrite the test for quote-only**

Overwrite `src/core/offramps/createOfframp.test.ts`. Keep the `makeDeps`-style repo mocks but drop `getRateFromPalremit`/`getProviderWithdrawalFeeQuote` from options and always pass a `lockedQuote`. Use this snapshot helper and tests:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createOfframp } from '@/core/offramps/createOfframp';
import type {
  OfframpRepoCreate,
  UserRepoForOfframp,
  AccountRepoForOfframp,
  WalletRepoForOfframp,
  KybRepoForOfframp,
  CreateOfframpOptions,
} from '@/core/offramps/createOfframp';
import type { CreateOfframpRequest } from '@/types/offramp';
import type { OfframpQuoteSnapshot } from '@/types/quote';

const VALID_PROVIDER_PAYOUT = {
  provider: 'palremit',
  schemaVersion: 2,
  corridor: { asset: 'NGN', country: 'NG', destinationType: 'local_bank', beneficiaryType: 'individual' },
  destination: { account_number: '0123456789', bank_code: '058' },
};

function snapshot(): OfframpQuoteSnapshot {
  return {
    version: 1,
    fromCurrency: 'usdt',
    toCurrency: 'ngn',
    fromChain: 'TRC20',
    clientFromChain: 'TRC20',
    sendAmount: 100,
    corridor: { country: 'NG', destinationType: 'local_bank', beneficiaryType: 'individual' },
    platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
    baseConversionRate: '1500',
    conversionRate: '1485.00000000000',
    inverseRate: '0.000673',
    rateValidUntil: new Date(Date.now() + 300000).toISOString(),
    destinationAmount: 148500,
    quote: {
      sendGross: { amount: '100', currency: 'usdt' },
      sendNet: { amount: '99.00000000', currency: 'usdt' },
      receiveGross: { amount: '150000.00', currency: 'ngn' },
      receiveNet: { amount: '148500.00', currency: 'ngn' },
      transferFee: { fees: [], total: null, unavailable: true },
    },
    fees: {
      platformFee: {
        type: 'PERCENTAGE',
        value: '0.01',
        amount: '1.00000000',
        currency: 'usdt',
        walletAddress: '0xFee',
        settlementCurrency: 'USDC',
        settlementNetwork: 'MATIC',
      },
      transferFee: { fees: [], total: null, unavailable: true },
    },
    rateInformation: {
      rate: '1485.00000000000',
      conversionRate: '1485.00000000000',
      inverseRate: '0.000673',
      fromCurrency: 'usdt',
      toCurrency: 'ngn',
      fromChain: 'TRC20',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
  };
}

function makeDeps() {
  const created: { data?: Parameters<OfframpRepoCreate['createOfframp']>[0] } = {};
  const offrampRepo: OfframpRepoCreate = {
    createOfframp: vi.fn(async (data) => {
      created.data = data;
      return {
        id: 'off_1', requestId: data.requestId, txnRef: data.txnRef, userId: data.userId,
        status: data.status, source: data.source, destination: data.destination,
        rateInformation: data.rateInformation, depositInstructions: data.depositInstructions ?? null,
        timeline: data.timeline ?? null, fees: data.fees ?? null, receipt: null,
        refundDetails: null, failedReason: null, lpReference: data.lpReference ?? null,
        createdAt: new Date('2026-06-11T00:00:00Z'), updatedAt: new Date('2026-06-11T00:00:00Z'),
      };
    }),
  };
  const userRepo: UserRepoForOfframp = {
    findUserById: vi.fn(async () => ({
      id: 'user_1', businessInfo: { email: 'biz@example.com', legalName: 'Acme Ltd' },
      legalRepresentative: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    })),
  };
  const accountRepo: AccountRepoForOfframp = {
    findOfframpAccountByIdAndUser: vi.fn(async () => ({
      id: 'acc_1', userId: 'user_1', currency: 'ngn', accountHolder: { name: 'Ada Lovelace' },
      providerPayout: VALID_PROVIDER_PAYOUT, paymentRail: 'local_bank', accountType: 'bank',
    })),
  };
  const walletRepo: WalletRepoForOfframp = {
    findExternalWalletByIdAndUser: vi.fn(async () => ({ id: 'wal_1', address: 'TXyz...', chain: 'TRC20', userId: 'user_1' })),
  };
  const kybRepo: KybRepoForOfframp = {
    getKybRailStatuses: vi.fn(async () => [{ rail: 'NGN', status: 'approved' }]),
  };
  const options: CreateOfframpOptions = {
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitDeposit: vi.fn(async () => ({
      depositInstructions: {
        address: 'TDeposit...', amount: '100', currency: 'USDT', network: 'TRC20',
        depositBy: new Date(Date.now() + 1e6).toISOString(), instruction: 'send',
      },
      correlationId: 'OFF-x', providerRefs: {},
    })),
    lockedQuote: snapshot(),
  };
  return { offrampRepo, userRepo, accountRepo, walletRepo, kybRepo, options, created };
}

function body(): Omit<CreateOfframpRequest, 'requestId'> {
  return {
    source: { userId: 'user_1', externalWalletId: 'wal_1', amount: 100, currency: 'usdt', chain: 'TRC20' },
    destination: { userId: 'user_1', accountId: 'acc_1', currency: 'ngn', amount: 148500, purposeOfPayment: 'family_support' },
    platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
  } as Omit<CreateOfframpRequest, 'requestId'>;
}

describe('createOfframp — quote-first only', () => {
  it('persists fees and amounts from the locked quote snapshot', async () => {
    const d = makeDeps();
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'req_1', body(), d.options);
    const persisted = d.created.data!;
    expect((persisted.fees as { platformFee: { currency: string; amount: string } }).platformFee.currency).toBe('usdt');
    expect((persisted.fees as { platformFee: { amount: string } }).platformFee.amount).toBe('1.00000000');
    expect((persisted.source as { amount: number }).amount).toBe(100);
    expect((persisted.destination as { amount: number }).amount).toBe(148500);
  });

  it('throws QUOTE_REQUIRED when no lockedQuote is supplied', async () => {
    const d = makeDeps();
    const opts = { ...d.options };
    delete (opts as Partial<CreateOfframpOptions>).lockedQuote;
    await expect(
      createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'req_1', body(), opts)
    ).rejects.toThrow('QUOTE_REQUIRED');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/offramps/createOfframp.test.ts`
Expected: FAIL (no `QUOTE_REQUIRED` thrown yet; and old assertions reference removed behavior).

- [ ] **Step 3: Edit the core**

In `src/core/offramps/createOfframp.ts`:

1. Remove `getRateFromPalremit` and `getProviderWithdrawalFeeQuote` from `CreateOfframpOptions` (lines 29-33 and 58-69). Make `lockedQuote` required:

```ts
  /** Pricing is always taken from the locked quote (POST /offramps/quotes). */
  lockedQuote: OfframpQuoteSnapshot;
```

2. Remove now-unused imports: `applyOfframpPlatformFee`, `resolveTransferFeeInSendCurrency`, `parseProviderPayout`, `PalremitWithdrawalFeeQuote`, `GetOfframpRatesResponse` (the compiler will confirm which are unused). Keep `QUOTE_EXPIRY_MINUTES`? It is only used by the deleted branch — remove it too.

3. Add an early guard near the top of `createOfframp` (after `const { source: src, destination: dest } = body;`):

```ts
  if (!options.lockedQuote) {
    throw new Error('QUOTE_REQUIRED');
  }
```

4. Simplify the derivations to snapshot-only:

```ts
  const chain = options.lockedQuote.fromChain;
  const fromCurrency = options.lockedQuote.fromCurrency.trim().toLowerCase();
  const toCurrency = options.lockedQuote.toCurrency.trim().toLowerCase();
```

5. Replace the whole `if (options.lockedQuote) { … } else { … }` pricing block (lines ~233-328) with just the locked-quote body (no `else`):

```ts
  const snap = options.lockedQuote;
  const platformFee = snap.platformFee;
  const cryptoAmount = snap.sendAmount;
  const fiatNet = snap.destinationAmount;
  const rate = snap.conversionRate;
  const inverseRate = snap.inverseRate;
  const rateInformation: RateInformation = {
    ...snap.rateInformation,
    expiresAt: snap.rateValidUntil,
  };
  const fees: OfframpFees = snap.fees;
  const depositBy = snap.rateValidUntil;
```

Keep everything from `const userDisplayInfo = userDisplay(user);` onward unchanged (it already uses `cryptoAmount`, `fiatNet`, `fees`, `rate`, `inverseRate`, `rateInformation`, `depositBy`, `platformFee`). The `assertOfframpQuoteCorridorMatchesAccount` + currency-mismatch guards at lines 214-222 stay (they already run under `if (options.lockedQuote)` — since it is now always set, you may unwrap the `if`).

- [ ] **Step 4: Run the test and type-check**

Run: `npx vitest run src/core/offramps/createOfframp.test.ts`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/offramps/createOfframp.ts src/core/offramps/createOfframp.test.ts
git commit -m "refactor(offramp): require locked quote; delete direct create path"
```

---

### Task 6: Prove settlement needs no conversion for USDC-source offramps

**Files:**
- Modify: `src/core/offramps/settleOfframpPlatformFee.test.ts`

**Interfaces:**
- Consumes: `settleOfframpPlatformFee(repo, deps, offrampId)` and the existing `baseOfframp(overrides)` helper. No production code changes — this task only adds coverage proving the new currency model settles correctly.

- [ ] **Step 1: Add the tests**

In `src/core/offramps/settleOfframpPlatformFee.test.ts`, add a `describe` block. Reuse the file's existing mock patterns for `palremitLiquidity`/`palremitCoinNetworks` (copy the setup from a neighbouring passing test in the same file). Assert:

```ts
describe('settleOfframpPlatformFee — source-currency fee', () => {
  it('settles a USDC-source fee to USDC with no rate lookup', async () => {
    // fee currency USDC, settlementCurrency USDC → resolveSettlementAmountUsdc
    // returns the amount unchanged (from === to) without calling getRate.
    const getRate = vi.fn(async () => ({ conversionRate: '1' }));
    const fees = {
      platformFee: {
        type: 'PERCENTAGE', value: '0.01', amount: '10.00000000',
        currency: 'USDC', walletAddress: '0xFee',
        settlementCurrency: 'USDC', settlementNetwork: 'MATIC',
        settlement: { status: 'pending' },
      },
    };
    // ... wire repo.findOfframpById to return baseOfframp({ fees }),
    //     deps.getRate = getRate, deps.liquidityRequest mocked to a valid
    //     network list + a created withdrawal with an id.
    // Expect: outcome 'processing', withdrawal amount === 10, getRate NOT called.
    expect(getRate).not.toHaveBeenCalled();
  });

  it('converts a USDT-source fee to USDC via the rate', async () => {
    const getRate = vi.fn(async () => ({ conversionRate: '1' })); // USDT→USDC ≈ 1
    const fees = {
      platformFee: {
        type: 'PERCENTAGE', value: '0.01', amount: '10.00000000',
        currency: 'USDT', walletAddress: '0xFee',
        settlementCurrency: 'USDC', settlementNetwork: 'MATIC',
        settlement: { status: 'pending' },
      },
    };
    // Expect: outcome 'processing', getRate called with ('USDT','USDC'),
    //         withdrawal amount === 10 (rate 1).
    expect(getRate).toHaveBeenCalledWith('USDT', 'USDC');
  });
});
```

Fill in the repo/deps wiring by mirroring the closest existing test in the file (search for a test that already drives `settleOfframpPlatformFee` to a `processing` outcome and copy its mock setup verbatim, swapping the `fees` overrides above).

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/core/offramps/settleOfframpPlatformFee.test.ts`
Expected: PASS (no production change needed — `resolveSettlementAmountUsdc` already short-circuits same-currency).

- [ ] **Step 3: Commit**

```bash
git add src/core/offramps/settleOfframpPlatformFee.test.ts
git commit -m "test(offramp): cover source-currency platform fee settlement"
```

---

### Task 7: Full suite, build, and docs

**Files:**
- Modify: `README.md` and/or `postman/` offramp create docs (whichever documents the create contract); update `OFFRAMP_PLATFORM_FEE_SOURCE_CURRENCY.md` status to "implemented".

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS (fix any offramp tests that still assume a direct path or destination-currency fee; e.g. controller-level tests if present).

- [ ] **Step 2: Type-check and build**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS

- [ ] **Step 3: Document the breaking change**

Update the offramp create documentation to state `quoteId` is required and `platformFee`/amount fields must be omitted on create. Add a short changelog/migration note: clients must call `POST /offramps/quotes` then create with the returned `quoteId`. Note the platform fee is now denominated in the source crypto.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(offramp): document quote-first create and source-currency fee"
```

---

## Self-Review

**Spec coverage:**
- Quote-first only → Tasks 3 (schema), 4 (controller), 5 (core). ✓
- Fee in source currency → Tasks 1 (math), 2 (recording). ✓
- Settlement unchanged + zero-conversion for USDC source → Task 6 (proof). ✓
- Breaking-change docs → Task 7. ✓
- Onramp untouched → no onramp files in scope. ✓

**Placeholder scan:** Task 6 intentionally references "mirror the closest existing test" for mock wiring rather than reproducing unseen helper internals; the assertions and `fees` overrides are concrete. All other steps contain full code.

**Type consistency:** `computeOfframpQuoteAmounts` return shape unchanged (field set identical; only values/semantics change). `lockedQuote` becomes required in `CreateOfframpOptions`; `createOfframp.ts` and the controller call site are both updated. `fees.platformFee.currency` = `fromCurrency` consistently in Task 2 and asserted in Tasks 2/5/6.
