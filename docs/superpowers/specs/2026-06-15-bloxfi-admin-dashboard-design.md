# BloxFi Admin Transaction Dashboard — Design

**Date:** 2026-06-15
**Status:** Approved (design)

## Purpose

A single-page, no-auth internal dashboard served from `api_bloxfi` for viewing and
manually managing transactions (Onramps + Offramps). It lets an operator:

- View all transactions across all users.
- Inspect a transaction's full detail, emphasizing **destination details** of the transfer.
- Manually mark a transaction **Successful** or **Failed**, recording an audited note.

## ⚠️ Security note

The dashboard and its API are **fully open** (no authentication), by explicit choice, yet
they can mutate real transaction state. This is acceptable only for local/internal use.
**Do not expose `/dashboard` or `/dashboard/api/*` on a public, production-reachable host.**
This trade-off is intentional and called out here so it is not mistaken for an oversight.

## Architecture

The dashboard lives inside `api_bloxfi` with **no separate build step**:

- `GET /dashboard` serves one self-contained static HTML file (vanilla HTML/CSS/JS — no
  framework, no bundler).
- `/dashboard/api/*` exposes JSON endpoints the page calls.

Both are mounted on the Express app **before** the
`app.use('/api/v1', rateLimitMiddleware, authMiddleware(), v1Router)` line in `src/app.ts`,
mirroring how the inbound `webhooksRouter` is mounted ahead of auth. This places them
outside API-key authentication.

### Layering (follows existing conventions)

```
src/api/admin/routes.ts        # express.Router, route wiring
src/api/admin/controllers.ts   # thin: parse/validate req, call core, send response
src/core/admin/dashboard.ts    # orchestration (list, detail, mark)
src/db/repositories/adminAction.repo.ts   # new repo
```

Reuses existing repo functions:
- `listOnramps` / `listOfframps` — already accept an optional `userId`; called with **no**
  `userId` to list across all users. Support `status` filter and cursor pagination
  (`createdBefore`).
- `findOnrampById` / `findOfframpById` — detail.
- `updateOnrampStatus` / `updateOfframpStatus` — status change (also accept `failedReason`).

Responses use the existing `sendSuccess` / `sendError` helpers from `@/utils`.

## Data model

One new table + one Prisma migration:

```prisma
model AdminAction {
  id         String   @id @default(uuid())
  txnType    String   // "onramp" | "offramp"
  txnId      String
  fromStatus String
  toStatus   String
  note       String?  @db.Text
  actor      String?  // free-form name typed in the UI (optional; no auth)
  createdAt  DateTime @default(now())

  @@index([txnType, txnId])
  @@index([createdAt])
}
```

New repo `src/db/repositories/adminAction.repo.ts`:
- `createAdminAction(data): Promise<AdminActionRow>`
- `listAdminActionsForTxn(txnType, txnId): Promise<AdminActionRow[]>` (ordered `createdAt desc`)

## Endpoints

All under `/dashboard/api`, unauthenticated.

### `GET /dashboard/api/transactions`

Query params:
- `type` (required): `onramp` | `offramp`
- `status` (optional): a valid status enum value for that type
- `cursor` (optional): ISO timestamp → maps to `createdBefore`
- `limit` (optional): default 25, clamped 1–100

Returns `{ items: [...], nextCursor: string | null }`. Each item is a list-shaped row:
`{ id, txnRef, type, status, userId, amount, currency, createdAt }`, where `amount`/`currency`
are derived from `source`/`destination` JSON (best-effort).

### `GET /dashboard/api/transactions/:type/:id`

Returns the full transaction row (source, **destination**, quote/rate info, providerRefs,
receipt, failedReason, timestamps) plus `adminActions: [...]` (history from `AdminAction`).
404 if not found.

### `POST /dashboard/api/transactions/:type/:id/mark`

Body: `{ outcome: "success" | "failed", note?: string, actor?: string }`.

Behavior (orchestrated in `core/admin/dashboard.ts`, ideally inside a transaction):
1. Load the txn; 404 if missing. Capture `fromStatus`.
2. Resolve `toStatus`:
   - `success` → `COMPLETED` (both types).
   - `failed` → `FAILED` (offramp); `FIAT_FAILED` (onramp — no generic FAILED in its enum).
3. Call the type's `updateStatus(id, toStatus, { failedReason: note ?? null })` (failedReason
   only set on `failed`).
4. Write an `AdminAction` row `{ txnType, txnId, fromStatus, toStatus, note, actor }`.
5. Return the updated detail payload (same shape as GET detail).

Validation: reject unknown `type`, unknown `outcome`; 404 on missing txn.

## Frontend (single page, two tabs)

Self-contained `src/api/admin/public/index.html` (HTML + inline CSS + inline vanilla JS),
served by `GET /dashboard`.

- Two tabs: **Onramps** / **Offramps**. Switching tabs reloads the list for that `type`.
- Table columns: `txnRef` · status badge (color-coded) · `userId` · amount + currency ·
  `createdAt` · actions.
- A status filter dropdown (populated from that type's enum values) and a **Load more**
  button driven by `nextCursor`.
- Clicking a row expands a detail panel that fetches GET detail and shows:
  - **Destination details** (prominent section).
  - Source, quote/rate, providerRefs, receipt, failedReason.
  - Admin-action history (from/to status, note, actor, time).
  - Two buttons: **Mark Successful** / **Mark Failed**. Each prompts for a note (and
    optional name), POSTs to the mark endpoint, then refreshes the row + history.
- Errors surface inline (e.g. a small banner); success refreshes affected data.

## Error handling

- Controllers validate inputs and return `sendError` with appropriate HTTP codes
  (400 invalid params, 404 missing txn).
- The mark orchestration is resilient: if `updateStatus` succeeds but the `AdminAction`
  write fails, prefer wrapping both in a Prisma transaction so they commit together.
- Frontend shows inline error messages; never silently swallows failures.

## Testing (vitest, matching existing style)

- `core/admin/dashboard` mark-status mapping: success→COMPLETED, failed→FAILED (offramp) /
  FIAT_FAILED (onramp); failedReason set only on failure.
- `adminAction.repo`: create + listForTxn ordering.
- Controller validation: unknown type/outcome rejected; missing txn → 404.

## Out of scope (YAGNI)

- Authentication / login.
- Triggering downstream side effects (Palremit calls, outbound webhooks) on mark.
- Editing arbitrary fields or setting arbitrary statuses (only Successful/Failed).
- Search by free text, CSV export, real-time updates.
