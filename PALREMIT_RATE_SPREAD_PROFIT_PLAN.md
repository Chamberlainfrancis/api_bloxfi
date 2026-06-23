# Palremit Rate-Spread Profit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record Palremit's rate-spread profit (mid `marketRate` vs our b2b `rate`) on each onramp/offramp at quote-create time, normalized to USDC, and surface it on the admin mini dashboard (per-transaction + COMPLETED-only total).

**Architecture:** The Currency API `/pairs/conversion` already returns `marketRate` (mid) alongside the b2b `rate`, plus `rateCurrency`/`perCurrency`. We capture those, compute the spread profit in the conversion's output currency via an orientation rule, normalize to USDC with a `conversion`-based call, persist it in a new `profit` JSON column on both ramp models, and render it on the dashboard. Fully separate from `platformFee`.

**Tech Stack:** TypeScript, Vitest, Prisma 7 (Postgres), Express. Path alias `@/` → `src/`. Run tests with `npx vitest run <path>`.

## Global Constraints

- Profit is the rate spread only: `marketRate` (Currency API mid) vs `rate` (our b2b quote). Do **not** read, modify, or derive from `platformFee` / fee-settlement code.
- Profit recorded in a dedicated `profit` JSON column on `Onramp` and `Offramp` — never under `fees`.
- Profit currency = the conversion's output currency (`toCurrency`): offramp → payout fiat; onramp → received crypto. Also store `amountUsdc` (normalized).
- Profit math is orientation-based: output `=== rateCurrency` → `amount × rate`; output `=== perCurrency` → `amount ÷ rate`. Never key off ramp name.
- USDC normalization uses a `conversion`-based Currency API call (the `conversion` field), not naive rate multiplication.
- Computed at quote-create time; onramp's direct (non-quote) create path also computes it.
- Crypto amounts/figures format to 8 decimals.
- Fail-soft: missing `marketRate`/`rateCurrency`/`perCurrency` or an unavailable USDC rate yields `profit = null` (or `amountUsdc = null`) and never blocks a transaction.
- Dashboard aggregate total sums `profit.amountUsdc` over **COMPLETED** transactions only; per-transaction profit shows regardless of status.

Reference spec: `PALREMIT_RATE_SPREAD_PROFIT.md`. Live API confirmed shape:
`{"rate","conversion","rateCurrency","perCurrency","marketRate","symbol","side","using_b2b_rates"}`.

---

### Task 1: Capture `marketRate` (+ orientation fields) and add a USDC conversion helper

**Files:**
- Modify: `src/core/integrations/palremit.ts`
- Modify: `src/types/offramp.ts` (`GetOfframpRatesResponse`)
- Modify: `src/types/onramp.ts` (`GetOnrampRatesResponse`)
- Test: `src/core/integrations/palremit.test.ts`

**Interfaces:**
- Produces: `getPalremitOfframpRates` / `getPalremitOnrampRates` / `getPalremitOnrampQuote` return objects gain optional `marketRate?: string`, `rateCurrency?: string`, `perCurrency?: string`. New `getPalremitConversionAmount(currencyRequest, from, to, amount) => Promise<number | null>` returns the `conversion` field (orientation-safe output amount), null on failure.

- [ ] **Step 1: Write failing tests**

Add to `src/core/integrations/palremit.test.ts`. First extend the existing `mockCurrencyRequest` data type to allow the new fields (change its signature to `data: { rate?: string; conversion?: number; marketRate?: string; rateCurrency?: string; perCurrency?: string }`). Then add:

```ts
import { getPalremitConversionAmount } from '@/core/integrations/palremit';

describe('marketRate + orientation capture', () => {
  it('surfaces marketRate/rateCurrency/perCurrency on offramp rates', async () => {
    const { fn } = mockCurrencyRequest({ rate: '0.86764954', marketRate: '0.86904', rateCurrency: 'EUR', perCurrency: 'USDT' });
    const r = await getPalremitOfframpRates(fn, 'usdt', 'eur');
    expect(r?.marketRate).toBe('0.86904');
    expect(r?.rateCurrency).toBe('EUR');
    expect(r?.perCurrency).toBe('USDT');
  });

  it('surfaces marketRate on the onramp quote', async () => {
    const { fn } = mockCurrencyRequest({ rate: '0.87043046', conversion: 1.14885685, marketRate: '0.86904', rateCurrency: 'EUR', perCurrency: 'USDT' });
    const r = await getPalremitOnrampQuote(fn, 'eur', 'usdt', 1);
    expect(r?.marketRate).toBe('0.86904');
    expect(r?.rateCurrency).toBe('EUR');
    expect(r?.perCurrency).toBe('USDT');
  });

  it('getPalremitConversionAmount returns the conversion field', async () => {
    const { fn } = mockCurrencyRequest({ rate: '0.8733852', conversion: 0.15915085, marketRate: '0.86904', rateCurrency: 'EUR', perCurrency: 'USDC' });
    const amt = await getPalremitConversionAmount(fn, 'eur', 'usdc', 0.139);
    expect(amt).toBeCloseTo(0.15915085, 6);
  });

  it('getPalremitConversionAmount returns null on failure', async () => {
    const fn = (async () => ({ status: 500, data: { status: 'error', data: null } })) as never;
    expect(await getPalremitConversionAmount(fn, 'eur', 'usdc', 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/integrations/palremit.test.ts`
