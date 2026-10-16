# Fiat-to-fiat flow (onramp → offramp)

Send fiat in (e.g. NGN) and pay fiat out (e.g. USD/EUR) by chaining two
transfers under the same user. The onramp's USDT lands in the offramp's deposit
address, which triggers the payout.

## Steps

1. **Quote the offramp** — `POST /api/v1/offramps/quotes` with `"flow": "FIAT_TO_FIAT"`.
2. **Create the offramp** — `POST /api/v1/offramps` with the `quoteId`. Take
   `transferDetails.depositInstructions.address` (and network) from the response.
3. **Register that address** as an external wallet for the user.
4. **Quote the onramp** — `POST /api/v1/onramps/quotes` with `"flow": "FIAT_TO_FIAT"`,
   `destinationAmount` set to the offramp's crypto `sendAmount` (so the right amount
   of USDT arrives), and the same chain.
5. **Create the onramp** with its `quoteId`, `destination.externalWalletId` = the wallet from step 3.
6. The client sends the bank transfer. When the onramp pays out USDT, the offramp
   sees the deposit and pays the recipient's bank.

Create the offramp first so you have an address before the onramp exists.

## What `flow: "FIAT_TO_FIAT"` changes

| | Normal | Fiat-to-fiat |
|---|---|---|
| Offramp quote / deposit window | about 30 minutes (provider rate) | 72 hours |
| Onramp deposit window | 3 hours (24 hours for NGN, GHS, GBP, EUR) | 48 hours |
| Markup | normal pair markup | pair markup + `extraMarkup` |
| Rate | locked at quote | locked at quote, held for the full window |

The flag is saved on the quote and shown as `flow` in the offramp's
`rateInformation` and the onramp's `quoteInformation`, so ops can filter these
transfers. Send it on **both** quotes. Without it a quote behaves exactly as before.
Plain crypto offramps keep the 30 minute window.

Values are in [`src/config/fiatToFiat.ts`](../src/config/fiatToFiat.ts). Edit and deploy; no env vars.

```ts
const EXTRA_MARKUP = 0.003; // 30 bps per leg

onrampWindowMinutes: 48 * 60,
offrampWindowMinutes: 72 * 60,
extraMarkup: { buy: EXTRA_MARKUP, sell: EXTRA_MARKUP }, // buy = onramp leg, sell = offramp leg
```

The extra markup is 30 bps on each leg (60 bps across both). It is added to the normal pair markup, and also applies to corridors with no
pair rule (such as NGN).

## Sender wallet is optional

`source.externalWalletId` on `POST /offramps` can be omitted. Deposits are
matched by the offramp's own deposit address, asset, network and amount, never by
the sending address. If you do send it, it must still belong to the user.

## Late and partial deposits

- The payout uses the amounts locked on the offramp, not a fresh rate.
- If USDT arrives after the deposit window and the offramp is `EXPIRED`, a
  confirmed deposit still revives it and the payout continues.
- A short deposit leaves it `CRYPTO_RECEIVED` until the full amount arrives.
- Quotes cannot be refreshed on an existing offramp. Keep the window long enough
  that this never needs to happen.

## Notes

- Create the offramp only when the client is ready to fund. Its address and
  rate are held for 72 hours.
- The onramp must deliver the full offramp amount in one asset and network,
  or the offramp stays partial.
