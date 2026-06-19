/**
 * Onramp routes. Spec §4.
 * GET /onramps/rates, POST /onramps (idempotent), GET /onramps/:onrampId, GET /onramps (list).
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '@/middleware/idempotency';
import * as controllers from '@/api/v1/onramps/controllers';

const router = Router();

router.get('/rates', controllers.getOnrampRates);
router.post('/quotes', controllers.createOnrampQuoteHandler);
router.post('/', idempotencyMiddleware, controllers.createOnramp);
router.get('/', controllers.listOnramps);
router.get('/:onrampId', controllers.getOnramp);

export const onrampsRouter = router;