Expected: FAIL (`marketRate` undefined; `getPalremitConversionAmount` not exported).

- [ ] **Step 3: Implement**

In `src/core/integrations/palremit.ts`:

Extend the `PalremitConversionData` interface — add `marketRate?: string | number;` (it already has `rateCurrency` and `perCurrency`).

In `getPalremitOfframpRates`, before the `return`, derive the extras and add them to the returned object:

```ts
  const marketRate =
    typeof d.marketRate === 'string' ? d.marketRate : d.marketRate != null ? String(d.marketRate) : undefined;
```
Add to the returned object literal: `...(marketRate ? { marketRate } : {}), ...(d.rateCurrency ? { rateCurrency: d.rateCurrency } : {}), ...(d.perCurrency ? { perCurrency: d.perCurrency } : {}),`

Do the same in `getPalremitOnrampRates` and `getPalremitOnrampQuote` (both read `const d = res.data.data;`), adding the same three fields to their returned objects.

Append a new exported helper:

```ts
/**
 * Generic Currency API conversion: returns the orientation-safe output amount
 * (`conversion`) for `amount` units of `from` → `to`. Null on any failure.
 */
export async function getPalremitConversionAmount(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string,
  amount: number
): Promise<number | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  if (!from || !to || !Number.isFinite(amount) || amount <= 0) return null;
  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: palremitConversionBody(from, to, amount),
  });
  if (res.status !== 200 || res.data?.status !== 'success' || !res.data?.data) return null;
  const c = res.data.data.conversion;
  return typeof c === 'number' && Number.isFinite(c) ? c : null;
}
```

In `src/types/offramp.ts`, add to `GetOfframpRatesResponse` (after `inverseRate`):
```ts
  /** Currency API mid/main rate (pre-markup). */
  marketRate?: string;
  /** Currency API orientation: rate is `rateCurrency per perCurrency`. */
  rateCurrency?: string;
  perCurrency?: string;
```

In `src/types/onramp.ts`, add the same three optional fields to `GetOnrampRatesResponse` (so `GetOnrampQuoteResponse`, which extends it, inherits them).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/integrations/palremit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/integrations/palremit.ts src/types/offramp.ts src/types/onramp.ts src/core/integrations/palremit.test.ts
git commit -m "feat(rates): surface marketRate + orientation fields; add conversion-amount helper"
```

---

### Task 2: Pure rate-spread profit module

**Files:**
- Create: `src/core/quotes/rateSpread.ts`
- Test: `src/core/quotes/rateSpread.test.ts`

**Interfaces:**
- Produces: `PalremitProfit` type; `computeRateSpreadProfit(params) => { amount: number; currency: string } | null`; `buildPalremitProfit(params) => Promise<PalremitProfit | null>` (takes an injected `convertToUsdc: (from: string, amount: number) => Promise<number | null>` and a `nowIso: string`).

- [ ] **Step 1: Write the failing tests**

Create `src/core/quotes/rateSpread.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { computeRateSpreadProfit, buildPalremitProfit } from '@/core/quotes/rateSpread';

describe('computeRateSpreadProfit', () => {
  it('offramp orientation (output === rateCurrency → multiply)', () => {
    const r = computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'eur', rate: 0.86764954, marketRate: 0.86904,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    });
    expect(r?.currency).toBe('eur');
    expect(r?.amount).toBeCloseTo(0.139046, 5); // 100×0.86904 − 100×0.86764954
  });

  it('onramp orientation (output === perCurrency → divide)', () => {
    const r = computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'usdt', rate: 0.87043046, marketRate: 0.86904,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    });
    expect(r?.amount).toBeCloseTo(0.18379, 4); // 100/0.86904 − 100/0.87043046
  });

  it('clamps a negative spread to 0', () => {
    const r = computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'eur', rate: 0.90, marketRate: 0.86904,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    });
    expect(r?.amount).toBe(0);
  });

  it('returns null when toCurrency matches neither orientation side', () => {
    expect(computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'gbp', rate: 1, marketRate: 1.1,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    })).toBeNull();
  });

  it('returns null on non-finite/zero inputs', () => {
    expect(computeRateSpreadProfit({
      sourceAmount: 0, toCurrency: 'eur', rate: 1, marketRate: 1.1, rateCurrency: 'EUR', perCurrency: 'USDT',
    })).toBeNull();
  });
});

