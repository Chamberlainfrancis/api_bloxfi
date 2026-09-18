# Quotes (partner)

Quotes are required before create. Do not use `GET /rates` as the customer rate. Lock a quote, show that rate, then create with the returned `quoteId`.

Auth: `Authorization: Bearer <apiKey>`

## Offramp (crypto → fiat)

`POST /api/v1/offramps/quotes`

`accountId` is **required**. It is the BloxFi **Account** id from `POST /users/:userId/accounts` (the payout bank / beneficiary). Not a separate beneficiary id.

```json
{
  "fromCurrency": "usdt",
  "toCurrency": "eur",
  "fromChain": "TRC20",
  "amount": 1000,
  "accountId": "<Account UUID>",
  "platformFee": {
    "type": "PERCENTAGE",
    "value": 0.0175,
    "walletAddress": "<fee wallet>",
    "network": "TRC20"
  }
}
```

`platformFee.value` is a fraction (`0.0175` = 1.75%). `platformFee.network` is required.

**Show the customer `baseConversionRate`.** That is the FX lock. `conversionRate` is all-in after fees. Save `quoteId`.

Then `POST /api/v1/offramps` with `quoteId` plus:

- `source.userId`, `source.externalWalletId`
- `destination.userId`, `destination.accountId` (same Account as the quote)
- `destination.purposeOfPayment`

Do not resend amount, currency, chain, or `platformFee`.

Optional on the quote: `country`, `destinationType`, `beneficiaryType`. If sent, they must match the Account.

## Onramp (fiat → crypto)

`POST /api/v1/onramps/quotes`

Send **exactly one** of `amount` (fiat the customer pays) or `destinationAmount` (crypto they receive).

Fiat-first:

```json
{
  "fromCurrency": "eur",
  "toCurrency": "usdt",
  "amount": 1000,
  "chain": "TRC20",
  "platformFee": {
    "type": "PERCENTAGE",
    "value": 0.0175,
    "walletAddress": "<fee wallet>"
  }
}
```

Crypto-first (`destinationAmount` locks `receiveNet`; fiat send is back-solved, fees included):

```json
{
  "fromCurrency": "eur",
  "toCurrency": "usdt",
  "destinationAmount": 1000,
  "chain": "TRC20",
  "platformFee": {
    "type": "PERCENTAGE",
    "value": 0.0175,
    "walletAddress": "<fee wallet>"
  }
}
```

`accountId` is optional (only for named-USD deposit accounts). Show `conversionRate`. Save `quoteId`, then create with that `quoteId`.

`GET /api/v1/onramps/rates` can take `destinationAmount` + `chain` the same way so the preview does not ignore dest-fixed.

Quotes expire; create before `expiresAt`.
