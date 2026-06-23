# Offramp: quote-first only, platform fee in source currency

**Date:** 2026-06-23
**Repo:** `api_bloxfi`
**Status:** design (pre-implementation)
**Related:** `OFFRAMP_FEE_CURRENCY_FIX.md` (that fix was for the *provider transfer
fee*; this one is for the *platform fee* + the create flow).

## Two coupled changes

1. **Quote-first only.** `POST /offramps` must always reference a `quoteId`.
   Direct (quoteless) offramp creation is removed.
2. **Platform fee in source currency.** The offramp platform fee is denominated
   in the **source crypto** (`fromCurrency`), not the destination fiat.
   Settlement stays USDC.

They are coupled: removing the direct path deletes the *second*, inconsistent
fee-computation path, leaving the quote builder as the **single source of truth**
for offramp fees. The fee fix then lives in exactly one place.

## Problem

Today there are two ways to create an offramp, and they compute the platform fee
in different currencies:

| Path | Fee computed on | `fees.platformFee.currency` |
|------|-----------------|------------------------------|
| `POST /offramps/quotes` → `computeOfframpQuoteAmounts.ts` | **fiat receive** (destination) | `toCurrency` (e.g. **EUR**) |
| `POST /offramps` direct → `createOfframp.ts:259` (the `else` branch) | source crypto | `fromCurrency` (e.g. USDT) |

Create-from-quote inherits the quote snapshot's `fees`, so a quote-based offramp
carries a **destination-fiat** fee. Observed: `4,126.00531021 USDT →
3,499.99517107 EUR`, platform fee denominated in **EUR**.

At settlement (`settleOfframpPlatformFee.ts`) the fee is paid out as a USDC
withdrawal; `resolveSettlementAmountUsdc` converts `fees.platformFee.currency →
settlementCurrency`. For a quote-based offramp that is **EUR → USDC** — a
conversion against a currency we never custody (the provider delivers fiat
straight to the recipient). This is the "converted back to USDC again"
confusion, and it carries quote-time → settlement-time FX risk on a phantom
amount.

## Decisions (confirmed)

1. **Quote required.** `quoteId` is mandatory on offramp create. No direct path.
2. **Fee denomination:** source crypto (`fromCurrency`).
3. **Settlement currency:** USDC, sourced from the `platformFee.currency` field
   on the quote request (default `USDC`). No change to settlement logic.
4. **Fee base:** the percentage applies to the **gross source crypto** (before
   the transfer fee).

## Target offramp math (single path, in the quote builder)

```
sendGross          = amount                                    // source crypto (e.g. USDT)
platformFeeCrypto  = applyOfframpPlatformFee(sendGross, fee)   // source crypto
afterPlatform      = sendGross − platformFeeCrypto             // source crypto
providerFeeQuote   = getProviderWithdrawalFeeQuote(amount = afterPlatform × rate)  // fiat basis
transferFeeInSend  = resolveTransferFeeInSendCurrency(...)     // source crypto
afterTransfer      = afterPlatform − transferFeeInSend         // source crypto
receiveNet         = afterTransfer × rate                      // fiat to recipient
allInRate          = receiveNet / sendGross
```

Recorded fee in the snapshot:

```
fees.platformFee.currency           = fromCurrency       // source crypto  ← the change
fees.platformFee.amount             = platformFeeCrypto  // crypto precision (8dp), not 2dp
fees.platformFee.settlementCurrency = platformFee.currency || 'USDC'   // unchanged
```

## Scope of changes

### Change 1 — quote-first only

**`src/api/v1/offramps/schemas.ts`** (`createOfframpBodySchema`)
- Require `quoteId` (add an issue when missing).
- Remove the `else` block that validated direct-create fields
  (`source.amount/currency/chain`, `destination.currency`, `platformFee`
  required). Those become unconditionally *forbidden* alongside `platformFee`
  (the "must be omitted when quoteId is provided" checks become unconditional).
- Identity/execution fields stay required: `requestId`, `source.userId`,
  `source.externalWalletId`, `destination.userId`, `destination.accountId`,
  `destination.purposeOfPayment` (+ USD metadata rules).

**`src/api/v1/offramps/controllers.ts`** (`createOfframp` handler)
- Remove the `else { body = { …direct… } }` branch (lines ~273–280). `quoteId`
  is always present → always hydrate from snapshot.
- Drop the now-unused `getRateFromPalremit` / `getProviderWithdrawalFeeQuote`
  options passed into `offrampCore.createOfframp` (see below).

