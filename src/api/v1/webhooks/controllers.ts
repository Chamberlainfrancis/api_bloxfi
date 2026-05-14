/**
 * Webhook controller: verify Palremit HMAC (`X-Webhook-Signature`), parse payload, delegate to core.
 * Orchestrator deliveries dedupe on `X-Liquidity-Event-Id` when present.
 * All requests are persisted to WebhookInboundLog (audit).
 */

import type { Request, Response, NextFunction } from "express";
import { sendSuccess } from "@/utils";
import { AppError } from "@/types";
import { verifyPalremitWebhookSignature } from "@/services/webhookVerify";
import { processWebhookEvent } from "@/core/webhooks";
import { advanceOnrampIfFiatProcessed } from "@/core/onramps/advanceOnrampPayout";
import { advanceOfframpIfDepositReady } from "@/core/offramps/advanceOfframpPayout";
import { executePalremitOnrampCryptoWithdrawal } from "@/core/integrations";
import { createPalremitLiquidityAdapter } from "@/services/palremitAdapters";
import * as userRepo from "@/db/repositories/user.repo";
import * as onrampRepo from "@/db/repositories/onramp.repo";
import * as offrampRepo from "@/db/repositories/offramp.repo";
import * as highValueRequestRepo from "@/db/repositories/highValueRequest.repo";
import * as accountRepo from "@/db/repositories/account.repo";
import { createWebhookInboundLog, truncateWebhookRawBody, type WebhookInboundOutcome } from "@/db/repositories/webhookInboundLog.repo";
import { tryClaimWebhookDedupe } from "@/db/repositories/webhookDedupe.repo";
import { buildPalremitWebhookDedupeKey } from "@/core/webhooks/buildWebhookDedupeKey";
import { env } from "@/config/env";
import { inboundWebhookPayloadSchema } from "@/api/v1/webhooks/schemas";
import type { InboundWebhookPayload } from "@/types/webhook";

const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

const palremitLiquidity = createPalremitLiquidityAdapter();

const webhookRepos = {
  user: {
    findUserById: userRepo.findUserById,
    updateUser: userRepo.updateUser,
    updateKybRailStatuses: userRepo.updateKybRailStatuses,
  },
  onramp: {
    findOnrampById: onrampRepo.findOnrampById,
    findOnrampByTxnRef: onrampRepo.findOnrampByTxnRef,
    updateOnrampStatus: onrampRepo.updateOnrampStatus,
    advanceOnrampAfterFiatWebhook: async (onrampId: string) => {
      await advanceOnrampIfFiatProcessed(
        {
          findOnrampById: onrampRepo.findOnrampById,
          updateOnrampStatus: onrampRepo.updateOnrampStatus,
        },
        onrampId,
        (b, rid, receiveNet, destAddr, txnRef, destMemo) =>
          executePalremitOnrampCryptoWithdrawal(
            palremitLiquidity,
            b,
            rid,
            receiveNet,
            destAddr,
            txnRef,
            destMemo
          ),
      );
    },
  },
  offramp: {
    findOfframpById: offrampRepo.findOfframpById,
    findOfframpByTxnRef: offrampRepo.findOfframpByTxnRef,
    updateOfframpStatus: offrampRepo.updateOfframpStatus,
    advanceOfframpAfterCryptoWebhook: async (offrampId: string) => {
      await advanceOfframpIfDepositReady(
        {
          findOfframpById: offrampRepo.findOfframpById,
          updateOfframpStatus: offrampRepo.updateOfframpStatus,
        },
        { findOfframpAccountByIdAndUser: accountRepo.findOfframpAccountByIdAndUser },
        palremitLiquidity,
        offrampId,
      );
    },
  },
  highValueRequest: {
    findHighValueRequestById: highValueRequestRepo.findHighValueRequestById,
    findHighValueRequestByRequestId: highValueRequestRepo.findHighValueRequestByRequestId,
    updateHighValueRequestStatus: highValueRequestRepo.updateHighValueRequestStatus,
  },
};

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