describe('buildPalremitProfit', () => {
  const base = {
    sourceAmount: 100, toCurrency: 'eur', rate: '0.86764954', marketRate: '0.86904',
    rateCurrency: 'EUR', perCurrency: 'USDT', nowIso: '2026-06-23T00:00:00.000Z',
  };

  it('builds a full record and normalizes to USDC via convertToUsdc', async () => {
    const convertToUsdc = vi.fn(async () => 0.159);
    const p = await buildPalremitProfit({ ...base, convertToUsdc });
    expect(p?.currency).toBe('eur');
    expect(p?.amountInCurrency).toBe('0.13904600');
    expect(p?.customerRate).toBe('0.86764954');
    expect(p?.marketRate).toBe('0.86904');
    expect(p?.amountUsdc).toBe('0.15900000');
    expect(convertToUsdc).toHaveBeenCalledWith('EUR', expect.any(Number));
  });

  it('skips conversion when profit currency is USDC', async () => {
    const convertToUsdc = vi.fn(async () => null);
    const p = await buildPalremitProfit({ ...base, toCurrency: 'usdc', perCurrency: 'USDC', convertToUsdc });
    expect(convertToUsdc).not.toHaveBeenCalled();
    expect(p?.amountUsdc).not.toBeNull();
  });

  it('returns amountUsdc null (native retained) when conversion unavailable', async () => {
    const p = await buildPalremitProfit({ ...base, convertToUsdc: async () => null });
    expect(p?.amountUsdc).toBeNull();
    expect(p?.amountInCurrency).toBe('0.13904600');
  });

  it('returns null when marketRate missing', async () => {
    const p = await buildPalremitProfit({ ...base, marketRate: undefined, convertToUsdc: async () => 1 });
    expect(p).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/core/quotes/rateSpread.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/core/quotes/rateSpread.ts`:

```ts
/**
 * Palremit rate-spread profit: the gap between the Currency API mid `marketRate`
 * and our quoted b2b `rate`, expressed in the conversion's output currency and
 * normalized to USDC. Independent of platformFee. Pure except for the injected
 * USDC conversion in buildPalremitProfit.
 */

export interface PalremitProfit {
  amountUsdc: string | null;   // normalized; null if USDC conversion unavailable
  currency: string;            // native profit currency = toCurrency
  amountInCurrency: string;    // profit in `currency`, 8dp
  customerRate: string;        // our quoted b2b rate
  marketRate: string;          // Currency API mid rate
  computedAt: string;          // ISO timestamp
}

/**
 * Profit in the output (to) currency. Orientation: the API quotes `rate` as
 * `rateCurrency per perCurrency`, so the output amount is amount×rate when the
 * output IS the rateCurrency, and amount÷rate when it is the perCurrency.
 */
export function computeRateSpreadProfit(p: {
  sourceAmount: number;
  toCurrency: string;
  rate: number;
  marketRate: number;
  rateCurrency: string;
  perCurrency: string;
}): { amount: number; currency: string } | null {
  const { sourceAmount, toCurrency, rate, marketRate, rateCurrency, perCurrency } = p;
  if (
    !Number.isFinite(sourceAmount) || sourceAmount <= 0 ||
    !Number.isFinite(rate) || rate <= 0 ||
    !Number.isFinite(marketRate) || marketRate <= 0
  ) return null;

  const to = toCurrency.trim().toUpperCase();
  const rc = rateCurrency.trim().toUpperCase();
  const pc = perCurrency.trim().toUpperCase();

  let outCustomer: number;
  let outMarket: number;
  if (to === rc) {
    outCustomer = sourceAmount * rate;
    outMarket = sourceAmount * marketRate;
  } else if (to === pc) {
    outCustomer = sourceAmount / rate;
    outMarket = sourceAmount / marketRate;
  } else {
    return null;
  }

  const amount = outMarket - outCustomer;
  if (!Number.isFinite(amount) || amount <= 0) return { amount: 0, currency: toCurrency };
  return { amount, currency: toCurrency };
}

export async function buildPalremitProfit(p: {
  sourceAmount: number;
  toCurrency: string;
  rate: string | number | undefined;
  marketRate: string | number | undefined;
  rateCurrency: string | undefined;
  perCurrency: string | undefined;
  nowIso: string;
  convertToUsdc: (from: string, amount: number) => Promise<number | null>;
}): Promise<PalremitProfit | null> {
  const rate = typeof p.rate === 'string' ? parseFloat(p.rate) : p.rate;
  const marketRate = typeof p.marketRate === 'string' ? parseFloat(p.marketRate) : p.marketRate;
  if (rate == null || marketRate == null || !p.rateCurrency || !p.perCurrency) return null;

  const spread = computeRateSpreadProfit({
    sourceAmount: p.sourceAmount,
    toCurrency: p.toCurrency,
    rate,
    marketRate,
    rateCurrency: p.rateCurrency,
    perCurrency: p.perCurrency,
  });
  if (!spread) return null;

  let amountUsdc: string | null;
  if (spread.amount <= 0) {
    amountUsdc = '0.00000000';
  } else {
    const from = p.toCurrency.trim().toUpperCase();
    if (from === 'USDC') {
      amountUsdc = spread.amount.toFixed(8);
    } else {
      const usdc = await p.convertToUsdc(from, spread.amount);
      amountUsdc = usdc != null && Number.isFinite(usdc) ? usdc.toFixed(8) : null;
    }
  }

  return {
    amountUsdc,
    currency: p.toCurrency,
    amountInCurrency: spread.amount.toFixed(8),
    customerRate: String(rate),
    marketRate: String(marketRate),
    computedAt: p.nowIso,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/core/quotes/rateSpread.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/quotes/rateSpread.ts src/core/quotes/rateSpread.test.ts
git commit -m "feat(profit): pure rate-spread profit module (compute + USDC normalize)"
```

---

### Task 3: `profit` column (Prisma migration), repo + snapshot wiring

**Files:**
- Modify: `prisma/schema.prisma` (`Onramp`, `Offramp` models)
- Modify: `src/db/repositories/offramp.repo.ts`, `src/db/repositories/onramp.repo.ts`
- Modify: `src/types/quote.ts` (`OfframpQuoteSnapshot`, `OnrampQuoteSnapshot`)

**Interfaces:**
- Produces: a nullable `profit` JSON column on both models; `CreateOfframpData` / `CreateOnrampData` gain `profit?: object | null` and persist it; both snapshot types gain `profit?: PalremitProfit | null`.

- [ ] **Step 1: Add the column to the schema**

In `prisma/schema.prisma`, add to `model Onramp` (after `fees`):
```prisma
  profit           Json? // PalremitProfit shape — rate-spread profit (separate from fees)
```
And to `model Offramp` (after `fees`):
```prisma
  profit              Json? // PalremitProfit shape — rate-spread profit (separate from fees)
```

- [ ] **Step 2: Generate the migration and client**

Run: `npx prisma migrate dev --name add_ramp_profit`
Expected: a new migration under `prisma/migrations/*_add_ramp_profit/` adding two nullable columns; Prisma Client regenerated. (Dev DB is native Postgres, role `hemmayo`, db `bloxfi`.)

Run: `npx prisma generate`
Expected: success.

- [ ] **Step 3: Thread `profit` through the repos**

In `src/db/repositories/offramp.repo.ts`: add `profit?: object | null;` to the `CreateOfframpData` interface, and in `createOfframp` add to the `data:` create object (next to `fees`):
```ts
      profit: data.profit === undefined || data.profit === null ? undefined : (data.profit as object),
```

In `src/db/repositories/onramp.repo.ts`: add `profit?: object | null;` to `CreateOnrampData`, and in `createOnramp` add (next to `fees`):
```ts
      profit: data.profit as object | undefined,
```

- [ ] **Step 4: Add `profit` to the snapshot types**

In `src/types/quote.ts`: add the import and the optional field to both snapshots:
```ts
import type { PalremitProfit } from '@/core/quotes/rateSpread';
```
Add to `OfframpQuoteSnapshot` and `OnrampQuoteSnapshot` (after `fees`):
```ts
  profit?: PalremitProfit | null;
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "offramp.repo|onramp.repo|quote.ts" | grep -v ".test.ts" || echo "clean in touched files"`
Expected: clean in touched files.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/db/repositories/offramp.repo.ts src/db/repositories/onramp.repo.ts src/types/quote.ts
git commit -m "feat(profit): add profit column + repo/snapshot wiring"
```

---

### Task 4: Compute + persist offramp profit (quote builder → create)

**Files:**
- Modify: `src/core/quotes/createOfframpQuote.ts`
- Modify: `src/core/offramps/createOfframp.ts`
- Modify: `src/api/v1/offramps/controllers.ts`
- Test: `src/core/quotes/createOfframpQuote.test.ts`

**Interfaces:**
- Consumes: `buildPalremitProfit` (Task 2); `getPalremitConversionAmount` (Task 1); `marketRate`/`rateCurrency`/`perCurrency` on `GetOfframpRatesResponse`.
- Produces: `CreateOfframpQuoteOptions` gains `convertToUsdc: (from: string, amount: number) => Promise<number | null>`; the offramp snapshot carries `profit`; `createOfframp` persists `snap.profit`.

- [ ] **Step 1: Write the failing test**

Append to `src/core/quotes/createOfframpQuote.test.ts` a test asserting the snapshot carries profit. Extend the existing `makeOptions()` (from Task done earlier in the file) to include `convertToUsdc` and a `marketRate` on the rate response. Add:

```ts
it('records rate-spread profit on the snapshot (USDC-normalized)', async () => {
  const options = {
    getRateFromPalremit: vi.fn(async () => ({
      ...rateResponse('0.85'), marketRate: '0.87', rateCurrency: 'EUR', perCurrency: 'USDT',
    })),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    getProviderWithdrawalFeeQuote: vi.fn(async () => null),
    convertToUsdc: vi.fn(async (_from: string, amount: number) => amount * 1.1),
  };
  await createOfframpQuote(
    { fromCurrency: 'usdt', toCurrency: 'eur', fromChain: 'TRC20', amount: 1000,
      corridor: { country: 'DE', destinationType: 'local_bank' },
      platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' } },
    options as never
  );
  const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0].payload as {
    profit?: { currency: string; amountInCurrency: string; amountUsdc: string | null; marketRate: string };
  };
  // profit_eur = 1000×0.87 − 1000×0.85 = 20 EUR; usdc = 20×1.1 = 22
  expect(snapshot.profit?.currency).toBe('eur');
  expect(snapshot.profit?.amountInCurrency).toBe('20.00000000');
  expect(snapshot.profit?.amountUsdc).toBe('22.00000000');
  expect(snapshot.profit?.marketRate).toBe('0.87');
});
```
(If the file's existing test defines a reusable `rateResponse` helper, reuse it; otherwise add a small local one returning `{ conversionRate, rateValidUntil, ... }` matching `GetOfframpRatesResponse`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/quotes/createOfframpQuote.test.ts`
Expected: FAIL (`snapshot.profit` undefined; `convertToUsdc` not in options type).

- [ ] **Step 3: Implement the quote builder change**

In `src/core/quotes/createOfframpQuote.ts`:
- Import: `import { buildPalremitProfit } from '@/core/quotes/rateSpread';`
- Add to `CreateOfframpQuoteOptions`:
```ts
  convertToUsdc: (from: string, amount: number) => Promise<number | null>;
```
- After `amounts` is computed and before building the `snapshot`, compute profit (source crypto = `input.amount`, output = `toCurrency`):
```ts
  const profit = await buildPalremitProfit({
    sourceAmount: input.amount,
    toCurrency,
    rate: rateResponse.conversionRate,
    marketRate: rateResponse.marketRate,
    rateCurrency: rateResponse.rateCurrency,
    perCurrency: rateResponse.perCurrency,
    nowIso: new Date().toISOString(),
    convertToUsdc: options.convertToUsdc,
  });
```
- Add `profit,` to the `snapshot` object literal (next to `fees`).

- [ ] **Step 4: Persist in createOfframp**

In `src/core/offramps/createOfframp.ts`:
- Add `profit?: object | null;` to the `OfframpRepoCreate.createOfframp(data: {...})` parameter type (next to `fees`).
- In the locked-quote block, read it: after `const fees: OfframpFees = snap.fees;` add `const profit = snap.profit ?? null;`
- In the final `offrampRepo.createOfframp({ ... })` call, add `profit,` (next to `fees`).

- [ ] **Step 5: Wire convertToUsdc in the controller**

In `src/api/v1/offramps/controllers.ts`:
- Import `getPalremitConversionAmount` from `@/core/integrations` (it is re-exported there; if not, import from `@/core/integrations/palremit`).
- In the `createOfframpQuote(parsed.data, { ... })` options object (inside `createOfframpQuoteHandler`), add:
```ts
      convertToUsdc: (from, amount) => getPalremitConversionAmount(palremitCurrency, from, 'USDC', amount),
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run src/core/quotes/createOfframpQuote.test.ts src/core/offramps/createOfframp.test.ts`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "createOfframpQuote|createOfframp.ts|offramps/controllers" | grep -v ".test.ts" || echo "clean"`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/core/quotes/createOfframpQuote.ts src/core/offramps/createOfframp.ts src/api/v1/offramps/controllers.ts src/core/quotes/createOfframpQuote.test.ts
git commit -m "feat(profit): compute + persist offramp rate-spread profit"
```

---

### Task 5: Compute + persist onramp profit (quote builder + direct create)

**Files:**
- Modify: `src/core/quotes/createOnrampQuote.ts`
- Modify: `src/core/onramps/createOnramp.ts`
- Modify: `src/api/v1/onramps/controllers.ts`
- Test: `src/core/onramps/createOnramp.test.ts`

**Interfaces:**
- Consumes: `buildPalremitProfit`; `getPalremitConversionAmount`; the onramp quote fn now returns `marketRate`/`rateCurrency`/`perCurrency`.
- Produces: onramp snapshot carries `profit`; `createOnramp` persists it (locked path from `snap.profit`, direct path computed inline). Both onramp builders' `getQuoteFromPalremit` option return type gains `marketRate?: string | null; rateCurrency?: string | null; perCurrency?: string | null`. `CreateOnrampQuoteOptions` and `createOnramp`'s options gain `convertToUsdc`.

- [ ] **Step 1: Write the failing test**

Append to `src/core/onramps/createOnramp.test.ts` a test for the direct (non-locked) path that asserts `profit` is persisted. Mirror the file's existing `makeDeps()` setup; ensure `getQuoteFromPalremit` returns `{ conversionRate, conversion, marketRate, rateCurrency, perCurrency }` and add `convertToUsdc` to options. Assert the persisted onramp row's `profit`:

```ts
it('persists rate-spread profit on a direct onramp create', async () => {
  const d = makeDepsForProfit(); // build on existing makeDeps; getQuoteFromPalremit → { conversionRate:'1450', conversion:0.689, marketRate:'1460', rateCurrency:'NGN', perCurrency:'USDT' }; convertToUsdc:(_,a)=>a*0.99
  await createOnramp(/* repos */ ...d.args, bodyDirect(), d.options);
  const persisted = d.created.data!;
  const profit = (persisted.profit as { currency: string; amountInCurrency: string; amountUsdc: string | null }) ?? null;
  expect(profit).not.toBeNull();
  // onramp: output is perCurrency (USDT) → divide. profit_usdt = amount/marketRate − amount/rate
  expect(profit.currency).toBe('usdt');
  expect(profit.amountUsdc).not.toBeNull();
});
```
Match the exact `createOnramp(...)` argument order used by the file's existing tests; reuse its repo mocks (the onramp `createOnramp` core repo must capture `data.profit`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/onramps/createOnramp.test.ts`
Expected: FAIL (`persisted.profit` undefined; `convertToUsdc` not in options type).

- [ ] **Step 3: Implement — onramp quote builder**

In `src/core/quotes/createOnrampQuote.ts`:
- Import `buildPalremitProfit`.
- Change the `getQuoteFromPalremit` option return type to:
```ts
  getQuoteFromPalremit: (from: string, to: string, amount: number) => Promise<{
    conversionRate: string; conversion: number;
    marketRate?: string | null; rateCurrency?: string | null; perCurrency?: string | null;
  } | null>;
```
- Add `convertToUsdc: (from: string, amount: number) => Promise<number | null>;` to `CreateOnrampQuoteOptions`.
- After `receiveNet`/`fees` are computed, before building the snapshot, compute profit (source fiat = `input.amount`, output = `toCurrency`):
```ts
  const profit = await buildPalremitProfit({
    sourceAmount: input.amount,
    toCurrency,
    rate: palremitQuote.conversionRate,
    marketRate: palremitQuote.marketRate ?? undefined,
    rateCurrency: palremitQuote.rateCurrency ?? undefined,
    perCurrency: palremitQuote.perCurrency ?? undefined,
    nowIso: new Date().toISOString(),
    convertToUsdc: options.convertToUsdc,
  });
```
- Add `profit,` to the snapshot object literal.

- [ ] **Step 4: Implement — createOnramp (both paths)**

In `src/core/onramps/createOnramp.ts`:
- Import `buildPalremitProfit`.
- Widen the `getQuoteFromPalremit` option return type identically to Step 3 (add `marketRate?`, `rateCurrency?`, `perCurrency?`), and add `convertToUsdc?: (from: string, amount: number) => Promise<number | null>;` to the options type.
- Add `profit?: object | null;` to the onramp core repo `createOnramp` data param type (next to `fees`).
- Declare `let profit: object | null = null;` alongside `let fees`.
- Locked path: `profit = snap.profit ?? null;`
- Direct path: after `fees = {...}` is built, add:
```ts
    profit = options.convertToUsdc
      ? await buildPalremitProfit({
          sourceAmount: src.amount,
          toCurrency,
          rate: quote.conversionRate,
          marketRate: quote.marketRate ?? undefined,
          rateCurrency: quote.rateCurrency ?? undefined,
          perCurrency: quote.perCurrency ?? undefined,
          nowIso: new Date().toISOString(),
          convertToUsdc: options.convertToUsdc,
        })
      : null;
```
- In the final `onrampRepo.createOnramp({ ... })` call, add `profit,` (next to `fees`).

- [ ] **Step 5: Wire controller**

In `src/api/v1/onramps/controllers.ts`:
- Ensure the onramp `getQuoteFromPalremit` wrapper returns the new fields — it calls `getPalremitOnrampQuote(...)`, whose result now includes `marketRate`/`rateCurrency`/`perCurrency`; return them through (spread the result or map the fields).
- Add `convertToUsdc: (from, amount) => getPalremitConversionAmount(palremitCurrency, from, 'USDC', amount)` to BOTH the `createOnrampQuote(...)` options and the `createOnramp(...)` options. Import `getPalremitConversionAmount`. (Use the same `palremitCurrency` adapter the onramp controller already constructs for rates.)

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run src/core/onramps/createOnramp.test.ts src/core/quotes`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "createOnramp|onramps/controllers" | grep -v ".test.ts" || echo "clean"`
Expected: clean

- [ ] **Step 7: Commit**

```bash
git add src/core/quotes/createOnrampQuote.ts src/core/onramps/createOnramp.ts src/api/v1/onramps/controllers.ts src/core/onramps/createOnramp.test.ts
git commit -m "feat(profit): compute + persist onramp rate-spread profit (quote + direct)"
```

---

### Task 6: Surface profit on the mini dashboard (per-txn + COMPLETED total)

**Files:**
- Modify: `src/core/admin/dashboard.ts`
- Modify: `src/db/repositories/offramp.repo.ts`, `src/db/repositories/onramp.repo.ts`
- Modify: `src/api/admin/page.ts`
- Test: `src/core/admin/dashboard.test.ts`

**Interfaces:**
- Produces: `sumProfitUsdc(rows: Array<{ profit?: unknown }>) => string` (pure, 8dp); `getTotalRealizedProfitUsdc() => Promise<string>` (COMPLETED onramps + offramps); `getTransactionDetail` result includes `profit`; repos expose `findCompletedProfits() => Promise<Array<{ profit: unknown }>>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/admin/dashboard.test.ts`:

```ts
import { sumProfitUsdc } from '@/core/admin/dashboard';

describe('sumProfitUsdc', () => {
  it('sums amountUsdc and skips nulls / missing', () => {
    const rows = [
      { profit: { amountUsdc: '1.50000000' } },
      { profit: { amountUsdc: null } },
      { profit: null },
      {},
      { profit: { amountUsdc: '2.25000000' } },
    ];
    expect(sumProfitUsdc(rows)).toBe('3.75000000');
  });

  it('returns 0.00000000 for an empty set', () => {
    expect(sumProfitUsdc([])).toBe('0.00000000');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/admin/dashboard.test.ts`
Expected: FAIL (`sumProfitUsdc` not exported).

- [ ] **Step 3: Implement the pure summation + aggregate**

In `src/core/admin/dashboard.ts`, add:

```ts
export function sumProfitUsdc(rows: Array<{ profit?: unknown }>): string {
  let total = 0;
  for (const r of rows) {
    const p = r.profit;
    if (p == null || typeof p !== 'object') continue;
    const v = (p as { amountUsdc?: unknown }).amountUsdc;
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    if (Number.isFinite(n)) total += n;
  }
  return total.toFixed(8);
}

export async function getTotalRealizedProfitUsdc(): Promise<string> {
  const [onrampRepo, offrampRepo] = await Promise.all([
    import('@/db/repositories/onramp.repo'),
    import('@/db/repositories/offramp.repo'),
  ]);
  const [on, off] = await Promise.all([
    onrampRepo.findCompletedProfits(),
    offrampRepo.findCompletedProfits(),
  ]);
  return sumProfitUsdc([...on, ...off]);
}
```

- [ ] **Step 4: Add the repo fetchers**

In `src/db/repositories/offramp.repo.ts`, add:
```ts
export async function findCompletedProfits(): Promise<Array<{ profit: unknown }>> {
  return prisma.offramp.findMany({ where: { status: 'COMPLETED' }, select: { profit: true } });
}
```
In `src/db/repositories/onramp.repo.ts`, add the same against `prisma.onramp` (use this file's existing prisma import name; mirror its other queries).

- [ ] **Step 5: Ensure profit reaches the detail object**

In `src/core/admin/dashboard.ts` `getTransactionDetail`: the onramp/offramp `findById` rows now include `profit` (post-migration). If the function returns the row directly (or spreads it), no change is needed. If it builds an explicit object, add `profit: (row as { profit?: unknown }).profit ?? null`. Confirm by reading the function; do not duplicate fields.

- [ ] **Step 6: Render on the admin page**

In `src/api/admin/page.ts`:
- Per-transaction: right after the Fees section render (`if (hasContent(t.fees)) body += section("Fees", kvBlock(t.fees));`), add:
```js
        if (t.profit && t.profit.amountInCurrency) {
          var pf = t.profit;
          var profitRows = {
            "USDC": pf.amountUsdc == null ? "—" : pf.amountUsdc,
            "Native": pf.amountInCurrency + " " + (pf.currency || "").toUpperCase(),
            "Market rate": pf.marketRate,
            "Our rate": pf.customerRate,
          };
          body += section("Palremit profit", kvBlock(profitRows));
        }
```
- Aggregate total: the dashboard summary is rendered server-side. Pass a `totalProfitUsdc` value into the page template (from `getTotalRealizedProfitUsdc()` at the route that renders the dashboard) and render it in the `.summary` bar, e.g. `'<span class="kv"><span class="k">Total profit</span> <span class="v">' + esc(totalProfitUsdc) + ' USDC</span></span>'`. Wire the value where the page's other summary data is assembled (follow the existing data-passing pattern in `page.ts` / its admin route). Show `0.00000000` when none.

- [ ] **Step 7: Run tests + type-check + build**

Run: `npx vitest run src/core/admin/dashboard.test.ts`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "dashboard|admin/page|repositories/(on|off)ramp" | grep -v ".test.ts" || echo "clean"`
Expected: clean

- [ ] **Step 8: Commit**

```bash
git add src/core/admin/dashboard.ts src/db/repositories/offramp.repo.ts src/db/repositories/onramp.repo.ts src/api/admin/page.ts src/core/admin/dashboard.test.ts
git commit -m "feat(profit): show per-transaction profit + COMPLETED total on dashboard"
```

---

### Task 7: Full suite, build, docs

**Files:**
- Modify: `PALREMIT_RATE_SPREAD_PROFIT.md` (status → implemented); `README.md` (brief admin-dashboard note if it documents the dashboard).

- [ ] **Step 1: Full suite**

Run: `npx vitest run`
Expected: PASS (fix any ramp/dashboard test that assumed no `profit`).

- [ ] **Step 2: Type-check + Prisma client**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no NEW errors beyond the known pre-existing test-file baseline (`onramps/schemas.test.ts`, `palremit.test.ts`, `settleOfframpPlatformFee.test.ts`). Production `src/` clean.

Run: `npx prisma generate`
Expected: success.

- [ ] **Step 3: Docs**

Set `**Status:**` in `PALREMIT_RATE_SPREAD_PROFIT.md` to `implemented (branch palremit-rate-spread-profit)`. If `README.md` documents the admin dashboard, add one line that it now shows per-transaction Palremit profit and a COMPLETED-only USDC total.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(profit): mark rate-spread profit implemented"
```

---

## Self-Review

**Spec coverage:**
- Capture marketRate + orientation → Task 1. ✓
- Pure profit math + USDC normalize → Task 2. ✓
- Persisted `profit` column separate from platformFee → Task 3. ✓
- Offramp compute/persist at quote-create → Task 4. ✓
- Onramp compute/persist (quote + direct) → Task 5. ✓
- Dashboard per-txn + COMPLETED total → Task 6. ✓
- Fail-soft (null profit / null amountUsdc, never blocks) → Tasks 2,4,5 (buildPalremitProfit returns null; callers store null). ✓
- Docs/status → Task 7. ✓

**Placeholder scan:** Task 5/6 reference "mirror the existing `makeDeps`/prisma import / data-passing pattern" for setup that depends on unseen local helpers; the assertions, types, and logic are concrete. Per-task implementers must match the existing call signatures in those files — flagged explicitly, not left vague.

**Type consistency:** `PalremitProfit` defined in Task 2 and imported in Tasks 3–6. `convertToUsdc: (from: string, amount: number) => Promise<number | null>` identical across Tasks 2,4,5. `buildPalremitProfit` param names match across callers. `findCompletedProfits()` and `sumProfitUsdc`/`getTotalRealizedProfitUsdc` names consistent across Task 6. `marketRate`/`rateCurrency`/`perCurrency` optional-string fields consistent from Task 1 through the consumers.
