# BloxFi Admin Transaction Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page, no-auth internal dashboard inside `api_bloxfi` to view all onramp/offramp transactions, inspect destination details, and manually mark a transaction Successful or Failed with an audited note.

**Architecture:** A new unauthenticated `/dashboard` route serves a self-contained HTML page (vanilla JS, embedded as a TS template string so it compiles cleanly). It calls new `/dashboard/api/*` JSON endpoints mounted on the Express app *before* the API-key auth middleware. Endpoints reuse existing onramp/offramp repos (which already list across all users) and a new `AdminAction` table for the audit trail. Layering: `api/admin` (routes + controllers) → `core/admin/dashboard` (orchestration + pure helpers) → repos.

**Tech Stack:** TypeScript, Express 4, Prisma 7 (Postgres), Vitest. No frontend framework or bundler.

---

## File Structure

- Create: `prisma/schema.prisma` (modify — add `AdminAction` model)
- Create: `prisma/migrations/<generated>/migration.sql` (via `prisma migrate dev`)
- Create: `src/db/repositories/adminAction.repo.ts` — only layer touching Prisma for `AdminAction`
- Create: `src/core/admin/dashboard.ts` — orchestration + pure helpers (`resolveMarkStatus`, `toListRow`, `isValidStatus`)
- Create: `src/core/admin/dashboard.test.ts` — unit tests for pure helpers
- Create: `src/api/admin/controllers.ts` — thin request parsing/validation
- Create: `src/api/admin/routes.ts` — Express router
- Create: `src/api/admin/page.ts` — `DASHBOARD_HTML` template string (the single page)
- Modify: `src/app.ts` — mount `/dashboard` page + `/dashboard/api` router (before auth)

---

## Task 1: AdminAction model + migration

**Files:**
- Modify: `prisma/schema.prisma` (append at end)

- [ ] **Step 1: Add the model to the schema**

Append to `prisma/schema.prisma`:

```prisma
// --- Admin dashboard: manual transaction status changes (audit trail) ---
// Written by the no-auth internal ops dashboard. See docs/superpowers/specs/2026-06-15-bloxfi-admin-dashboard-design.md
model AdminAction {
  id         String   @id @default(uuid())
  txnType    String // "onramp" | "offramp"
  txnId      String
  fromStatus String
  toStatus   String
  note       String?  @db.Text
  actor      String? // free-form name typed in the UI (optional; no auth)
  createdAt  DateTime @default(now())

  @@index([txnType, txnId])
  @@index([createdAt])
}
```

- [ ] **Step 2: Ensure the database is up**

Run: `npm run db:up`
Expected: Postgres container running (Docker). If already up, no-op.

- [ ] **Step 3: Create and apply the migration**

Run: `npx prisma migrate dev --name add_admin_action`
Expected: A new folder `prisma/migrations/<timestamp>_add_admin_action/migration.sql` is created containing `CREATE TABLE "AdminAction" ...`, and the Prisma client is regenerated. Command exits 0.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(admin): add AdminAction audit table"
```

---

## Task 2: AdminAction repository

**Files:**
- Create: `src/db/repositories/adminAction.repo.ts`

- [ ] **Step 1: Write the repository**

Create `src/db/repositories/adminAction.repo.ts`:

```ts
/**
 * AdminAction repository. Only layer that touches Prisma for AdminAction.
 * Records manual status changes made via the no-auth admin dashboard.
 */

import { prisma } from '@/db/prisma/client';

export interface CreateAdminActionData {
  txnType: 'onramp' | 'offramp';
  txnId: string;
  fromStatus: string;
  toStatus: string;
  note?: string | null;
  actor?: string | null;
}

export interface AdminActionRow {
  id: string;
  txnType: string;
  txnId: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  actor: string | null;
  createdAt: Date;
}

export async function createAdminAction(data: CreateAdminActionData): Promise<AdminActionRow> {
  const row = await prisma.adminAction.create({
    data: {
      txnType: data.txnType,
      txnId: data.txnId,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      note: data.note ?? null,
      actor: data.actor ?? null,
    },
  });
  return row as AdminActionRow;
}

