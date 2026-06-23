# Palremit rate-spread profit — record per transaction, surface on the mini dashboard

**Date:** 2026-06-23
**Repo:** `api_bloxfi`
**Status:** design (pre-implementation)

## Goal

Record how much Palremit earns on each ramp transaction from the **rate spread**
— the gap between the true mid/main rate and the marked-up rate we quote (the
markup configured in the Currency API) — and surface it on the admin mini
dashboard: a per-transaction figure plus an aggregate total.

This is **separate from `platformFee`**. No `platformFee` / fee-settlement code
is read or modified by this work.

## Scope

- Both **offramp** (crypto→fiat) and **onramp** (fiat→crypto).
- Profit recorded **normalized to USDC** (with the native-currency figure kept
  alongside for transparency).
- Dashboard: **per-transaction** profit on every row's detail, plus an
  **aggregate total** summed over **COMPLETED** transactions only (realized
  earnings). Per-transaction profit shows regardless of status.

## How the spread is obtained (confirmed against the live API)

The Currency API `POST /pairs/conversion` (called with `b2b: true`) returns BOTH
the marked-up `rate` and the **mid/main rate as `marketRate`**, plus
`rateCurrency` / `perCurrency`. Confirmed live responses:

```
USDT→EUR (SELL): {"rate":"0.86764954","marketRate":"0.86904","rateCurrency":"EUR","perCurrency":"USDT","side":"SELL","using_b2b_rates":true,...}
EUR→USDT (BUY):  {"rate":"0.87043046","marketRate":"0.86904","rateCurrency":"EUR","perCurrency":"USDT","side":"BUY", "using_b2b_rates":true,...}
```

So no markup field needs deriving — `marketRate` IS the main rate and `rate` is
our quote. `PalremitConversionData` already maps `rateCurrency`/`perCurrency`;
we add only `marketRate?: string`.

**Key subtlety:** the rate is always quoted as `rateCurrency per perCurrency`
(fiat-per-crypto here) for BOTH directions. So profit must be computed by the
output-currency orientation (`rateCurrency` vs `perCurrency`), NOT by the ramp
name.

Fail-soft: if `marketRate` is absent/unparseable, `profit = null` and the
transaction proceeds unaffected.

## Profit math (pure)

`computeRateSpreadProfit({ sourceAmount, toCurrency, rate, marketRate, rateCurrency, perCurrency })`
computes the customer's output at the quoted rate vs at the market rate; the
platform keeps the difference, returned as `{ amount, currency: toCurrency }`:

```
outputAtCustomer = orient(sourceAmount, rate)        // == conversion from the API
outputAtMarket   = orient(sourceAmount, marketRate)
profit           = max(0, outputAtMarket − outputAtCustomer)   // in toCurrency

where orient(amount, r) =
  amount × r        if toCurrency === rateCurrency   (output is the rateCurrency, e.g. offramp USDT→EUR)
  amount ÷ r        if toCurrency === perCurrency     (output is the perCurrency,  e.g. onramp EUR→USDT)
```

Worked examples from the live rates above:
- **Offramp** 100 USDT→EUR: `100×0.86904 − 100×0.86764954 = 0.139046 EUR`.
- **Onramp** 100 EUR→USDT: `100/0.86904 − 100/0.87043046 = 0.18379 USDT`.

Both positive (the b2b rate is set to favor the platform). A non-finite result,
an unrecognized orientation (`toCurrency` matches neither), or a negative spread
clamps to `0`/unavailable (defensive).

`amount` is then converted to USDC via the existing injected
`getRate(toCurrency, 'USDC')` pattern (same rate mechanism used elsewhere;
same-currency is a no-op). If the rate is unavailable, `amountUsdc` is null and
the native-currency figure is still recorded.

## Persisted shape

New nullable JSON column `profit` on both `Onramp` and `Offramp` models (Prisma
migration). Shape:

```ts
interface PalremitProfit {
  amountUsdc: string | null;   // normalized profit (null if USDC rate unavailable)
  currency: string;            // native profit currency = toCurrency (payout fiat | received crypto)
  amountInCurrency: string;    // profit in `currency`
  customerRate: string;        // our quoted b2b `rate`
  marketRate: string;          // Currency API `marketRate` (the main/mid rate)
  computedAt: string;          // ISO timestamp
}
```

Stored under its own column — **not** under `fees` and **not** related to
`platformFee`.

## Where it is computed and persisted

Profit is computed **at quote-create time** — where the `rate` + `marketRate` +
amount are first locked — via one shared `buildPalremitProfit` helper, stored on
the quote snapshot, and persisted into the `profit` column at ramp create (the
same hand-through as `snap.fees`):

