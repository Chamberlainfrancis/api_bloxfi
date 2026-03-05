/**
 * Webhook controller: verify signature and timestamp, parse payload, delegate to core.
 * No business logic; core processes events via repos.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../../utils';
import { AppError } from '../../../types';
import { verifyWebhookSignature, isWebhookTimestampFresh } from '../../../services/webhookVerify';
import { processWebhookEvent } from '../../../core/webhooks';
import * as userRepo from '../../../db/repositories/user.repo';
import * as onrampRepo from '../../../db/repositories/onramp.repo';
import * as offrampRepo from '../../../db/repositories/offramp.repo';
import * as highValueRequestRepo from '../../../db/repositories/highValueRequest.repo';
import { env } from '../../../config/env';
import { inboundWebhookPayloadSchema } from './schemas';
import type { InboundWebhookPayload } from '../../../types/webhook';

const WEBHOOK_ID_HEADER = 'x-webhook-id';
const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';
const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';
const MAX_TIMESTAMP_AGE_SECONDS = 300; // 5 minutes

const webhookRepos = {
  user: {
    findUserById: userRepo.findUserById,
    updateUser: userRepo.updateUser,
    updateKybRailStatuses: userRepo.updateKybRailStatuses,
  },
  onramp: {
    findOnrampById: onrampRepo.findOnrampById,
    updateOnrampStatus: onrampRepo.updateOnrampStatus,
  },
  offramp: {
    findOfframpById: offrampRepo.findOfframpById,
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

    const webhookId = getHeader(req, WEBHOOK_ID_HEADER);
    const timestamp = getHeader(req, WEBHOOK_TIMESTAMP_HEADER);
    const signature = getHeader(req, WEBHOOK_SIGNATURE_HEADER);

    if (!webhookId || !timestamp || !signature) {
      next(
        new AppError(
          'Missing webhook headers: X-Webhook-Id, X-Webhook-Timestamp, X-Webhook-Signature',
          'INVALID_REQUEST',
          400
        )
      );
      return;
    }

    const secret = env.WEBHOOK_SECRET;
    if (secret) {
      if (!verifyWebhookSignature(webhookId, timestamp, rawBody, secret, signature)) {
        next(new AppError('Invalid webhook signature', 'UNAUTHORIZED', 401));
        return;
      }
      if (!isWebhookTimestampFresh(timestamp, MAX_TIMESTAMP_AGE_SECONDS)) {
        next(new AppError('Webhook timestamp expired or invalid', 'INVALID_REQUEST', 400));
        return;
      }
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
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
