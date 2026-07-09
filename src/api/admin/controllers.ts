/**
 * Admin dashboard controllers (NO AUTH — mounted before authMiddleware).
 * Thin: parse/validate request, delegate to core/admin/dashboard.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { env } from '@/config';
import * as dashboard from '@/core/admin/dashboard';
import * as providerCustomer from '@/core/admin/providerCustomer';
import { listUsers, searchUsers } from '@/db/repositories/user.repo';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';

const palremitLiquidity = createPalremitLiquidityAdapter();

function requirePalremitTenantId(): string {
  const tenantId = env.PALREMIT_LIQUIDITY_TENANT_ID;
  if (!tenantId) {
    throw new AppError(
      'PALREMIT_LIQUIDITY_TENANT_ID is not configured',
      'CONFIG_ERROR',
      500
    );
  }
  return tenantId;
}

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
    const includeExpired = req.query.includeExpired === 'true';
    const userId =
      typeof req.query.userId === 'string' && req.query.userId.trim()
        ? req.query.userId.trim()
        : undefined;
    const result = await dashboard.listTransactions({
      type,
      status,
      includeExpired,
      cursor,
      limit,
      userId,
    });
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
    const body = (req.body ?? {}) as {
      outcome?: unknown;
      note?: unknown;
      actor?: unknown;
      secret?: unknown;
    };
    // Marking mutates transaction state — require the shared passcode
    // (DASHBOARD_MARK_SECRET, default "pr2026"). Accept it via header or body.
    const provided =
      (typeof req.headers['x-dashboard-secret'] === 'string'
        ? (req.headers['x-dashboard-secret'] as string)
        : undefined) ?? (typeof body.secret === 'string' ? body.secret : '');
    if (provided !== env.DASHBOARD_MARK_SECRET) {
      throw new AppError('Incorrect passcode', 'UNAUTHORIZED', 401);
    }
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

export async function listPendingFeeSettlements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isNaN(limitRaw) ? undefined : limitRaw;
    const result = await dashboard.listPendingFeeSettlements({ cursor, limit });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function approveFeeSettlement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = (req.body ?? {}) as { actor?: unknown; secret?: unknown };
    const provided =
      (typeof req.headers['x-dashboard-secret'] === 'string'
        ? (req.headers['x-dashboard-secret'] as string)
        : undefined) ?? (typeof body.secret === 'string' ? body.secret : '');
    if (provided !== env.DASHBOARD_MARK_SECRET) {
      throw new AppError('Incorrect passcode', 'UNAUTHORIZED', 401);
    }
    const actor = typeof body.actor === 'string' ? body.actor : undefined;
    const result = await dashboard.approveFeeSettlement({
      offrampId: req.params.offrampId,
      actor,
    });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function retryOfframpFiatPayout(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = (req.body ?? {}) as { actor?: unknown; secret?: unknown };
    const provided =
      (typeof req.headers['x-dashboard-secret'] === 'string'
        ? (req.headers['x-dashboard-secret'] as string)
        : undefined) ?? (typeof body.secret === 'string' ? body.secret : '');
    if (provided !== env.DASHBOARD_MARK_SECRET) {
      throw new AppError('Incorrect passcode', 'UNAUTHORIZED', 401);
    }
    const actor = typeof body.actor === 'string' ? body.actor : undefined;
    const result = await dashboard.retryOfframpFiatPayoutAdmin({
      offrampId: req.params.offrampId,
      actor,
    });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

// --- Business provider customer (033) ---
// Proxies to the orchestrator's business-provider-customer admin API.
// Deliberately no passcode gate here (unlike markTransaction/approveFeeSettlement
// above) — see core/admin/providerCustomer.ts header comment.

export async function searchBusinesses(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isNaN(limitRaw) ? 10 : Math.min(Math.max(limitRaw, 1), 20);
    const items = await searchUsers(q, limit);
    sendSuccess(res, { items });
  } catch (e) {
    next(e);
  }
}

export async function listBusinesses(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const q = typeof req.query.q === 'string' && req.query.q.trim() ? req.query.q.trim() : undefined;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isNaN(limitRaw) ? undefined : limitRaw;
    let createdBefore: Date | undefined;
    if (cursor) {
      createdBefore = new Date(cursor);
      if (Number.isNaN(createdBefore.getTime())) {
        throw new AppError('Invalid cursor', 'INVALID_REQUEST', 400);
      }
    }

    const { users, nextCursor } = await listUsers({ q, limit, createdBefore });
    const tenantId = env.PALREMIT_LIQUIDITY_TENANT_ID;
    const items = tenantId
      ? await Promise.all(
          users.map(async (biz) => ({
            ...biz,
            providers: await providerCustomer.resolveDashboardProviderStatus(palremitLiquidity, {
              tenantId,
              businessReference: biz.id,
            }),
          }))
        )
      : users.map((biz) => ({
          ...biz,
          providers: providerCustomer.emptyDashboardProviderStatus(),
        }));

    sendSuccess(res, {
      items,
      nextCursor: nextCursor ? nextCursor.toISOString() : null,
    });
  } catch (e) {
    next(e);
  }
}

export async function putBusinessProviderCustomer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const businessReference = req.params.businessReference;
    const providerName = req.params.providerName;
    const body = (req.body ?? {}) as {
      channel_customer_id?: unknown;
      business_email?: unknown;
      actor?: unknown;
    };
    const channelCustomerId =
      typeof body.channel_customer_id === 'string' ? body.channel_customer_id.trim() : '';
    if (!channelCustomerId) {
      throw new AppError('channel_customer_id is required', 'INVALID_REQUEST', 400);
    }
    const businessEmail =
      typeof body.business_email === 'string' && body.business_email.trim()
        ? body.business_email.trim().toLowerCase()
        : null;
    const setBy = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : 'bloxfi-admin-dashboard';
    const result = await providerCustomer.putBusinessProviderCustomer(palremitLiquidity, {
      tenantId: requirePalremitTenantId(),
      businessReference,
      providerName,
      channelCustomerId,
      setBy,
      businessEmail,
    });
    if (!result.ok) {
      throw new AppError(result.message, 'ORCHESTRATOR_REJECTED', result.status);
    }
    sendSuccess(res, result.value);
  } catch (e) {
    next(e);
  }
}

export async function getBusinessProviderCustomers(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const businessReference = req.params.businessReference;
    const result = await providerCustomer.listBusinessProviderCustomers(palremitLiquidity, {
      tenantId: requirePalremitTenantId(),
      businessReference,
    });
    if (!result.ok) {
      throw new AppError(result.message, 'ORCHESTRATOR_REJECTED', result.status);
    }
    sendSuccess(res, result.value);
  } catch (e) {
    next(e);
  }
}

export async function deleteBusinessProviderCustomer(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const businessReference = req.params.businessReference;
    const providerName = req.params.providerName;
    const actorRaw = req.query.actor;
    const setBy = typeof actorRaw === 'string' && actorRaw.trim() ? actorRaw.trim() : 'bloxfi-admin-dashboard';
    const result = await providerCustomer.deleteBusinessProviderCustomer(palremitLiquidity, {
      tenantId: requirePalremitTenantId(),
      businessReference,
      providerName,
      setBy,
    });
    if (!result.ok) {
      throw new AppError(result.message, 'ORCHESTRATOR_REJECTED', result.status);
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
}