export async function listAdminActionsForTxn(
  txnType: string,
  txnId: string
): Promise<AdminActionRow[]> {
  const rows = await prisma.adminAction.findMany({
    where: { txnType, txnId },
    orderBy: { createdAt: 'desc' },
  });
  return rows as AdminActionRow[];
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors referencing `adminAction.repo.ts`. (`prisma.adminAction` exists because the client was regenerated in Task 1.)

- [ ] **Step 3: Commit**

```bash
git add src/db/repositories/adminAction.repo.ts
git commit -m "feat(admin): add adminAction repository"
```

---

## Task 3: Core dashboard logic (pure helpers + orchestration)

**Files:**
- Create: `src/core/admin/dashboard.ts`
- Test: `src/core/admin/dashboard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/core/admin/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveMarkStatus, toListRow, isValidStatus } from '@/core/admin/dashboard';

describe('resolveMarkStatus', () => {
  it('maps success to COMPLETED for both types', () => {
    expect(resolveMarkStatus('onramp', 'success')).toBe('COMPLETED');
    expect(resolveMarkStatus('offramp', 'success')).toBe('COMPLETED');
  });

  it('maps failed to FIAT_FAILED for onramp (no generic FAILED in its enum)', () => {
    expect(resolveMarkStatus('onramp', 'failed')).toBe('FIAT_FAILED');
  });

  it('maps failed to FAILED for offramp', () => {
    expect(resolveMarkStatus('offramp', 'failed')).toBe('FAILED');
  });
});

describe('toListRow', () => {
  it('derives amount/currency from source and ISO-formats createdAt', () => {
    const row = {
      id: 'abc',
      txnRef: 'ON-123',
      status: 'CREATED',
      userId: 'user-1',
      source: { currency: 'USD', amount: 100 },
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    expect(toListRow('onramp', row)).toEqual({
      id: 'abc',
      txnRef: 'ON-123',
      type: 'onramp',
      status: 'CREATED',
      userId: 'user-1',
      amount: 100,
      currency: 'USD',
      createdAt: '2026-06-15T10:00:00.000Z',
    });
  });

  it('returns null amount/currency when source is missing fields', () => {
    const row = {
      id: 'x',
      txnRef: null,
      status: 'COMPLETED',
      userId: 'u',
      source: {},
      createdAt: new Date('2026-06-15T10:00:00.000Z'),
    };
    const out = toListRow('offramp', row);
    expect(out.amount).toBeNull();
    expect(out.currency).toBeNull();
  });
});

describe('isValidStatus', () => {
  it('accepts a valid status for the type', () => {
    expect(isValidStatus('onramp', 'AWAITING_FUNDS')).toBe(true);
    expect(isValidStatus('offramp', 'REFUNDED')).toBe(true);
  });

  it('rejects a status that does not belong to the type', () => {
    expect(isValidStatus('onramp', 'REFUNDED')).toBe(false);
    expect(isValidStatus('offramp', 'AWAITING_FUNDS')).toBe(false);
    expect(isValidStatus('onramp', 'NONSENSE')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/core/admin/dashboard.test.ts`
Expected: FAIL — cannot resolve `@/core/admin/dashboard` (module not found).

- [ ] **Step 3: Write the implementation**

Create `src/core/admin/dashboard.ts`:

```ts
/**
 * Admin dashboard orchestration + pure helpers.
 * Backs the no-auth internal ops dashboard. See
 * docs/superpowers/specs/2026-06-15-bloxfi-admin-dashboard-design.md
 */

import { AppError } from '@/types';
import * as onrampRepo from '@/db/repositories/onramp.repo';
import * as offrampRepo from '@/db/repositories/offramp.repo';
import * as adminActionRepo from '@/db/repositories/adminAction.repo';

export type TxnType = 'onramp' | 'offramp';
export type MarkOutcome = 'success' | 'failed';

const ONRAMP_STATUSES = [
  'CREATED',
  'AWAITING_FUNDS',
  'FIAT_PENDING',
  'FIAT_PROCESSED',
  'CRYPTO_INITIATED',
  'CRYPTO_PENDING',
  'COMPLETED',
  'FIAT_FAILED',
  'FIAT_RETURNED',
  'CRYPTO_FAILED',
  'EXPIRED',
] as const;

const OFFRAMP_STATUSES = [
  'CREATED',
  'AWAITING_CRYPTO',
  'CRYPTO_PENDING',
  'CRYPTO_RECEIVED',
  'CRYPTO_CONFIRMED',
  'PROCESSING_FEE',
  'FEE_PROCESSED',
  'FIAT_INITIATED',
  'FIAT_PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'CRYPTO_FAILED',
  'FIAT_FAILED',
  'EXPIRED',
] as const;

export function statusesFor(type: TxnType): readonly string[] {
  return type === 'onramp' ? ONRAMP_STATUSES : OFFRAMP_STATUSES;
}

export function isValidStatus(type: TxnType, status: string): boolean {
  return statusesFor(type).includes(status);
}

export function resolveMarkStatus(type: TxnType, outcome: MarkOutcome): string {
  if (outcome === 'success') return 'COMPLETED';
  // Onramp enum has no generic FAILED; FIAT_FAILED is the closest terminal failure.
  return type === 'offramp' ? 'FAILED' : 'FIAT_FAILED';
}

export interface ListRow {
  id: string;
  txnRef: string | null;
  type: TxnType;
  status: string;
  userId: string;
  amount: number | null;
  currency: string | null;
  createdAt: string;
}

interface ListRowInput {
  id: string;
  txnRef: string | null;
  status: string;
  userId: string;
  source: unknown;
  createdAt: Date;
}

export function toListRow(type: TxnType, row: ListRowInput): ListRow {
  const s = (row.source ?? {}) as { amount?: unknown; currency?: unknown };
  return {
    id: row.id,
    txnRef: row.txnRef,
    type,
    status: row.status,
    userId: row.userId,
    amount: typeof s.amount === 'number' ? s.amount : null,
    currency: typeof s.currency === 'string' ? s.currency : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListParams {
  type: TxnType;
  status?: string;
  cursor?: string;
  limit?: number;
}

export async function listTransactions(
  params: ListParams
): Promise<{ items: ListRow[]; nextCursor: string | null }> {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 25;
  let createdBefore: Date | undefined;
  if (params.cursor) {
    createdBefore = new Date(params.cursor);
    if (Number.isNaN(createdBefore.getTime())) {
      throw new AppError('Invalid cursor', 'INVALID_REQUEST', 400);
    }
  }

  if (params.type === 'onramp') {
    const { onramps, nextCursor } = await onrampRepo.listOnramps({
      status: params.status as never,
      limit,
      createdBefore,
    });
    return {
      items: onramps.map((r) => toListRow('onramp', r)),
      nextCursor: nextCursor ? nextCursor.toISOString() : null,
    };
  }

  const { offramps, nextCursor } = await offrampRepo.listOfframps({
    status: params.status as never,
    limit,
    createdBefore,
  });
  return {
    items: offramps.map((r) => toListRow('offramp', r)),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}

export async function getTransactionDetail(type: TxnType, id: string): Promise<unknown> {
  const row =
    type === 'onramp'
      ? await onrampRepo.findOnrampById(id)
      : await offrampRepo.findOfframpById(id);
  if (!row) throw new AppError('Transaction not found', 'NOT_FOUND', 404);
  const adminActions = await adminActionRepo.listAdminActionsForTxn(type, id);
  return { ...row, type, adminActions };
}

export interface MarkParams {
  type: TxnType;
  id: string;
  outcome: MarkOutcome;
  note?: string;
  actor?: string;
}

export async function markTransaction(params: MarkParams): Promise<unknown> {
  const { type, id, outcome, note, actor } = params;
  const existing =
    type === 'onramp'
      ? await onrampRepo.findOnrampById(id)
      : await offrampRepo.findOfframpById(id);
  if (!existing) throw new AppError('Transaction not found', 'NOT_FOUND', 404);

  const fromStatus = existing.status;
  const toStatus = resolveMarkStatus(type, outcome);
  // failedReason only set on failure; undefined leaves the column untouched.
  const failedReason = outcome === 'failed' ? note ?? null : undefined;

  if (type === 'onramp') {
    await onrampRepo.updateOnrampStatus(id, toStatus as never, { failedReason });
  } else {
    await offrampRepo.updateOfframpStatus(id, toStatus as never, { failedReason });
  }

  // Sequential (not transactional): repos share one prisma client and don't expose
  // a tx handle. Acceptable for an internal tool; status write is the source of truth.
  await adminActionRepo.createAdminAction({
    txnType: type,
    txnId: id,
    fromStatus,
    toStatus,
    note: note ?? null,
    actor: actor ?? null,
  });

  return getTransactionDetail(type, id);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/core/admin/dashboard.test.ts`
Expected: PASS (3 describe blocks, all assertions green).

- [ ] **Step 5: Commit**

```bash
git add src/core/admin/dashboard.ts src/core/admin/dashboard.test.ts
git commit -m "feat(admin): add dashboard core logic with tests"
```

---

## Task 4: Admin controllers + routes

**Files:**
- Create: `src/api/admin/controllers.ts`
- Create: `src/api/admin/routes.ts`

- [ ] **Step 1: Write the controllers**

Create `src/api/admin/controllers.ts`:

```ts
/**
 * Admin dashboard controllers (NO AUTH — mounted before authMiddleware).
 * Thin: parse/validate request, delegate to core/admin/dashboard.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import * as dashboard from '@/core/admin/dashboard';

function parseType(raw: unknown): dashboard.TxnType {
  if (raw === 'onramp' || raw === 'offramp') return raw;
  throw new AppError('type must be "onramp" or "offramp"', 'INVALID_REQUEST', 400);
}

export async function listTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const type = parseType(req.query.type);
    const status =
      typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    if (status && !dashboard.isValidStatus(type, status)) {
      throw new AppError(`Invalid status "${status}" for ${type}`, 'INVALID_REQUEST', 400);
    }
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isNaN(limitRaw) ? undefined : limitRaw;
    const result = await dashboard.listTransactions({ type, status, cursor, limit });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function getTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const type = parseType(req.params.type);
    const result = await dashboard.getTransactionDetail(type, req.params.id);
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function markTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const type = parseType(req.params.type);
    const body = (req.body ?? {}) as { outcome?: unknown; note?: unknown; actor?: unknown };
    if (body.outcome !== 'success' && body.outcome !== 'failed') {
      throw new AppError('outcome must be "success" or "failed"', 'INVALID_REQUEST', 400);
    }
    const note = typeof body.note === 'string' ? body.note : undefined;
    const actor = typeof body.actor === 'string' ? body.actor : undefined;
    const result = await dashboard.markTransaction({
      type,
      id: req.params.id,
      outcome: body.outcome,
      note,
      actor,
    });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}
```

- [ ] **Step 2: Write the routes**

Create `src/api/admin/routes.ts`:

```ts
/**
 * Admin dashboard routes (NO AUTH). Mounted at /dashboard/api in app.ts,
 * before the API-key auth middleware.
 */

import { Router } from 'express';
import * as controllers from '@/api/admin/controllers';

const router = Router();

router.get('/transactions', controllers.listTransactions);
router.get('/transactions/:type/:id', controllers.getTransaction);
router.post('/transactions/:type/:id/mark', controllers.markTransaction);

export const adminRouter = router;
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/api/admin/controllers.ts src/api/admin/routes.ts
git commit -m "feat(admin): add dashboard controllers and routes"
```

---

## Task 5: The dashboard page (embedded HTML)

**Files:**
- Create: `src/api/admin/page.ts`

- [ ] **Step 1: Write the page module**

Create `src/api/admin/page.ts`. The HTML is a single self-contained page (inline CSS + vanilla JS) exported as a string so `tsc` ships it to `dist/` without a static-copy step.

```ts
/**
 * Self-contained admin dashboard page, served by GET /dashboard.
 * Vanilla HTML/CSS/JS — no framework, no build step. Calls /dashboard/api/*.
 */

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>BloxFi Transactions</title>
<style>
  :root { --bg:#0f1419; --panel:#1a2230; --line:#2a3547; --txt:#e6edf3; --mut:#8b97a7; --accent:#3b82f6; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--txt); }
  header { padding:16px 24px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:16px; }
  header h1 { font-size:16px; margin:0; }
  header .warn { font-size:12px; color:#f59e0b; }
  .tabs { display:flex; gap:4px; padding:12px 24px 0; }
  .tab { padding:8px 16px; cursor:pointer; border:1px solid var(--line); border-bottom:none; border-radius:6px 6px 0 0; background:var(--panel); color:var(--mut); }
  .tab.active { color:var(--txt); background:var(--bg); border-color:var(--accent); }
  .toolbar { padding:12px 24px; display:flex; gap:12px; align-items:center; }
  select, button, input { font:inherit; }
  select { background:var(--panel); color:var(--txt); border:1px solid var(--line); border-radius:6px; padding:6px 10px; }
  button { background:var(--accent); color:#fff; border:none; border-radius:6px; padding:7px 14px; cursor:pointer; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--txt); }
  button.danger { background:#dc2626; }
  button.ok { background:#16a34a; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:10px 24px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--mut); font-weight:600; }
  tr.row { cursor:pointer; }
  tr.row:hover { background:var(--panel); }
  .badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:11px; background:var(--panel); border:1px solid var(--line); }
  .badge.ok { color:#22c55e; border-color:#22c55e55; }
  .badge.fail { color:#ef4444; border-color:#ef444455; }
  .err { color:#ef4444; padding:8px 24px; }
  .muted { color:var(--mut); }
  dialog { background:var(--panel); color:var(--txt); border:1px solid var(--line); border-radius:10px; max-width:760px; width:92%; padding:0; }
  dialog::backdrop { background:rgba(0,0,0,.6); }
  .dhead { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; }
  .dbody { padding:16px 20px; max-height:70vh; overflow:auto; }
  .section { margin-bottom:18px; }
  .section h3 { margin:0 0 8px; font-size:13px; color:var(--accent); text-transform:uppercase; letter-spacing:.04em; }
  .kv { display:grid; grid-template-columns:160px 1fr; gap:4px 12px; }
  .kv div:nth-child(odd){ color:var(--mut); }
  pre { background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:10px; overflow:auto; font-size:12px; }
  .actions { display:flex; gap:8px; margin-top:8px; }
  .hist { font-size:12px; }
  .hist li { margin-bottom:6px; }
</style>
</head>
<body>
<header>
  <h1>BloxFi Transactions</h1>
  <span class="warn">⚠ Internal, no-auth dashboard — do not expose publicly</span>
</header>
<div class="tabs">
  <div class="tab active" data-type="onramp">Onramps</div>
  <div class="tab" data-type="offramp">Offramps</div>
</div>
<div class="toolbar">
  <label class="muted">Status</label>
  <select id="statusFilter"><option value="">All</option></select>
  <button class="ghost" id="reload">Reload</button>
</div>
<div id="err" class="err" style="display:none"></div>
<table>
  <thead><tr><th>Txn Ref</th><th>Status</th><th>User</th><th>Amount</th><th>Created</th></tr></thead>
  <tbody id="rows"></tbody>
</table>
<div style="padding:16px 24px"><button class="ghost" id="more" style="display:none">Load more</button></div>

<dialog id="detail">
  <div class="dhead"><strong id="dTitle">Transaction</strong><button class="ghost" id="dClose">Close</button></div>
  <div class="dbody" id="dBody"></div>
</dialog>

<script>
const ONRAMP_STATUSES = ["CREATED","AWAITING_FUNDS","FIAT_PENDING","FIAT_PROCESSED","CRYPTO_INITIATED","CRYPTO_PENDING","COMPLETED","FIAT_FAILED","FIAT_RETURNED","CRYPTO_FAILED","EXPIRED"];
const OFFRAMP_STATUSES = ["CREATED","AWAITING_CRYPTO","CRYPTO_PENDING","CRYPTO_RECEIVED","CRYPTO_CONFIRMED","PROCESSING_FEE","FEE_PROCESSED","FIAT_INITIATED","FIAT_PENDING","COMPLETED","FAILED","CANCELLED","REFUNDED","CRYPTO_FAILED","FIAT_FAILED","EXPIRED"];
const OK = new Set(["COMPLETED"]);
const FAIL = new Set(["FAILED","FIAT_FAILED","CRYPTO_FAILED","EXPIRED","CANCELLED"]);

let state = { type: "onramp", status: "", cursor: null };
const $ = (id) => document.getElementById(id);

function showErr(msg) { const e = $("err"); e.style.display = msg ? "block" : "none"; e.textContent = msg || ""; }
function badgeClass(s) { return OK.has(s) ? "badge ok" : FAIL.has(s) ? "badge fail" : "badge"; }
async function api(path, opts) {
  const res = await fetch("/dashboard/api" + path, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json.error && json.error.message) || res.statusText);
  return json.data;
}

function fillStatusFilter() {
  const list = state.type === "onramp" ? ONRAMP_STATUSES : OFFRAMP_STATUSES;
  $("statusFilter").innerHTML = '<option value="">All</option>' + list.map((s) => '<option value="' + s + '">' + s + '</option>').join("");
}

function rowHtml(t) {
  const amt = t.amount != null ? t.amount + " " + (t.currency || "") : "—";
  return '<tr class="row" data-id="' + t.id + '">' +
    "<td>" + (t.txnRef || '<span class="muted">' + t.id.slice(0, 8) + "</span>") + "</td>" +
    '<td><span class="' + badgeClass(t.status) + '">' + t.status + "</span></td>" +
    '<td class="muted">' + t.userId.slice(0, 8) + "</td>" +
    "<td>" + amt + "</td>" +
    '<td class="muted">' + new Date(t.createdAt).toLocaleString() + "</td>" +
    "</tr>";
}

async function load(reset) {
  showErr("");
  if (reset) { state.cursor = null; $("rows").innerHTML = ""; }
  try {
    const q = new URLSearchParams({ type: state.type });
    if (state.status) q.set("status", state.status);
    if (state.cursor) q.set("cursor", state.cursor);
    const data = await api("/transactions?" + q.toString());
    $("rows").insertAdjacentHTML("beforeend", data.items.map(rowHtml).join(""));
    state.cursor = data.nextCursor;
    $("more").style.display = data.nextCursor ? "inline-block" : "none";
  } catch (e) { showErr(e.message); }
}

function kv(obj) {
  return Object.entries(obj).map(([k, v]) =>
    "<div>" + k + "</div><div>" + (v == null ? "—" : String(v)) + "</div>"
  ).join("");
}

async function openDetail(id) {
  showErr("");
  try {
    const t = await api("/transactions/" + state.type + "/" + id);
    $("dTitle").textContent = (t.txnRef || id) + "  ·  " + t.status;
    const dest = t.destination || {};
    const src = t.source || {};
    const hist = (t.adminActions || []).map((a) =>
      "<li>" + new Date(a.createdAt).toLocaleString() + " — <b>" + a.fromStatus + " → " + a.toStatus + "</b>" +
      (a.actor ? " by " + a.actor : "") + (a.note ? ': "' + a.note + '"' : "") + "</li>"
    ).join("") || '<li class="muted">No manual actions yet.</li>';
    $("dBody").innerHTML =
      '<div class="section"><h3>Destination</h3><pre>' + JSON.stringify(dest, null, 2) + "</pre></div>" +
      '<div class="section"><h3>Source</h3><pre>' + JSON.stringify(src, null, 2) + "</pre></div>" +
      '<div class="section"><h3>Summary</h3><div class="kv">' +
        kv({ id: t.id, txnRef: t.txnRef, userId: t.userId, status: t.status, failedReason: t.failedReason, createdAt: t.createdAt, updatedAt: t.updatedAt }) +
      "</div></div>" +
      '<div class="section"><h3>Manage</h3><div class="actions">' +
        '<button class="ok" id="markOk">Mark Successful</button>' +
        '<button class="danger" id="markFail">Mark Failed</button>' +
      "</div></div>" +
      '<div class="section"><h3>Action history</h3><ul class="hist">' + hist + "</ul></div>";
    $("markOk").onclick = () => mark(id, "success");
    $("markFail").onclick = () => mark(id, "failed");
    $("detail").showModal();
  } catch (e) { showErr(e.message); }
}

async function mark(id, outcome) {
  const note = prompt("Note for marking this transaction " + outcome + " (why?):", "");
  if (note === null) return;
  const actor = prompt("Your name (optional):", "") || undefined;
  try {
    await api("/transactions/" + state.type + "/" + id + "/mark", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome, note, actor }),
    });
    $("detail").close();
    await load(true);
  } catch (e) { showErr(e.message); }
}

document.querySelectorAll(".tab").forEach((el) => el.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
  el.classList.add("active");
  state.type = el.dataset.type; state.status = "";
  fillStatusFilter();
  load(true);
}));
$("statusFilter").addEventListener("change", (e) => { state.status = e.target.value; load(true); });
$("reload").addEventListener("click", () => load(true));
$("more").addEventListener("click", () => load(false));
$("dClose").addEventListener("click", () => $("detail").close());
$("rows").addEventListener("click", (e) => {
  const tr = e.target.closest("tr.row");
  if (tr) openDetail(tr.dataset.id);
});

fillStatusFilter();
load(true);
</script>
</body>
</html>`;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors (a backtick template string; ensure no unescaped backticks inside).

- [ ] **Step 3: Commit**

```bash
git add src/api/admin/page.ts
git commit -m "feat(admin): add embedded dashboard page"
```

---

## Task 6: Wire the dashboard into the app

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Add imports**

In `src/app.ts`, add after the existing import block (e.g. after the `import { getRedis } ...` line):

```ts
import { adminRouter } from '@/api/admin/routes';
import { DASHBOARD_HTML } from '@/api/admin/page';
```

- [ ] **Step 2: Mount the page + API before the authed v1 router**

In `src/app.ts`, locate this existing line:

```ts
app.use('/api/v1', rateLimitMiddleware, authMiddleware(), v1Router);
```

Insert the following IMMEDIATELY ABOVE it (so it sits after `app.use(express.json(...))` — which the POST body needs — but before auth):

```ts
// Internal ops dashboard (NO AUTH — do not expose publicly).
// See docs/superpowers/specs/2026-06-15-bloxfi-admin-dashboard-design.md
app.get('/dashboard', (_req, res) => {
  res.type('html').send(DASHBOARD_HTML);
});
app.use('/dashboard/api', adminRouter);
```

- [ ] **Step 3: Verify the full project type-checks**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: No errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: All tests pass, including `src/core/admin/dashboard.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts
git commit -m "feat(admin): mount dashboard page and api before auth"
```

---

## Task 7: Manual verification

**Files:** none (runtime check)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: Logs `BloxFi API listening on port <PORT>`. (Requires `.env` with `DATABASE_URL` + Redis per `.env.example`; run `npm run db:up` first if needed.)

- [ ] **Step 2: Verify the list API responds without an API key**

Run: `curl -s "http://localhost:3000/dashboard/api/transactions?type=onramp" | head -c 400`
(Adjust the port to your `PORT`.)
Expected: `{"success":true,"data":{"items":[...],"nextCursor":...}}` — NOT an `UNAUTHORIZED` error. (Empty `items` is fine if the DB has no onramps.)

- [ ] **Step 3: Verify the page loads**

Open `http://localhost:3000/dashboard` in a browser.
Expected: The dashboard renders with Onramps/Offramps tabs, the no-auth warning banner, a status filter, and a table (populated if data exists).

- [ ] **Step 4: Verify mark + audit (only if at least one transaction exists)**

In the browser: click a row → in the dialog click **Mark Successful** → enter a note → confirm.
Expected: Dialog closes, the row's status shows `COMPLETED` with a green badge, and reopening the row shows the action in **Action history** with from/to status, your note, and name. Confirm the DB has a new `AdminAction` row, e.g.:
`curl -s "http://localhost:3000/dashboard/api/transactions/onramp/<id>" | python3 -m json.tool` and check `adminActions` is non-empty.

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(admin): dashboard verification fixes" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** view all txns (Task 3/4/5 list), destination details (Task 5 detail panel — Destination section first), mark success/failed (Task 3 `markTransaction` + Task 5 buttons), audit note (Task 1 `AdminAction` + Task 3 write + Task 5 history), no-auth single page served from api_bloxfi (Task 5/6), two tabs (Task 5), localhost/open exposure (warning banner; no auth gate). All covered.
- **Mark mapping:** success→COMPLETED, failed→FAILED (offramp)/FIAT_FAILED (onramp) — consistent between `resolveMarkStatus` (Task 3) and the front-end badge sets.
- **Type consistency:** `TxnType`/`MarkOutcome` defined in Task 3 and reused in Task 4; repo fn names (`listOnramps`, `listOfframps`, `findOnrampById`, `findOfframpById`, `updateOnrampStatus`, `updateOfframpStatus`) match the existing repos; `createAdminAction`/`listAdminActionsForTxn` match Task 2.
- **Known trade-off:** mark does status write then audit write non-transactionally (documented inline in Task 3). Acceptable for an internal tool.
