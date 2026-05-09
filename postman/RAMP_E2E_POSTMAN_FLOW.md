# Postman: On-ramp & Off-ramp E2E Test Flow

Step-by-step order for exercising **Liquidity Orchestrator** integrations end-to-end from Postman. Use the bundled collection `api_bloxfi.postman_collection.json` where requests exist; this doc fills gaps and ordering.

---

## Authentication note (“skip auth” for flow testing)

The BloxFi API **does not** expose ramp routes without credentials: `/api/v1/users`, `/accounts`, `/wallets`, `/onramps`, `/offramps`, `/networks`, `/coins` all expect **`Authorization: Bearer <token>`**.

**Practical approach for this guide**

1. Set collection variable **`apiKey`** to the same value as server env **`API_KEY`**.
2. Keep **collection auth** = **Bearer Token** → `{{apiKey}}` so you do not repeat auth on each folder.
3. **Do not** send Bearer on **webhooks** — those folders override auth to **No Auth** and use **`webhookSecret`** + HMAC instead.

Only **`GET /ready`**, **`GET /api/v1/health`**, and **`POST /api/v1/webhooks`** are callable without the API key (webhooks still require valid **`X-Webhook-Signature`**).

---

## Runtime dependencies (must be true before Postman)

| Dependency | Why |
|------------|-----|
| **PostgreSQL + Redis** | App persistence and idempotency; verify with **`GET {{baseUrl}}/ready`** → `database` / `redis` = `ok`. |
| **`.env`** | `DATABASE_URL`, `REDIS_URL`, `API_KEY`, `PALREMIT_LIQUIDITY_*`, `PALREMIT_CURRENCY_URL` (optional), **`WEBHOOK_SECRET`** (must match Postman **`webhookSecret`**). |
| **Palremit connectivity** | Liquidity + Currency APIs reachable from your machine/hosting; invalid credentials → 401/502 on ramps. |
| **KYB-approved user for rails** | Create User → KYB documents → Submit KYB → rails **`approved`** for **fiat currency** you use (e.g. NGN for Nigeria accounts). |

---

## Collection variables to set / watch

| Variable | Purpose |
|----------|---------|
| `baseUrl` | e.g. `http://localhost:3000` |
| `apiKey` | Bearer secret (must match server env `API_KEY`) |
| `webhookSecret` | Same as server `WEBHOOK_SECRET` |
| `requestId` | UUID; pre-request scripts refresh on idempotent POSTs |
| `networksCoinCode` | Coin for network list (e.g. `USDT`, `USDC`) |
| `onrampFiatAssetCode` | Fiat asset in simulated **`deposit.credited`** (match Create Onramp `source.currency`) |
| `offrampCryptoAssetCode` / `offrampCryptoNetwork` | Match Create Offramp `source.currency` / resolved `chain` |
| `palremitProvisionedAccountId` | **Manual:** copy from DB after create — `providerRefs.palremitOrchestrator.provisionedAccountId` (API does not return it). |
| Auto-saved | `userId`, `accountId`, `walletId`, `onrampId`, `onrampTxnRef`, `offrampId`, `offrampTxnRef` — from test scripts where configured |

---

## Network validation (before building ramp bodies)

**Goal:** Use a **`chain`** value Palremit accepts for that asset (canonical codes from their catalogue).

1. **`GET {{baseUrl}}/api/v1/networks?coin={{networksCoinCode}}`**  
   - Example: `coin=USDT` or `coin=USDC`.  
   - **200** → `data.networks[].code` — pick one (e.g. `BEP20`, `TRC20`, `MATIC`).  
   - Use that string for **Create Onramp** `destination.chain` and **Create Offramp** `source.chain` (server resolves aliases but provision expects orchestrator codes).

2. **`GET {{baseUrl}}/api/v1/coins`** (optional) — list supported assets.

3. **Wallet `chain`** must align with the network you’ll use for crypto leg (same string family as networks list).

---

## On-ramp flow (fiat → crypto)

### A. Prerequisites (single ordered pass)

| Step | Request | Expect |
|------|---------|--------|
| 1 | `GET /ready` | 200 — DB + Redis ok |
| 2 | `POST /api/v1/users` | **201** — save **`userId`** (script may set variable) |
| 3 | KYB: update KYB → upload file → attach docs → **submit KYB** | Until rail you need is **approved** (check `GET .../kyb/status`) |
| 4 | `POST .../accounts` (onramp rail, matches destination fiat region) | **200** — **`accountId`** |
| 5 | `POST .../wallets/external` | **200/201** — **`walletId`**; **`chain`** = network code from step above |

User must have **`businessInfo.email`** for Palremit fiat provision.

### B. Create on-ramp

| Step | Request | Notes |
|------|---------|--------|
| 6 | `GET /api/v1/onramps/rates` | Sanity-check pair |
| 7 | **`POST /api/v1/onramps`** | Header **`requestId`** = body `requestId`; fresh UUID each time. Expect **`AWAITING_FUNDS`**, **`txnRef`** saved as **`onrampTxnRef`**. |

### C. Deposit confirmation (fiat) — webhook

Palremit sends **`deposit.credited`** with **`data.client_reference`** = **`txnRef`** and matching **`provisioned_account_id`**.

| Step | Action |
|------|--------|
| 8 | Read **`palremitProvisionedAccountId`** from DB (`Onramp.providerRefs.palremitOrchestrator.provisionedAccountId`). Set collection variable. |
| 9 | **`POST /api/v1/webhooks`** — folder **Palremit: deposit.credited (onramp fiat)** | No Bearer. Set **`webhookSecret`**. Script sets **`X-Liquidity-Event-Id`** + **`X-Webhook-Signature`**. Ensure **`onrampFiatAssetCode`** matches fiat currency. |

