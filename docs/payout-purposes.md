# Payout purposes and self transfers

This applies to offramp payout accounts (`POST /api/v1/accounts`, `PUT /api/v1/accounts/:id`)
and offramps (`POST /api/v1/offramps`).

## Self transfers are not supported

- `GET /api/v1/payout-corridors/requirements` no longer returns an `extras.is_self_transfer` field,
  and `destinationTemplate` no longer contains it.
- On an account, `destination.extras.is_self_transfer: true` is rejected with **400**.
  Omit the field or send `false`.
- On an offramp, `metadata.isSelfTransfer` is optional. `true` is rejected with **400**.
- Every payout is sent as a third-party (not self) transfer.

## Purposes you can use

Use the values in the `extras.transfer_purpose` enum returned by
`GET /api/v1/payout-corridors/requirements` for the corridor. Send the same code as
`destination.extras.transfer_purpose` on the account, or `destination.purposeOfPayment` on the
offramp (the offramp's purpose wins over the account's).

`SALARY` and `TRANSFER_TO_OWN_ACCOUNT` are not accepted on accounts or offramps (**400**).

These business purposes are available on every corridor that offers the matching provider purpose:

| Code | Label |
| --- | --- |
| `REPRESENTATIVE_EXPENSES` | Representative's Expense |
| `GRAPHICS_DESIGN_BRANDING_FEES` | Graphics Design & Branding Fees |
| `ADVISOR_FEES` | Business Advisory Fees |
| `TRAINING_DEVELOPMENT_FEES` | Training and Development Fees |
| `PROFESSIONAL_FEES` | Professional Fees |
| `INFO_SERVICE` | Infotech Service Fees |
| `MARKET_RESEARCH_DEVELOPMENT` | Market Research & Development |

## Source of funds (onramp accounts)

`salary` is no longer an option for `sofQuestionnaire.sourceOfFunds` or
`sofQuestionnaire.primaryPurpose` (see `GET /api/v1/misc/source-of-funds-questionnaire`).
