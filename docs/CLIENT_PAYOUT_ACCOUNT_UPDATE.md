# Client guide: payout accounts and changing corridor requirements

Payout provider requirements can change over time (for example, when a corridor moves from one liquidity provider to another). A beneficiary account created months ago may be missing fields that are required **today**.

**Recommended pattern:** before initiating or retrying a fiat payout, fetch the **live withdrawal corridor**, compare it to the stored account destination, update the account if anything is missing, then call payout. BloxFi and Palremit Liquidity still validate at PUT and at payout — the pre-check avoids avoidable failures.

---

## Primary flow (proactive — call corridor before payout)

Use this **before** creating an offramp, and again **before** retrying payout on an existing offramp:

```
1. GET account           → providerPayout.corridor + destination
2. GET payout corridor   → live destinationFields[] for that corridor
3. Diff                  → any required path missing or empty on the account?
4. PUT account           → (only if step 3 found gaps) merge missing fields
5. Create offramp / retry payout
```

You do **not** need to compare against `requirementsSnapshot` on the account — that is a historical record from create/update time. Always diff against the **live corridor** response.

### How to diff

For each field in `destinationFields[]`:

1. Skip `beneficiary.type` (set from corridor).
2. Evaluate `required` and `conditional_required` using the account's current `destination` values (e.g. if `beneficiary.address.country` is `AE`, apply UAE conditional rules).
3. Resolve the field `path` on `providerPayout.destination` (dot paths like `beneficiary.email`).
4. Treat a value as missing if it is `null`, `undefined`, or `""`.

**Legacy wire keys:** if the account has `swift_code` or `routing_number` but the corridor requires `bank_code`, you can either map mentally or rely on BloxFi — PUT and payout normalize `swift_code` / `routing_number` → `bank_code` server-side. A PUT with no body changes still won't refresh normalization; send a PUT only when you have real gaps, or GET the account after any update to confirm `bank_code` is present.

If the diff is empty → proceed straight to payout.

If the diff is non-empty → collect the missing values from the user, `PUT` the account, then payout.

### When to run the pre-check

| Moment | Why |
|--------|-----|
| Before `POST /offramps` | Fix account while crypto is still in flight |
| Before `POST .../retry-fiat-payout` | Fix stuck `CRYPTO_CONFIRMED` offramps |
| Periodically for saved beneficiaries | Optional; catches provider switches before the next transfer |

---

## Reactive flow (payout already failed)

If you skipped the pre-check and payout failed:

```
1. GET offramp          → destination.accountId + error (if surfaced)
2. GET account          → current destination
3. GET payout corridor  → live requirements (same as proactive step 2)
4. PUT account          → merge missing fields
5. POST retry payout
6. GET offramp          → confirm FIAT_PENDING
```

Typical failure:

```json
{
  "code": "FIAT_PAYOUT_NOT_INITIATED",
  "message": "payout_requirements_invalid: destination.fields failed validation"
}
```

Palremit returns field-level `details[]` on the liquidity call; use those paths together with the corridor diff.

---

## What the pre-check does *not* guarantee

Calling the corridor first is the right approach. A few things it will **not** catch — payout can still fail for other reasons:

| Gap | Handled by |
|-----|-----------|
| Missing beneficiary fields | Corridor diff + PUT ✓ |
| Legacy key names (`swift_code`) | BloxFi normalize on PUT/payout ✓ |
| Business not onboarded with provider (`provider_customer_not_onboarded`) | Palremit business-provider setup — not in corridor fields |
| Amount out of corridor min/max | Palremit at `POST /v1/withdrawals` |
| Provider-specific value rules (patterns, enums) | Palremit at payout (BloxFi PUT checks presence/structure only) |
| Requirements change between your corridor GET and payout | Rare; payout validation is the final gate |

So: **corridor → diff → PUT → payout** is correct. Keep handling payout errors as a fallback, not the only path.

---

## API reference

### GET account

```http
GET /api/v1/users/{userId}/accounts/{accountId}
Authorization: Bearer {apiKey}
```

Response includes `providerPayout`:

- `corridor` — asset, country, `destinationType`, `beneficiaryType` (**cannot be changed** via PUT)
- `destination` — canonical snake_case fields used for payout
- `requirementsSnapshot` — informational only; **do not** use for the diff

### GET payout corridor

