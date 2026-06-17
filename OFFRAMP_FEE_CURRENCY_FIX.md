# Offramp fee-currency fix — recipient was credited less than quoted

**Date:** 2026-06-17
**Repos touched:** `api_bloxfi` (consumer) and `liquidity-orchestrator` (provider API)
**Branches:** `api_bloxfi@fix-offramp-fee-currency`, `liquidity-orchestrator@worktree-fix-owlpay-fee-currency`

## Symptom

On an offramp (crypto → fiat), the recipient received **less fiat than the quote
promised**. Example seen on a `usdt → hkd` quote:

```json
"quote": {
  "sendGross":   { "amount": "100",    "currency": "usdt" },
  "receiveGross":{ "amount": "780.95", "currency": "hkd"  },
  "receiveNet":  { "amount": "780.21", "currency": "hkd"  },   // ← less than gross
  "transferFee": { "total": { "amount": "0.744...", "currency": "HKD" } }
}
```

Two things were wrong:

1. The fee was reported in **HKD**, even though the only thing we ever send to
   the liquidity API for this corridor is **USDC** (OwlPay's funding asset).
2. That HKD fee was **subtracted from the fiat receive amount**, so the recipient
   was shorted.

## Root cause

OwlPay (the downstream provider behind `global_bank_account` corridors) is
**destination-amount-fixed**: you tell it the exact fiat amount to deliver, and
it always delivers exactly that. Its fee is charged as **extra cost on the
funding leg, denominated in USDC** — it is *never* shaved off the fiat payout.

There were two layers of the same mistake:

### Layer 1 — `liquidity-orchestrator` converted the fee into payout currency

`src/integrations/owlpay/quote-normalize.ts` multiplied each USDC fee by the
payout rate to express it in the payout fiat (HKD), to satisfy a "never leak the
funding asset" rule. That produced an HKD-denominated fee that does not
correspond to anything OwlPay actually deducts from the fiat side.

**Fix:** return the fee in its native currency (USDC), unconverted. The
`WithdrawalQuoteFee.currency` contract and the file header now document this as a
deliberate, integrator-confirmed exception (2026-06-17). `destination_amount`
stays exactly the requested payout — the fee is *not* deducted from it.

### Layer 2 — `api_bloxfi` deducted the fee from the fiat receive side

`buildRampFeePreview` and `createOfframp` did `receiveNet = receiveGross − fee`,
which only "works" if the fee is in the receive currency. With the fee now
correctly in USDC, and conceptually a **send-side** cost, the fix is to deduct it
from the **send** crypto and convert the remainder:

```
sendGross  = crypto the user sends            (e.g. 100 USDT — fixed)
fee(USDC)  → convert to send currency          (resolveTransferFeeInSendCurrency)
sendNet    = sendGross − feeInSendCurrency      (e.g. 100 − 25 = 75 USDT)
receiveNet = sendNet × rate                     (what the recipient is credited)
```

The recipient is now credited exactly what we quote; the fee is borne on the
send side, in the same currency the user funds with. Because the fee can arrive
in any currency (USDC for OwlPay; other corridors may differ) and the user may
fund with USDT, BTC, NGN, etc., the fee is always converted into the **send
currency** via the existing Palremit conversion API before being deducted.

## Changes

### liquidity-orchestrator

| File | Change |
|------|--------|
| `src/integrations/owlpay/quote-normalize.ts` | Pass the fee through in its native currency (USDC); stop converting to payout currency. Removed now-unused `mulDecimalStrings`. Header documents the deliberate funding-asset exception. |
| `src/integrations/contract.ts` | `WithdrawalQuoteFee.currency` doc updated: may be the funding asset for destination-amount-fixed providers; callers add it to the send side, never subtract from the payout. |
| tests | `withdrawal-quote.test.ts`, `quote-row-select.test.ts` updated to assert the fee stays in USDC. |

### api_bloxfi

| File | Change |
|------|--------|
| `src/core/payments/resolveTransferFeeInSendCurrency.ts` (new) | Convert a fee into the send currency via the Palremit rate; same-currency skips the lookup; fail-soft (null) when unknown or unpriceable. |
| `src/core/payments/buildOfframpFeePreview.ts` (new) | Offramp preview that deducts the fee from the send side (`sendNet`) and converts to `receiveNet`; surfaces the fee verbatim in its own currency. |
| `src/core/offramps/createOfframp.ts` | Provider fee deducted from the send crypto (converted first), remainder converted to fiat → `destination.amount`. `AMOUNT_TOO_LOW_AFTER_FEES` now checks the fee against the net send crypto. |
| `src/api/v1/offramps/controllers.ts` | `getOfframpRates` uses the convert-then-deduct-from-send path. |
| `src/types/offramp.ts` | `RampFeePreview.sendNet?` added; `transferFee` doc clarifies the fee is surfaced in its own currency. |
| tests | New `resolveTransferFeeInSendCurrency.test.ts`, `buildOfframpFeePreview.test.ts`; `createOfframp.test.ts` rewritten for deduct-from-send. |

**Onramp is intentionally untouched** — its provider fee is a crypto network fee
already denominated in the receive crypto, so deduct-from-receive is correct
there. `buildRampFeePreview` and the onramp flow are unchanged.

## Fail-soft behaviour

If the fee can't be previewed or its currency can't be priced into the send
currency, no deduction is applied: the recipient still gets the full quoted
amount and the treasury absorbs the fee. We never quote *less* than the provider
will deliver.

## Known limitation / follow-up

The fee is quoted against `grossReceive` (the pre-fee payout amount), but after
deducting the fee the actually-delivered amount is slightly smaller, so the true
fee for the smaller amount could differ marginally. This single-pass
approximation is acceptable for the preview and for v1 of the create path. A
precise close-the-loop step (re-quote OwlPay with `destination.amount =
receiveNet` and confirm the required USDC ≤ what the user funded) is a
worthwhile follow-up but was out of scope for this fix.
