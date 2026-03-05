import { Router } from 'express';
import { handleInboundWebhook } from './controllers';

const router = Router();

/**
 * POST /api/v1/webhooks
 * Inbound webhooks from LPs. Signature verification and timestamp check in controller.
 * Body must be raw (application/json) for signature verification; use express.raw when mounting.
 */
router.post('/', handleInboundWebhook);

export const webhooksRouter = router;