**`src/core/offramps/createOfframp.ts`**
- Make `lockedQuote` required; delete the non-locked `else` branch (lines
  ~246–328), including its `applyOfframpPlatformFee`, provider-fee quoting, and
  `fees` assembly. Fees/amounts come solely from the snapshot.
- Simplify `chain`/`fromCurrency`/`toCurrency` derivation to snapshot-only.
- Remove the now-unused `getRateFromPalremit` and `getProviderWithdrawalFeeQuote`
  fields from the options interface.
- Keep corridor/currency assertions (`assertOfframpQuoteCorridorMatchesAccount`,
  the from/to mismatch guards).

### Change 2 — platform fee in source currency (quote builder only)

**`src/core/quotes/computeOfframpQuoteAmounts.ts`**
- Compute `platformFeeAmount` on `sendAmount` (gross source crypto), **before**
  the transfer fee — not on `baseReceiveNet` (fiat).
- Deduction order: `sendGross − platformFeeCrypto − transferFeeInSend`, then
  `× rate` for `receiveNet`.
- `platformFeeAmount` is in source crypto. `baseReceiveNet` stays "fiat after
  transfer fee, before platform markup" (matches `types/offramp.ts:224`).
- Update the header comment ("platform fee on fiat receive" → "on source crypto").

**`src/core/quotes/createOfframpQuote.ts`**
- `fees.platformFee.currency`: `toCurrency` → `fromCurrency` (~line 152).
- `fees.platformFee.amount`: crypto precision (8dp), not `.toFixed(2)`.
- `quote.platformFee.amount` (the `RampFeePreview`): crypto precision; set
  `quote.platformFee.currency` to `fromCurrency` so amount + currency agree.
- Re-quote the provider fee on the **post-platform-fee** fiat basis
  (`afterPlatform × rate`) instead of the pre-fee `grossReceive`.
- Widen the `AMOUNT_TOO_LOW_AFTER_FEES` guard to account for platform fee +
  transfer fee against the source crypto.

### No change needed
- `settleOfframpPlatformFee.ts` — already converts `fees.platformFee.currency →
  settlementCurrency` with a same-currency no-op; once `currency` is the source
  crypto, USDC-source ⇒ zero conversion, USDT-source ⇒ USDT→USDC.
- `hydrateCreateFromQuote.ts` — inherits the corrected `snapshot.fees`.
- Admin dashboard — reads `pf.currency` for display only (`dashboard.ts:452`).
- `GET /offramps/rates` preview — stays (display-only rate/fee preview, not a
  binding create); `buildOfframpFeePreview` already excludes the platform fee.
- Onramp — out of scope (different direction; no automatic settlement payout).
- `applyOfframpPlatformFee` helper — retained (used by the quote builder and
  onramp).

## Breaking change
`POST /offramps` without a `quoteId` now returns `400 INVALID_REQUEST`. Clients
must call `POST /offramps/quotes` first and pass the returned `quoteId`. Document
in the API spec / changelog; coordinate with dashboard + any SDK callers.

## Tests
- `schemas` — reject offramp create without `quoteId`; reject `platformFee` /
  direct `source.*` / `destination.*` amount fields.
- `createOfframp.test.ts` — rewrite for quote-only; assert it throws/contains no
  direct-path branch; fees come from the snapshot.
- `computeOfframpQuoteAmounts.test.ts` — fee on gross source crypto, new
  deduction order, `platformFeeAmount` in crypto units.
- `createOfframpQuote.test.ts` — `fees.platformFee.currency === fromCurrency`,
  crypto-precision amount, settlement currency unchanged.
- `settleOfframpPlatformFee.test.ts` — USDC-source offramp settles with **no**
  conversion; USDT-source converts USDT→USDC.

## Acceptance criteria
- `POST /offramps` requires a valid `quoteId`; direct create is rejected.
- A `USDT → EUR` offramp records `fees.platformFee.currency = "usdt"` with the
  amount in USDT.
- A `USDC → <fiat>` offramp settles the platform fee with zero FX conversion.
- There is exactly one offramp fee-computation path (the quote builder).
- Onramp behaviour is unchanged.

## Known limitation (carried over)
The provider transfer-fee quote remains a single-pass approximation against the
post-platform fiat amount (same caveat as `OFFRAMP_FEE_CURRENCY_FIX.md`). A
close-the-loop re-quote is out of scope.
