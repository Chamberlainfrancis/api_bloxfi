# Fiat-to-fiat transfers

Receive fiat from your customer (e.g. NGN) and pay out fiat to a recipient
(e.g. USD or EUR). You do this with two linked transfers under the same user:
an offramp (USDT to the recipient's bank) and an onramp (your customer's fiat to
USDT). The onramp sends USDT to the offramp's deposit address, and the offramp
then pays the recipient.

Both rates are fixed when you create the two transfers.

## Steps

Make these five calls one after the other.

1. **Quote the offramp.** `POST /api/v1/offramps/quotes` with `"flow": "FIAT_TO_FIAT"`.
2. **Create the offramp.** `POST /api/v1/offramps` with the `quoteId`. From the
   response, take the deposit address and network in `transferDetails.depositInstructions`.
3. **Register that address** as an external wallet for the user.
4. **Quote the onramp.** `POST /api/v1/onramps/quotes` with `"flow": "FIAT_TO_FIAT"`,
   the same chain, and `destinationAmount` set to the offramp's crypto `sendAmount`.
5. **Create the onramp.** `POST /api/v1/onramps` with its `quoteId` and
   `destination.externalWalletId` set to the wallet from step 3.

Your customer then sends the bank transfer. When it is confirmed, USDT is sent to
the offramp's deposit address and the recipient is paid.

Send `"flow": "FIAT_TO_FIAT"` on **both** quotes.

## Supported source currencies and time to pay

| Currency | Time to send the bank transfer | Notes |
|---|---|---|
| NGN, GHS, GBP | 1 hour | |
| USD | 24 hours | Wire only: set `source.transferType` to `wire` |

Other source currencies are rejected for this flow. Each transfer expires if it
is not funded in time.

## The sender wallet is optional

`source.externalWalletId` is optional when creating the offramp.

## Webhooks

You get the usual `onramp.*` and `offramp.*` events for each transfer. In
particular, `offramp.crypto_received` means the USDT arrived, and
`offramp.completed` means the recipient has been paid.

## Making sure the full amount arrives

The onramp must deliver the full offramp amount. Always set the onramp quote's
`destinationAmount` to the offramp's `sendAmount`, and use the same chain.