- **Offramp (quote-only):** computed in `src/core/quotes/createOfframpQuote.ts`,
  attached to the `OfframpQuoteSnapshot` (new optional `profit` field), persisted
  by `createOfframp.ts` from `snap.profit`.
- **Onramp:** computed in `src/core/quotes/createOnrampQuote.ts`, attached to the
  `OnrampQuoteSnapshot` (new optional `profit` field), persisted by
  `createOnramp.ts` from the locked snapshot. For onramp's **direct (non-quote)**
  create path, the same helper runs at create from the just-fetched rate so no
  onramp is missed.

USDC normalization uses the rate fn already injected into each builder.

Rate capture changes (surface `marketRate`, `rateCurrency`, `perCurrency`) land
in `getPalremitOfframpRates`, `getPalremitOnrampRates`, and
`getPalremitOnrampQuote` (`palremit.ts`) — add `marketRate?: string` to
`PalremitConversionData` and the new fields to `GetOfframpRatesResponse` /
`GetOnrampRatesResponse` / `GetOnrampQuoteResponse` (`rateCurrency`/`perCurrency`
are already parsed into `PalremitConversionData`).

## Dashboard (`src/core/admin/dashboard.ts` + `src/api/admin/page.ts`)

- **Per-transaction:** `getTransactionDetail` already returns the row; the page
  renders a new "Palremit profit" block showing `amountUsdc` (USDC) with the
  native `amountInCurrency`/`currency` and the mid-vs-customer rates. Shows "—"
  when `profit` is null/unavailable.
- **Aggregate total:** a new repo helper sums `profit.amountUsdc` across
  **COMPLETED** onramps + offramps; `dashboard.ts` exposes
  `getTotalRealizedProfitUsdc()`; the page renders "Total profit (USDC)" in the
  top summary bar.

## Components / units

| Unit | Responsibility |
|------|----------------|
| `computeRateSpreadProfit` (new, `src/core/quotes/rateSpread.ts`) | profit `{amount,currency}` in output currency via the orient() rule, pure |
| `resolveProfitInUsdc` (new, same file) | convert profit to USDC via injected getRate; fail-soft null |
| `buildPalremitProfit` (new, same file) | assemble the `PalremitProfit` record (compute + USDC) from a rate result + source amount |
| `palremit.ts` rate fns | surface `marketRate` (+ existing `rateCurrency`/`perCurrency`) from the conversion response |
| `createOfframpQuote.ts` / `createOnrampQuote.ts` / `createOnramp.ts` (direct) | call `buildPalremitProfit`, persist `PalremitProfit` |
| `dashboard.ts` + `page.ts` | per-txn render + COMPLETED aggregate |

## Error handling / fail-soft

- Missing/unparseable `marketRate` → `profit = null`; transaction proceeds.
- Non-finite/negative spread → clamp to 0, mark unavailable.
- USDC rate lookup fails → `amountUsdc = null`, native figure retained.
- Dashboard renders "—" for any null profit; aggregate skips nulls.

## Testing

- `rateSpread.test.ts`: `computeRateSpreadProfit` for both orientations
  (`toCurrency === rateCurrency` → multiply; `=== perCurrency` → divide) using
  the worked live-rate examples, plus clamps (negative/non-finite/unrecognized
  orientation → 0); `resolveProfitInUsdc` (same-currency no-op, conversion,
  unavailable); `buildPalremitProfit` (full record; null when `marketRate`
  absent).
- `palremit.test.ts`: rate fns surface `marketRate` when present; absent →
  field undefined (no throw).
- `createOfframpQuote.test.ts` / `createOnrampQuote.test.ts`: snapshot carries a
  `profit` with USDC + native figures; absent `marketRate` → `profit` null.
- `createOnramp.test.ts`: `profit` persisted on create (locked + direct paths);
  fail-soft when `marketRate` absent.
- `dashboard.test.ts`: aggregate sums COMPLETED only and skips nulls; per-txn
  detail surfaces profit.

## Out of scope

- Any change to `platformFee`, fee preview, or `settleOfframpPlatformFee`.
- Backfilling profit for historical transactions (new column is null for them;
  dashboard shows "—").
- Currency-API-side markup configuration (owned upstream).

## Acceptance criteria

- A completed offramp and a completed onramp each persist a `profit` with a
  USDC figure derived from the rate spread, independent of `platformFee`.
- The mini dashboard shows per-transaction profit and a COMPLETED-only total in
  USDC.
- Missing `marketRate` or USDC rate never blocks a transaction (fail-soft).
