/**
 * Offramp routes. Spec §5.
 * GET /offramps/rates, POST /offramps (idempotent), GET /offramps/:id, GET /offramps (list), POST /offramps/:id/cancel.
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '../../../middleware/idempotency';
import * as controllers from './controllers';

const router = Router();

router.get('/rates', controllers.getOfframpRates);
router.post('/', idempotencyMiddleware, controllers.createOfframp);
router.get('/', controllers.listOfframps);
router.get('/:id', controllers.getOfframp);
router.post('/:id/cancel', controllers.cancelOfframp);

export const offrampsRouter = router;
