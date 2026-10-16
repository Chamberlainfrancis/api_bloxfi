# Fiat-to-fiat flow (onramp → offramp)

Send fiat in (e.g. NGN) and pay fiat out (e.g. USD/EUR) by chaining two
transfers under the same user. The onramp's USDT lands in the offramp's deposit
address, which triggers the payout.

## Steps

Run all five calls back to back. Both rates are fixed once both transfers exist.

1. **Quote the offramp** — `POST /api/v1/offramps/quotes` with `"flow": "FIAT_TO_FIAT"`.
2. **Create the offramp** — `POST /api/v1/offramps` with the `quoteId`. Take
   `transferDetails.depositInstructions.address` (and network) from the response.
3. **Register that address** as an external wallet for the user.
4. **Quote the onramp** — `POST /api/v1/onramps/quotes` with `"flow": "FIAT_TO_FIAT"`,
   `destinationAmount` set to the offramp's crypto `sendAmount` (so the right amount
   of USDT arrives), and the same chain.
5. **Create the onramp** with its `quoteId` and `destination.externalWalletId` = the wallet from step 3.

The client then sends the bank transfer. When the onramp pays out USDT, the offramp
sees the deposit and pays the recipient's bank.

## What `flow: "FIAT_TO_FIAT"` changes

Send it on **both** quotes. Without it a quote behaves exactly as before, and
plain crypto offramps keep the 30 minute window.

**Onramp source currencies** are limited to NGN, USD, GHS and GBP. Any other
currency is rejected on the quote with a 400.

| Currency | Bank-transfer window | Transfer type |
|---|---|---|
| NGN, GHS, GBP | 1 hour | any |
| USD | 24 hours | `wire` only |

For USD, `source.transferType` must be `wire` on `POST /onramps`; anything else
is rejected with a 400.

**Offramp leg:** the quote and the USDT deposit address stay open for 26 hours
(longest onramp window plus a buffer).

**Markup:** Palremit's normal pair markup is doubled on both legs. For example a
20 bps USDT→EUR sell becomes 40 bps. Corridors with no pair markup (such as NGN)
stay at 0, because doubling 0 is 0.

The flag is saved on the quote and shown as `flow` in the offramp's
`rateInformation` and the onramp's `quoteInformation`, so ops can filter these
transfers.

## Config

Everything is in [`src/config/fiatToFiat.ts`](../src/config/fiatToFiat.ts). Edit and deploy; no env vars.

```ts
onrampWindowMinutes: { NGN: 60, GHS: 60, GBP: 60, USD: 24 * 60 }, // keys = allowed currencies
onrampTransferTypes: { USD: ['wire'] },
offrampWindowMinutes: 26 * 60,
markupMultiplier: 2, // 2 = double the normal markup
```

To allow another currency, add it to `onrampWindowMinutes`. To change the
markup, change `markupMultiplier` (1 = no change, 1.5 = 50% more).

## Sender wallet is optional

`source.externalWalletId` on `POST /offramps` can be omitted. Deposits are
matched by the offramp's own deposit address, asset, network and amount, never by
the sending address. If you do send it, it must still belong to the user.

## Late and partial deposits

- A confirmed deposit still revives an `EXPIRED` offramp and the payout continues.
- If the provider's cost has moved past the quote's cap, the payout is held and
  ops must accept the new rate (`POST /admin/offramps/:id/accept-rate`). There is
  no client-facing webhook or endpoint for this yet.
- A short deposit leaves the offramp `CRYPTO_RECEIVED` until the full amount arrives.
- Quotes cannot be refreshed on an existing offramp.

## Notes

- The onramp must deliver the full offramp amount in one asset and network,
  or the offramp stays partial.
- If the client never funds the onramp, both transfers expire on their own and
  nothing is paid out.