async function logInbound(
  outcome: WebhookInboundOutcome,
  opts: {
    rawBody: string;
    eventType?: string | null;
    eventId?: string | null;
    payload?: unknown | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  try {
    await createWebhookInboundLog({
      rawBody: opts.rawBody,
      outcome,
      eventType: opts.eventType,
      eventId: opts.eventId,
      payload: opts.payload,
      errorMessage: opts.errorMessage,
    });
  } catch (e) {
    console.error("[webhooks] failed to persist WebhookInboundLog", e);
  }
}

/**
 * req.body is Buffer (raw) when using express.raw for this route.
 */
export async function handleInboundWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawBody = req.body;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      await logInbound("invalid_buffer", {
        rawBody: "",
        errorMessage: "Request body is not a raw buffer",
      });
      next(new AppError("Invalid webhook body", "INVALID_REQUEST", 400));
      return;
    }

    const rawUtf8 = truncateWebhookRawBody(rawBody.toString("utf8"));

    const signature = getHeader(req, WEBHOOK_SIGNATURE_HEADER);
    const allowUnsigned = env.WEBHOOK_ALLOW_UNSIGNED === true;

    if (!signature) {
      if (!allowUnsigned) {
        await logInbound("bad_signature", {
          rawBody: rawUtf8,
          errorMessage: "Missing X-Webhook-Signature header",
        });
        next(new AppError("Missing X-Webhook-Signature header", "INVALID_REQUEST", 400));
        return;
      }
    } else {
      const secret = env.WEBHOOK_SECRET;
      if (!verifyPalremitWebhookSignature(rawUtf8, secret, signature)) {
        await logInbound("bad_signature", {
          rawBody: rawUtf8,
          errorMessage: "HMAC verification failed",
        });
        next(new AppError("Invalid webhook signature", "UNAUTHORIZED", 401));
        return;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString("utf8"));
    } catch {
      await logInbound("bad_json", {
        rawBody: rawUtf8,
        errorMessage: "JSON.parse failed",
      });
      next(new AppError("Invalid webhook JSON", "INVALID_REQUEST", 400));
      return;
    }

    const result = inboundWebhookPayloadSchema.safeParse(parsed);
    if (!result.success) {
      const message = result.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ");
      await logInbound("bad_schema", {
        rawBody: rawUtf8,
        errorMessage: message,
      });
      next(new AppError(message, "INVALID_REQUEST", 400));
      return;
    }

    const payload: InboundWebhookPayload = result.data;

    const headerEventType = getHeader(req, "x-liquidity-event-type")?.trim();
    if (headerEventType && headerEventType !== payload.eventType) {
      const msg = `X-Liquidity-Event-Type (${headerEventType}) does not match body event_type (${payload.eventType})`;
      await logInbound("bad_schema", {
        rawBody: rawUtf8,
        eventType: payload.eventType,
        eventId: payload.eventId,
        errorMessage: msg,
      });
      next(new AppError(msg, "INVALID_REQUEST", 400));
      return;
    }

    const dataObj = payload.data as Record<string, unknown>;
    const liquidityEventId = getHeader(req, "x-liquidity-event-id")?.trim();
    const dedupeKey = liquidityEventId
      ? `palremit:liquidity:${liquidityEventId}`
      : buildPalremitWebhookDedupeKey(payload.eventType, dataObj);
    const claimed = await tryClaimWebhookDedupe("palremit", dedupeKey);
    if (!claimed) {
      await logInbound("duplicate", {
        rawBody: rawUtf8,
        eventType: payload.eventType,
        eventId: payload.eventId,
        payload,
      });
      sendSuccess(res, { received: true, eventId: payload.eventId, duplicate: true }, 200);
      return;
    }

    try {
      await processWebhookEvent(webhookRepos, payload);
    } catch (handlerErr) {
      const msg = handlerErr instanceof Error ? handlerErr.message : String(handlerErr);
      await logInbound("handler_error", {
        rawBody: rawUtf8,
        eventType: payload.eventType,
        eventId: payload.eventId,
        payload,
        errorMessage: msg,
      });
      throw handlerErr;
    }

    await logInbound("processed", {
      rawBody: rawUtf8,
      eventType: payload.eventType,
      eventId: payload.eventId,
      payload,
    });

    sendSuccess(res, { received: true, eventId: payload.eventId }, 200);
  } catch (e) {
    next(e);
  }
}
