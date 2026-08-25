# BloxFi webhooks

We send HTTPS POSTs to your webhook URL when a user, KYB status, account, onramp, or offramp changes in a way that matters.

Use `eventType` to decide what happened. Use `eventId` to ignore duplicates. Use `data` for ids and status; fetch the full resource from the API if you need more than the payload includes.

---

## Delivery

| | |
|---|---|
| Method | `POST` |
| URL | The HTTPS endpoint you give us |
| Body | JSON (see [Envelope](#envelope)) |
| Timeout | 5 seconds |
| Success | Any `2xx` |
| Retries | Up to 3 attempts for the same `eventId` if we do not get a `2xx` |

**Headers**

```
Content-Type: application/json
X-Webhook-Signature: <hmac>
```

`X-Webhook-Signature` is a 64-character lowercase hex **HMAC-SHA256** of the **exact raw request body**, using the signing secret we share with you. There is no `sha256=` prefix.

Verify the signature before you parse or act on the body. Compute HMAC-SHA256 over the raw bytes you received and compare it to the header in constant time.

Node.js:

```js
const crypto = require('crypto');

function isValidSignature(rawBody, header, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(header, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Treat `eventId` as an idempotency key. We reuse the same `eventId` on retries; do not process the same id twice.

Optional fields are **omitted** when unknown, not sent as `null`, unless a sample below shows `null`.

---

## Envelope

Every request body looks like this. Only `data` changes per event.

```json
{
  "eventId": "3d2c1b0a-1111-4111-8111-aaaaaaaaaaaa",
  "eventType": "user.created",
  "occurredAt": "2026-08-14T14:00:00.000Z",
  "data": {}
}
```

| Field | Type | Description |
|---|---|---|
| `eventId` | UUID | Unique id for this event. Same value on retries. |
| `eventType` | string | One of the types listed below. |
| `occurredAt` | string | ISO-8601 UTC timestamp. |
| `data` | object | Event payload. |

---

## Event catalog

| `eventType` | When you receive it |
|---|---|
| `user.created` | A new business user was created. |
| `kyb.status_updated` | That user’s KYB status changed. |
| `account.created` | A new onramp or offramp account was created. |
| `account.updated` | An offramp account destination was updated. |
| `account.deleted` | An account was deleted. |
| `account.capabilities.updated` | Named USD deposit readiness changed (`pending` / `active` / `failed`). |
| `onramp.created` | An onramp was created and is waiting for fiat. |
| `onramp.fiat_received` | Fiat for that onramp has been received. |
| `onramp.crypto_initiated` | Crypto payout has started. |
| `onramp.completed` | Onramp finished; crypto was sent. |
| `onramp.failed` | Onramp failed (fiat or crypto). |
| `onramp.expired` | Onramp expired before completion. |
| `offramp.created` | An offramp was created and is waiting for crypto. |
| `offramp.crypto_received` | Crypto for that offramp has been received. |
| `offramp.crypto_confirmed` | Received crypto is confirmed. |
| `offramp.fiat_initiated` | Fiat payout has started. |
| `offramp.completed` | Offramp finished; fiat was sent. |
| `offramp.failed` | Offramp failed (crypto or fiat). |
| `offramp.cancelled` | Offramp was cancelled. |
| `offramp.refunded` | Offramp was refunded. |
| `offramp.expired` | Offramp expired before completion. |

Onramps and offramps send **one webhook per milestone**, not one per every status the REST API can return. `data.status` is the resource status at the time of the event (same values as `GET /onramps/:id` and `GET /offramps/:id`). You may see `onramp.fiat_received` with `status: "FIAT_PENDING"`; you will not get a second webhook when that onramp later becomes `FIAT_PROCESSED`.

---

## Users and KYB

### `user.created`

A new user. Creating the same user again (idempotent retry) does not send another webhook.

`data`

| Field | Type | Values |
|---|---|---|
| `userId` | UUID | |
| `status` | string | `active`, `inactive`, `suspended` |
| `kybStatus` | string | `not_started`, `incomplete`, `under_review`, `approved`, `rejected`, `suspended` |
| `createdAt` | string | ISO-8601 UTC |

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

Sent only when `kybStatus` changes (for example submit → `under_review`, or a decision → `approved` / `rejected`). Saving a KYB draft does not send a webhook.

`data`

| Field | Type | Description |
|---|---|---|
| `userId` | UUID | |
| `kybStatus` | string | New status. Same values as above. |
| `previousStatus` | string | Status before this change. |
| `rails` | string[] | Optional. Present on some decision events (e.g. `["USD"]`). |

Submitted for review:

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

Approved:

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

## Accounts

`rail` is `onramp` or `offramp`. `type` is the account label you sent on create (often `primary`).

### `account.created`

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

Offramp accounts use the same shape with `"rail": "offramp"`.

Named USD deposit instructions are **not** on this event. Wait for `account.capabilities.updated`.

### `account.updated`

Offramp payout destination was changed.

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

Sent when `capabilities.usdNamedDeposit.status` changes. Unchanged status (for example still `pending`) does not send another webhook.

`data`

| Field | Type | Description |
|---|---|---|
| `accountId` | UUID | |
| `userId` | UUID | |
| `capabilities.usdNamedDeposit.status` | string | `not_started`, `pending`, `active`, `failed` |
| `capabilities.usdNamedDeposit.failureReason` | string \| null | Set when `failed`; otherwise `null`. Identity / named-deposit KYC failures include the reason with provider brand names removed. |
| `depositDetails` | object | Present only when status is `active` and bank details are available. |

Issuance in progress:

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

Named deposit account is ready to receive USD:

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
      "reference": "VA-184729",
      "country": "US"
    }
  }
}
```

`depositDetails.country` may be omitted. `reference` may be `null`.

Issuance failed:

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
        "failureReason": "Poor image quality on the driving licence"
      }
    }
  }
}
```

Creating a named-USD onramp account can produce `account.created` and then one or more `account.capabilities.updated` events.

---

## Onramps (fiat → crypto)

All `onramp.*` events share this `data` shape.

| Field | Type | Description |
|---|---|---|
| `onrampId` | UUID | |
| `userId` | UUID | |
| `txnRef` | string | BloxFi transaction reference |
| `status` | string | Onramp status at this event (same as the GET onramp response) |
| `failedReason` | string | Optional. On `onramp.failed` when a reason is available. |
| `transactionHash` | string | Optional. Crypto payout hash when known (typically `onramp.completed`). |

Typical `status` values you will see on each event:

| `eventType` | `data.status` |
|---|---|
| `onramp.created` | `AWAITING_FUNDS` (sometimes `CREATED`) |
| `onramp.fiat_received` | `FIAT_PENDING` or `FIAT_PROCESSED` |
| `onramp.crypto_initiated` | `CRYPTO_INITIATED` or `CRYPTO_PENDING` |
| `onramp.completed` | `COMPLETED` |
| `onramp.failed` | `FIAT_FAILED`, `FIAT_RETURNED`, or `CRYPTO_FAILED` |
| `onramp.expired` | `EXPIRED` |

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

## Offramps (crypto → fiat)

All `offramp.*` events share this `data` shape.

| Field | Type | Description |
|---|---|---|
| `offrampId` | UUID | |
| `userId` | UUID | |
| `txnRef` | string | BloxFi transaction reference |
| `status` | string | Offramp status at this event (same as the GET offramp response) |
| `failedReason` | string | Optional. On `offramp.failed` when a reason is available. |
| `transactionHash` | string | Optional. Hash when known (typically `offramp.completed`). |

Typical `status` values you will see on each event:

| `eventType` | `data.status` |
|---|---|
| `offramp.created` | `AWAITING_CRYPTO` (sometimes `CREATED`) |
| `offramp.crypto_received` | `CRYPTO_PENDING` or `CRYPTO_RECEIVED` |
| `offramp.crypto_confirmed` | `CRYPTO_CONFIRMED` |
| `offramp.fiat_initiated` | `FIAT_INITIATED` or `FIAT_PENDING` |
| `offramp.completed` | `COMPLETED` |
| `offramp.failed` | `FAILED`, `CRYPTO_FAILED`, or `FIAT_FAILED` |
| `offramp.cancelled` | `CANCELLED` |
| `offramp.refunded` | `REFUNDED` |
| `offramp.expired` | `EXPIRED` |

Some intermediate statuses (for example fee processing) do not produce a webhook.

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