After success, on-ramp should move toward **`FIAT_PROCESSED`** / crypto payout path (server may call orchestrator withdrawal).

### D. Advance / payout confirmation

| Step | Request | Status transitions (typical) |
|------|---------|------------------------------|
| 10 | **`GET /api/v1/onramps/{{onrampId}}`** | Poll until **`CRYPTO_PENDING`** / **`COMPLETED`** or failure. GET may trigger crypto withdrawal after fiat is processed. |
| 11 | Optional: **`POST /api/v1/webhooks`** — **Palremit: withdrawal.successful (onramp crypto)** | Simulates orchestrator confirming crypto send; include matching **`withdrawal.id`** if DB already stores **`palremitWithdrawalId`**. |

### Webhook handling checklist (on-ramp)

- **`X-Liquidity-Event-Id`**: unique per delivery — retries dedupe on server.  
- **`X-Webhook-Signature`**: HMAC-SHA256 of **raw JSON body** using **`WEBHOOK_SECRET`**.  
- Body shape: orchestrator envelope **`event_id`**, **`event_type`**, **`occurred_at`**, **`data`** (see collection prerequest scripts).

---

## Off-ramp flow (crypto → fiat)

### A. Prerequisites

Same user must be **KYB-approved** for **destination fiat currency** (`getKybRailStatuses` includes that currency).

| Step | Request |
|------|---------|
| 1–3 | Same user + KYB as on-ramp |
| 4 | **`POST .../accounts`** (offramp rail / payout bank) if different — **`accountId`** |
| 5 | **`POST .../wallets/external`** — **`walletId`** on the **source crypto network** |

### B. Network validation (off-ramp source)

1. **`GET /api/v1/networks?coin=USDT`** (or your source asset).  
2. Set **`source.chain`** in Create Offramp to a listed **`code`** (e.g. `BEP20`, not an informal label).  
3. Align **`offrampCryptoNetwork`** / **`offrampCryptoAssetCode`** with webhook simulations.

### C. Create off-ramp

| Step | Request | Notes |
|------|---------|--------|
| 6 | `GET /api/v1/offramps/rates` | Optional |
| 7 | **`POST /api/v1/offramps`** | **`requestId`** header = body; **`platformFee.walletAddress`** + **`destination.purposeOfPayment`** required. Expect **`AWAITING_CRYPTO`**, **`offrampTxnRef`**. |

### D. Deposit confirmation (crypto)

| Step | Action |
|------|--------|
| 8 | DB → **`palremitProvisionedAccountId`** for this off-ramp (same path as on-ramp). |
| 9 | **`POST /api/v1/webhooks`** — **Palremit: deposit.credited (offramp crypto)** | **`CRYPTO_DEPOSIT`** mode; **`client_reference`** = **`offrampTxnRef`**; asset/network match source. |

### E. Payout / withdrawal confirmation (fiat out)

| Step | Request | Typical statuses |
|------|---------|-------------------|
| 10 | **`GET /api/v1/offramps/{{offrampId}}`** | **`CRYPTO_CONFIRMED`** → **`FIAT_PENDING`** / **`COMPLETED`** after server + Palremit. Poll. |
| 11 | Optional real/simulated **`withdrawal.successful`** orchestrator webhook | **`FIAT_WITHDRAWAL`** branch for off-ramp completion (collection may add a template mirroring on-ramp withdrawal request). |

---

## Status transitions (reference)

### On-ramp

`AWAITING_FUNDS` → (fiat **`deposit.credited`**) → **`FIAT_PROCESSED`** → (**GET** may trigger withdrawal) → **`CRYPTO_PENDING`** → (**`withdrawal.successful`**) → **`COMPLETED`** (or **`FAILED`** / **`CRYPTO_FAILED`**).

### Off-ramp

`AWAITING_CRYPTO` → (**crypto **`deposit.credited`**) → **`CRYPTO_CONFIRMED`** → (**GET** may start fiat withdrawal) → **`FIAT_PENDING`** / **`FIAT_INITIATED`** → (**`withdrawal.successful`** fiat) → **`COMPLETED`**.

Exact enums are defined in application types (`OnrampStatus`, `OfframpStatus`).

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| **401** on ramps | `apiKey` matches server env `API_KEY` |
| **422** KYB | Rail not approved for currency |
| **502** Palremit | Liquidity URL + Bearer secret; Currency URL for rates |
| Empty **networks** | **`coin`** query present; Palremit catalogue reachable |
| Webhook **401** | **`X-Webhook-Signature`** wrong or body altered after signing |
| Duplicate webhook ignored | Same **`X-Liquidity-Event-Id`** — use new UUID per send in Postman scripts |
| Provision **400 Idempotency** | Ensure liquidity adapter forwards **`Idempotency-Key`** (server fix); redeploy |

---

## Minimal Postman folder order (copy-paste checklist)

```
[ ] Health / Ready
[ ] Coins (optional) + Networks (validate chain codes)
[ ] User → KYB chain → Account (onramp) → Wallet
[ ] Onramps: Rates → Create → (DB: provisioned account id) → Webhook deposit.credited fiat → Get Onramp → (optional withdrawal.successful crypto)
[ ] Account (offramp) if needed → Wallet aligned to crypto network
[ ] Offramps: Rates → Create → Webhook deposit.credited crypto → Get Offramp → (withdrawal successful fiat when scripted)
```

This document is the single reference for **Postman-only** ramp QA; pair it with `postman/README.md` for variable names and request naming.