```http
GET /api/v1/payout-corridors/{asset}/{country}/{destinationType}/{beneficiaryType}
Authorization: Bearer {apiKey}
```

Use `destinationFields[]` for the diff. Example: `GET /api/v1/payout-corridors/AED/AE/local_bank/individual`

### PUT account (only if diff found gaps)

```http
PUT /api/v1/users/{userId}/accounts/{accountId}
Authorization: Bearer {apiKey}
Content-Type: application/json

{
  "destination": {
    "beneficiary": {
      "email": "beneficiary@example.com",
      "phone_number": "+971501234567"
    }
  }
}
```

### PUT rules

| Rule | Detail |
|------|--------|
| Partial updates | Only include keys you are adding or changing |
| Corridor fixed | Cannot change `corridor` (asset/country/rail/beneficiary type) — create a new account instead |
| Validation | `400 INVALID_REQUEST` if merged destination still fails current corridor requirements |
| Normalization | Legacy `swift_code` / `routing_number` are mapped to `bank_code` server-side |
| Phone format | E.164: `+` country code + digits (e.g. `+971501234567`) |

### Success response

`200` — full account object (same shape as GET account), with updated `providerPayout.destination` and refreshed `requirementsSnapshot.fetchedAt`.

### Validation error example

```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "beneficiary.email: Beneficiary email is required"
  }
}
```

Fix the listed paths and call PUT again.

### POST retry fiat payout (after account is complete)

```http
POST /api/v1/offramps/{offrampId}/retry-fiat-payout
Authorization: Bearer {apiKey}
requestId: {uuid}
Content-Type: application/json

{ "userId": "{userId}" }
```

| Result | HTTP | Meaning |
|--------|------|---------|
| Payout started | `200` | `retry.status` = `initiated`, `withdrawalId` set |
| Already sent | `200` | `retry.status` = `already_initiated` (safe to poll) |
| Still invalid data | `422` | `FIAT_PAYOUT_NOT_INITIATED` — fix account and retry |
| Wrong status | `422` | Offramp not in `CRYPTO_CONFIRMED` |

`requestId` header required.

### GET offramp (poll)

```http
GET /api/v1/offramps/{offrampId}
Authorization: Bearer {apiKey}
```

Expect transition to `FIAT_PENDING` after a successful retry.

---

## Complete example (AED local bank)

Account created under OwlPay (`swift_code`, no email/phone). Corridor now requires `bank_code`, `beneficiary.email`, `beneficiary.phone_number`.

**1. GET corridor** → note required fields  
**2. GET account** → diff finds email + phone missing  
**3. PUT account**

```http
PUT /api/v1/users/2902e329-424e-4cba-b07b-346ec74b7124/accounts/a0c5ae15-bf02-43e9-8d1e-dada8884362e

{
  "destination": {
    "beneficiary": {
      "email": "matisse@example.com",
      "phone_number": "+971501234567"
    }
  }
}
```

BloxFi normalizes `swift_code` → `bank_code` on PUT.

**4. Retry payout**

```http
POST /api/v1/offramps/70e51ed7-3f01-4acb-86aa-8731a1cda1d4/retry-fiat-payout

{ "userId": "2902e329-424e-4cba-b07b-346ec74b7124" }
```

---

## Integration checklist

1. **Before every payout path:** GET live corridor → diff against account → PUT if needed.
2. **On account create:** same corridor GET to build the initial form (collect full required set).
3. Prefer canonical field names from discovery (`bank_code`, not `swift_code`).
4. Do **not** rely on `requirementsSnapshot` for “is my account still valid?” — always use live corridor.
5. Still handle payout `422` / `FIAT_PAYOUT_NOT_INITIATED` as fallback (provider onboarding, amount limits, etc.).

---

## Quick reference

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/payout-corridors/...` | GET | Current required fields |
| `/api/v1/users/{userId}/accounts` | POST | Create account |
| `/api/v1/users/{userId}/accounts/{accountId}` | GET | Read account |
| `/api/v1/users/{userId}/accounts/{accountId}` | **PUT** | Merge destination + re-validate |
| `/api/v1/offramps/{id}/retry-fiat-payout` | POST | Retry fiat withdrawal after fix |

---

## Support

If PUT succeeds but retry still fails with `provider_customer_not_onboarded`, the business must be onboarded with the active payout provider (OwlPay/Yativo) in Palremit Liquidity before payouts can proceed. That is separate from beneficiary field updates.
