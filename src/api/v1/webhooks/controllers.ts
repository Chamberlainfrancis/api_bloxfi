/**
 * Webhook controller: verify Palremit signature (§7.2), parse payload, delegate to core.
 * No business logic; core processes events via repos.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { verifyPalremitWebhookSignature } from '@/services/webhookVerify';
import { processWebhookEvent } from '@/core/webhooks';
import * as userRepo from '@/db/repositories/user.repo';
import * as onrampRepo from '@/db/repositories/onramp.repo';
import * as offrampRepo from '@/db/repositories/offramp.repo';
import * as highValueRequestRepo from '@/db/repositories/highValueRequest.repo';
import { env } from '@/config/env';
import { inboundWebhookPayloadSchema } from '@/api/v1/webhooks/schemas';
import type { InboundWebhookPayload } from '@/types/webhook';

const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

const webhookRepos = {
  user: {
    findUserById: userRepo.findUserById,
    updateUser: userRepo.updateUser,
    updateKybRailStatuses: userRepo.updateKybRailStatuses,
  },
  onramp: {
    findOnrampById: onrampRepo.findOnrampById,
    findOnrampByReferenceMatch: onrampRepo.findOnrampByReferenceMatch,
    updateOnrampStatus: onrampRepo.updateOnrampStatus,
  },
  offramp: {
    findOfframpById: offrampRepo.findOfframpById,
    findOfframpByReferenceMatch: offrampRepo.findOfframpByReferenceMatch,
    updateOfframpStatus: offrampRepo.updateOfframpStatus,
  },
  highValueRequest: {
    findHighValueRequestById: highValueRequestRepo.findHighValueRequestById,
    findHighValueRequestByRequestId: highValueRequestRepo.findHighValueRequestByRequestId,
    updateHighValueRequestStatus: highValueRequestRepo.updateHighValueRequestStatus,
  },
};

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && v[0]) return v[0];
  return undefined;
}

/**
 * req.body is Buffer (raw) when using express.raw for this route.
 */
export async function handleInboundWebhook(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rawBody = req.body;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      next(new AppError('Invalid webhook body', 'INVALID_REQUEST', 400));
      return;
    }

    const rawUtf8 = rawBody.toString('utf8');
    const skipSignatureVerify =
      env.WEBHOOK_SKIP_SIGNATURE_VERIFY && env.NODE_ENV !== 'production';

    if (env.NODE_ENV === 'production' && env.WEBHOOK_SKIP_SIGNATURE_VERIFY) {
      console.warn(
        '[webhooks] WEBHOOK_SKIP_SIGNATURE_VERIFY is set but ignored in production'
      );
    }

    if (skipSignatureVerify) {
      console.warn('[webhooks] Signature verification skipped (WEBHOOK_SKIP_SIGNATURE_VERIFY)');
    }

    if (!skipSignatureVerify) {
      const signature = getHeader(req, WEBHOOK_SIGNATURE_HEADER);

      if (!signature) {
        next(new AppError('Missing X-Webhook-Signature header', 'INVALID_REQUEST', 400));
        return;
      }

      const secret = env.WEBHOOK_SECRET ?? env.PALREMIT_ACCESS_KEY;
      if (!verifyPalremitWebhookSignature(rawUtf8, secret, signature)) {
        next(new AppError('Invalid webhook signature', 'UNAUTHORIZED', 401));
        return;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawUtf8);
    } catch {
      next(new AppError('Invalid webhook JSON', 'INVALID_REQUEST', 400));
      return;
    }

    const result = inboundWebhookPayloadSchema.safeParse(parsed);
    if (!result.success) {
      const message = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(new AppError(message, 'INVALID_REQUEST', 400));
      return;
    }

    const payload: InboundWebhookPayload = result.data;
    await processWebhookEvent(webhookRepos, payload);

    sendSuccess(res, { received: true, eventId: payload.eventId }, 200);
  } catch (e) {
    next(e);
  }
}
