# Partner outgoing webhooks

JSON body posted to `PARTNER_WEBHOOK_URL`. This document covers **event types and payload shapes only**.

---

## Envelope

Every delivery is this object. `data` is event-specific (see below).

```json
{
  "eventId": "3d2c1b0a-1111-4111-8111-aaaaaaaaaaaa",
  "eventType": "user.created",
  "occurredAt": "2026-08-14T14:00:00.000Z",
  "data": {}
}
```

| Field | Type | Notes |
|---|---|---|
| `eventId` | UUID string | New id per event. Retries of the same event reuse it. |
| `eventType` | string | One of the values in [Event types](#event-types). |
| `occurredAt` | ISO-8601 UTC | Time the event was scheduled. |
| `data` | object | Partner-safe fields for that event. |

Omitted optional keys are **absent**, not `null`, unless a sample shows `null`.

---

## Event types

| `eventType` | `data` |
|---|---|
| `user.created` | `{ userId, status, kybStatus, createdAt }` |
| `kyb.status_updated` | `{ userId, kybStatus, previousStatus, rails? }` |
| `account.created` | `{ accountId, userId, rail, type }` |
| `account.updated` | `{ accountId, userId, rail, type }` |
| `account.deleted` | `{ accountId, userId }` |
| `account.capabilities.updated` | `{ accountId, userId, capabilities, depositDetails? }` |
| `onramp.created` | [Onramp `data`](#onramp-data) |
| `onramp.fiat_received` | same |
| `onramp.crypto_initiated` | same |
| `onramp.completed` | same |
| `onramp.failed` | same |
| `onramp.expired` | same |
| `offramp.created` | [Offramp `data`](#offramp-data) |
| `offramp.crypto_received` | same |
| `offramp.crypto_confirmed` | same |
| `offramp.fiat_initiated` | same |
| `offramp.completed` | same |
| `offramp.failed` | same |
| `offramp.cancelled` | same |
| `offramp.refunded` | same |
| `offramp.expired` | same |

Ramp `eventType` values are **collapsed**. Several internal statuses map to one event; a move inside the same bucket does not emit again. `data.status` is the **internal status at emit time**, not the event name.

---

## Identity and KYB

### `user.created`

Emitted when a new user row is inserted. Idempotent replay of an existing user does not emit.

`data`

| Field | Type | Values |
|---|---|---|
| `userId` | UUID | |
| `status` | string | `active` \| `inactive` \| `suspended` |
| `kybStatus` | string | `not_started` \| `incomplete` \| `under_review` \| `approved` \| `rejected` \| `suspended` |
| `createdAt` | ISO-8601 UTC | |

```json
{
  "eventId": "11111111-1111-4111-8111-111111111111",
  "eventType": "user.created",
  "occurredAt": "2026-08-14T14:00:00.000Z",
  "data": {
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "status": "active",
    "kybStatus": "not_started",
    "createdAt": "2026-08-14T14:00:00.000Z"
  }
}
```

### `kyb.status_updated`

Emitted only when `kybStatus` actually changes (submit `not_started`/`incomplete` → `under_review`, or inbound KYB decision). Draft KYB saves do not emit.

`data`

| Field | Type | Values |
|---|---|---|
| `userId` | UUID | |
| `kybStatus` | string | New status (`not_started` \| `incomplete` \| `under_review` \| `approved` \| `rejected` \| `suspended`) |
| `previousStatus` | string | Status before this change |
| `rails` | string[] | Optional. Present only when the inbound KYB payload included a non-empty rails list (e.g. `["USD"]`). Submit-path events omit this key. |

Submit:

```json
{
  "eventId": "22222222-2222-4222-8222-222222222222",
  "eventType": "kyb.status_updated",
  "occurredAt": "2026-08-14T14:05:00.000Z",
  "data": {
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "previousStatus": "not_started",
    "kybStatus": "under_review"
  }
}
```

Inbound approval (with rails):

```json
{
  "eventId": "33333333-3333-4333-8333-333333333333",
  "eventType": "kyb.status_updated",
  "occurredAt": "2026-08-14T16:00:00.000Z",
  "data": {
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "kybStatus": "approved",
    "previousStatus": "under_review",
    "rails": ["USD"]
  }
}
```

---

## Account

`rail` is `onramp` or `offramp`. `type` is the account label (commonly `primary`).

### `account.created`

New account row. Idempotent `creationRequestId` replay does not emit. Capabilities are **not** included here; named-VA issuance uses `account.capabilities.updated`.

```json
{
  "eventId": "44444444-4444-4444-8444-444444444444",
  "eventType": "account.created",
  "occurredAt": "2026-08-14T14:10:00.000Z",
  "data": {
    "accountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "rail": "onramp",
    "type": "primary"
  }
}
```

Offramp create uses the same shape with `"rail": "offramp"`.

### `account.updated`

Offramp destination update succeeded.

```json
{
  "eventId": "55555555-5555-4555-8555-555555555555",
  "eventType": "account.updated",
  "occurredAt": "2026-08-14T14:12:00.000Z",
  "data": {
    "accountId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "rail": "offramp",
    "type": "primary"
  }
}
```

### `account.deleted`

```json
{
  "eventId": "66666666-6666-4666-8666-666666666666",
  "eventType": "account.deleted",
  "occurredAt": "2026-08-14T14:20:00.000Z",
  "data": {
    "accountId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c"
  }
}
```

### `account.capabilities.updated`

Emitted when mapped `capabilities.usdNamedDeposit.status` **changes** (`not_started` \| `pending` \| `active` \| `failed`). Unchanged status (including `pending` → `pending`) does not emit.

`data`

| Field | Type | Notes |
|---|---|---|
| `accountId` | UUID | |
| `userId` | UUID | |
| `capabilities.usdNamedDeposit.status` | string | `not_started` \| `pending` \| `active` \| `failed` |
| `capabilities.usdNamedDeposit.failureReason` | string \| null | Set when `failed`; otherwise `null`. Provider brand names are stripped. |
| `depositDetails` | object | Present **only** when status is `active` and deposit instructions exist. |

Pending:

```json
{
  "eventId": "77777777-7777-4777-8777-777777777777",
  "eventType": "account.capabilities.updated",
  "occurredAt": "2026-08-14T14:10:05.000Z",
  "data": {
    "accountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "capabilities": {
      "usdNamedDeposit": {
        "status": "pending",
        "failureReason": null
      }
    }
  }
}
```

Active (named deposit instructions available):

```json
{
  "eventId": "88888888-8888-4888-8888-888888888888",
  "eventType": "account.capabilities.updated",
  "occurredAt": "2026-08-14T14:15:00.000Z",
  "data": {
    "accountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "capabilities": {
      "usdNamedDeposit": {
        "status": "active",
        "failureReason": null
      }
    },
    "depositDetails": {
      "bankName": "Oval Bank",
      "accountNumber": "9992740191426913",
      "routingNumber": "084106768",
      "accountHolderName": "Gilles Eykelberg",
      "reference": "GRAPH-1",
      "country": "US"
    }
  }
}
```

`depositDetails.country` is optional. `reference` may be `null`.

Failed:

```json
{
  "eventId": "99999999-9999-4999-8999-999999999999",
  "eventType": "account.capabilities.updated",
  "occurredAt": "2026-08-14T14:16:00.000Z",
  "data": {
    "accountId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "capabilities": {
      "usdNamedDeposit": {
        "status": "failed",
        "failureReason": "Identity verification could not be completed"
      }
    }
  }
}
```

The same HTTP create may emit `account.created` and then `account.capabilities.updated`.

---

## Onramp

### Onramp `data`

Shared by every `onramp.*` event.

| Field | Type | Notes |
|---|---|---|
| `onrampId` | UUID | |
| `userId` | UUID | |
| `txnRef` | string | Platform transaction reference |
| `status` | string | Internal status **at emit time** (see mapping below) |
| `failedReason` | string | Optional. Present when the row has a failure message (brands stripped). |
| `transactionHash` | string | Optional. Present when `receipt.transactionHash` is a string (typically `onramp.completed`). |

### Status → `eventType`

| Internal `status` | `eventType` |
|---|---|
| `CREATED`, `AWAITING_FUNDS` | `onramp.created` |
| `FIAT_PENDING`, `FIAT_PROCESSED` | `onramp.fiat_received` |
| `CRYPTO_INITIATED`, `CRYPTO_PENDING` | `onramp.crypto_initiated` |
| `COMPLETED` | `onramp.completed` |
| `FIAT_FAILED`, `FIAT_RETURNED`, `CRYPTO_FAILED` | `onramp.failed` |
| `EXPIRED` | `onramp.expired` |

Create usually inserts `AWAITING_FUNDS`, so the first event is `onramp.created` with that status. `FIAT_PENDING` → `FIAT_PROCESSED` does not emit a second `onramp.fiat_received`. Same for `CRYPTO_INITIATED` → `CRYPTO_PENDING`.

### `onramp.created`

```json
{
  "eventId": "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "eventType": "onramp.created",
  "occurredAt": "2026-08-14T15:00:00.000Z",
  "data": {
    "onrampId": "c0ffee00-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "ON-c4a18b6e3a71f02d4e5b9c08",
    "status": "AWAITING_FUNDS"
  }
}
```

### `onramp.fiat_received`

```json
{
  "eventId": "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "eventType": "onramp.fiat_received",
  "occurredAt": "2026-08-14T15:10:00.000Z",
  "data": {
    "onrampId": "c0ffee00-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "ON-c4a18b6e3a71f02d4e5b9c08",
    "status": "FIAT_PENDING"
  }
}
```

### `onramp.crypto_initiated`

```json
{
  "eventId": "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "eventType": "onramp.crypto_initiated",
  "occurredAt": "2026-08-14T15:20:00.000Z",
  "data": {
    "onrampId": "c0ffee00-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "ON-c4a18b6e3a71f02d4e5b9c08",
    "status": "CRYPTO_INITIATED"
  }
}
```

### `onramp.completed`

```json
{
  "eventId": "aaaaaaa4-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  "eventType": "onramp.completed",
  "occurredAt": "2026-08-14T15:30:00.000Z",
  "data": {
    "onrampId": "c0ffee00-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "ON-c4a18b6e3a71f02d4e5b9c08",
    "status": "COMPLETED",
    "transactionHash": "0x8f3a1b2c4d5e6f7890abcdef1234567890abcdef1234567890abcdef12345678"
  }
}
```

### `onramp.failed`

`status` is one of `FIAT_FAILED`, `FIAT_RETURNED`, `CRYPTO_FAILED`.

```json
{
  "eventId": "aaaaaaa5-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
  "eventType": "onramp.failed",
  "occurredAt": "2026-08-14T15:40:00.000Z",
  "data": {
    "onrampId": "c0ffee00-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "ON-c4a18b6e3a71f02d4e5b9c08",
    "status": "FIAT_FAILED",
    "failedReason": "Deposit could not be matched"
  }
}
```

### `onramp.expired`

```json
{
  "eventId": "aaaaaaa6-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
  "eventType": "onramp.expired",
  "occurredAt": "2026-08-14T23:00:00.000Z",
  "data": {
    "onrampId": "c0ffee00-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "ON-c4a18b6e3a71f02d4e5b9c08",
    "status": "EXPIRED"
  }
}
```

---

## Offramp

### Offramp `data`

Shared by every `offramp.*` event.

| Field | Type | Notes |
|---|---|---|
| `offrampId` | UUID | |
| `userId` | UUID | |
| `txnRef` | string | Platform transaction reference |
| `status` | string | Internal status **at emit time** (see mapping below) |
| `failedReason` | string | Optional. Present when the row has a failure message (brands stripped). |
| `transactionHash` | string | Optional. Present when `receipt.transactionHash` is a string (typically `offramp.completed`). |

### Status → `eventType`

| Internal `status` | `eventType` |
|---|---|
| `CREATED`, `AWAITING_CRYPTO` | `offramp.created` |
| `CRYPTO_PENDING`, `CRYPTO_RECEIVED` | `offramp.crypto_received` |
| `CRYPTO_CONFIRMED` | `offramp.crypto_confirmed` |
| `FIAT_INITIATED`, `FIAT_PENDING` | `offramp.fiat_initiated` |
| `COMPLETED` | `offramp.completed` |
| `FAILED`, `CRYPTO_FAILED`, `FIAT_FAILED` | `offramp.failed` |
| `CANCELLED` | `offramp.cancelled` |
| `REFUNDED` | `offramp.refunded` |
| `EXPIRED` | `offramp.expired` |

`PROCESSING_FEE` and `FEE_PROCESSED` do not emit. Create usually inserts `AWAITING_CRYPTO`. `CRYPTO_PENDING` → `CRYPTO_RECEIVED` does not emit twice; same for `FIAT_INITIATED` → `FIAT_PENDING`.

### `offramp.created`

```json
{
  "eventId": "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  "eventType": "offramp.created",
  "occurredAt": "2026-08-14T16:00:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "AWAITING_CRYPTO"
  }
}
```

### `offramp.crypto_received`

```json
{
  "eventId": "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  "eventType": "offramp.crypto_received",
  "occurredAt": "2026-08-14T16:10:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "CRYPTO_PENDING"
  }
}
```

### `offramp.crypto_confirmed`

```json
{
  "eventId": "bbbbbbb3-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
  "eventType": "offramp.crypto_confirmed",
  "occurredAt": "2026-08-14T16:12:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "CRYPTO_CONFIRMED"
  }
}
```

### `offramp.fiat_initiated`

```json
{
  "eventId": "bbbbbbb4-bbbb-4bbb-8bbb-bbbbbbbbbbb4",
  "eventType": "offramp.fiat_initiated",
  "occurredAt": "2026-08-14T16:20:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "FIAT_INITIATED"
  }
}
```

### `offramp.completed`

```json
{
  "eventId": "bbbbbbb5-bbbb-4bbb-8bbb-bbbbbbbbbbb5",
  "eventType": "offramp.completed",
  "occurredAt": "2026-08-14T16:30:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "COMPLETED",
    "transactionHash": "0xabc123def4567890abcdef1234567890abcdef1234567890abcdef1234567890"
  }
}
```

### `offramp.failed`

`status` is one of `FAILED`, `CRYPTO_FAILED`, `FIAT_FAILED`.

```json
{
  "eventId": "bbbbbbb6-bbbb-4bbb-8bbb-bbbbbbbbbbb6",
  "eventType": "offramp.failed",
  "occurredAt": "2026-08-14T16:40:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "FIAT_FAILED",
    "failedReason": "Payout destination was rejected"
  }
}
```

### `offramp.cancelled`

```json
{
  "eventId": "bbbbbbb7-bbbb-4bbb-8bbb-bbbbbbbbbbb7",
  "eventType": "offramp.cancelled",
  "occurredAt": "2026-08-14T16:41:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "CANCELLED"
  }
}
```

### `offramp.refunded`

```json
{
  "eventId": "bbbbbbb8-bbbb-4bbb-8bbb-bbbbbbbbbbb8",
  "eventType": "offramp.refunded",
  "occurredAt": "2026-08-14T16:42:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "REFUNDED"
  }
}
```

### `offramp.expired`

```json
{
  "eventId": "bbbbbbb9-bbbb-4bbb-8bbb-bbbbbbbbbbb9",
  "eventType": "offramp.expired",
  "occurredAt": "2026-08-14T23:00:00.000Z",
  "data": {
    "offrampId": "d00dad00-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "userId": "9eea8cbd-e545-4d15-85cd-90690ede4b0c",
    "txnRef": "OFF-c4a18b6e3a71f02d4e5b9c08",
    "status": "EXPIRED"
  }
}
```
