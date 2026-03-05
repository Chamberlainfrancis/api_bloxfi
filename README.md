# BloxFi API

Aggregation API for fiat–crypto on-ramp and off-ramp. The platform owns user flows, KYB, orders, rates (via Currency API), and fees; a liquidity provider (e.g. Palremit) is used only for moving funds (deposits and withdrawals).

## Features

- **Users & KYB** — Business user creation, KYB information, document attachment, submission, status
- **Files** — Upload (e.g. S3 or local), max 10MB; PDF, JPEG, PNG
- **Wallets** — External crypto wallets (add, list, get, update, delete) per user
- **Accounts** — Fiat accounts for onramp/offramp (bank, PIX, region-specific)
- **Onramp** — Fiat → crypto: rates, create order, deposit instructions, status
- **Offramp** — Crypto → fiat: rates, create order, crypto deposit instructions, cancel
- **Limits** — Platform limits, user-effective limits, high-value requests
- **Webhooks** — Inbound LP webhooks (HMAC verification)
- **Auth** — Bearer API key (32 chars), validated against DB; optional JWT
- **Idempotency** — `requestId` header on state-changing POSTs (Redis-backed)
- **Rate limiting** — Redis-backed, configurable window and max requests

## Tech stack

- **Runtime:** Node.js ≥ 18
- **Language:** TypeScript
- **Framework:** Express
- **Database:** PostgreSQL (Prisma ORM)
- **Cache / state:** Redis (rate limit, idempotency)
- **Storage:** S3-compatible (optional) or local for file uploads
- **Validation:** Zod

## Prerequisites

- Node.js 18+
- PostgreSQL
- Redis
- (Optional) Docker for local DB/Redis via `docker compose`

## Installation

```bash
git clone <repo-url>
cd api_bloxfi
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, JWT_SECRET, etc.
npm run prisma:generate
npm run prisma:migrate
```

## Environment

Create `.env` from `.env.example`. Required:

| Variable        | Description                          |
|----------------|--------------------------------------|
| `DATABASE_URL` | PostgreSQL connection string         |
| `REDIS_URL`    | Redis connection string              |
| `JWT_SECRET`   | At least 32 characters               |

Optional / recommended:

| Variable                  | Description                                      |
|---------------------------|--------------------------------------------------|
| `PORT`                    | Server port (default `3000`)                     |
| `NODE_ENV`                | `development` \| `test` \| `production`        |
| `CORS_ORIGINS`            | Comma-separated origins (empty = permissive)    |
| `RATE_LIMIT_WINDOW_SECONDS` | Rate limit window (default 60)                |
| `RATE_LIMIT_MAX_REQUESTS` | Max requests per window per key (default 100)   |
| `IDEMPOTENCY_TTL_SECONDS` | TTL for idempotency keys in Redis (default 86400) |
| `S3_*`                    | S3-compatible storage for file uploads          |
| `CURRENCY_API_URL`        | Currency API for rates (onramp/offramp)         |
| `PALREMIT_*`              | Palremit liquidity/currency URLs and access key |
| `WEBHOOK_SECRET`          | HMAC secret for LP webhook verification         |

See `.env.example` for all supported variables.

## Scripts

| Command               | Description                          |
|-----------------------|--------------------------------------|
| `npm run dev`         | Run with ts-node-dev (watch)         |
| `npm run build`       | Compile TypeScript to `dist/`        |
| `npm start`           | Run production build (`node dist/server.js`) |
| `npm run lint`        | Run ESLint on `src`                  |
| `npm run prisma:generate` | Generate Prisma client           |
| `npm run prisma:migrate`  | Run migrations (interactive)     |
| `npm run db:up`       | Start DB/Redis via Docker Compose    |
| `npm run create-api-key` | Create an API key (script)       |

## API overview

Base path: **`/api/v1`**. All authenticated routes require:

```http
Authorization: Bearer <apiKey>
```

The API key must be 32 alphanumeric characters and exist in the database (use `npm run create-api-key` to create one).

### Endpoints

| Area      | Endpoints |
|-----------|-----------|
| **Health** | `GET /api/v1/health` — simple health check |
| **Readiness** | `GET /ready` — DB + Redis (no auth) |
| **Files** | `POST /api/v1/files` — multipart upload |
| **Users** | `POST /api/v1/users`, `GET /api/v1/users/:userId` |
| **KYB**   | `POST .../kyb`, `POST .../kyb/documents`, `POST .../kyb/submissions`, `GET .../kyb/status` |
| **Limits (user)** | `GET /api/v1/users/:userId/limits` |
| **Wallets** | `POST/GET/PATCH/DELETE /api/v1/users/:userId/wallets/external` |
| **Accounts** | `POST/GET/DELETE /api/v1/users/:userId/accounts` |
| **Onramps** | `GET /api/v1/onramps/rates`, `POST/GET /api/v1/onramps` |
| **Offramps** | `GET /api/v1/offramps/rates`, `POST/GET /api/v1/offramps`, `POST .../cancel` |
| **Limits** | `GET /api/v1/limits`, `POST/GET /api/v1/high-value-requests` |
| **Webhooks** | `POST /api/v1/webhooks` — LP webhooks (raw body, HMAC; no API key) |

State-changing POSTs (create user, create account, create onramp, etc.) require a **`requestId`** header (UUID v4) for idempotency. Duplicate `requestId` returns `409 Conflict`.

### Response format

- **Success:** `{ "success": true, "data": { ... } }`
- **Error:** `{ "error": { "code": "...", "message": "...", "details": {...}, "timestamp": "..." } }`

## Project structure

```
api_bloxfi/
├── src/
│   ├── api/v1/          # Routes, controllers, schemas (users, files, wallets, accounts, onramps, offramps, limits, webhooks)
│   ├── config/          # Env validation
│   ├── core/            # Business logic (kyb, accounts, wallets, onramps, offramps, payments, integrations)
│   ├── db/              # Prisma client and repositories
│   ├── middleware/       # Auth, rate limit, idempotency, error
│   ├── services/        # HTTP clients (currency API, LP, Palremit), storage, Redis, webhook verify
│   ├── types/           # Shared types and DTOs
│   ├── app.ts           # Express app
│   └── server.ts        # Entry point
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── postman/             # Postman collection and docs for E2E testing
├── scripts/             # e.g. create-api-key
├── .env.example
└── package.json
```

## Testing with Postman

1. Import **`postman/api_bloxfi.postman_collection.json`** into Postman.
2. Set collection variables: **`baseUrl`** (e.g. `http://localhost:3000`) and **`apiKey`** (your 32-char key).
3. Run requests in order; the collection uses **Pre-request Scripts** to generate a new `requestId` for each idempotent POST and **Tests** to save response IDs (`userId`, `fileId`, `accountId`, `walletId`, etc.) into variables.

See **`postman/README.md`** and **`postman/TEST_SCRIPTS_REFERENCE.md`** for the full flow and script reference.

## Ramp architecture (summary)

- **Rates:** Sourced from Currency API; used for all conversion and quotes.
- **Liquidity:** Liquidity provider (e.g. Palremit) is used only to receive funds (Deposit API) and send funds (Withdrawal API).
- **Platform:** Handles user requests, validation, order state, fees, limits, and settlement; calls the LP only when moving money.

For details see **`docs/RAMP_ARCHITECTURE.md`** (if present in your tree).

## License

Proprietary. See repository or author for terms.
