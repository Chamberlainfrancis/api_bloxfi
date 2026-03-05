/**
 * Limits routes. Spec §6.
 * GET /limits, POST /high-value-requests (idempotent), GET /high-value-requests/:requestId.
 * GET /users/:userId/limits is mounted on users router.
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '../../../middleware/idempotency';
import * as controllers from './controllers';

const router = Router();

router.get('/limits', controllers.getLimits);
router.post('/high-value-requests', idempotencyMiddleware, controllers.createHighValueRequest);
router.get('/high-value-requests/:requestId', controllers.getHighValueRequest);

export const limitsRouter = router;
