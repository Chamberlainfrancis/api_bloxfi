/**
 * User & KYB routes. Spec §1, §6.
 * POST /users (idempotent), GET /users/:userId, POST /users/:userId/kyb (idempotent),
 * POST /users/:userId/kyb/submissions (idempotent), GET /users/:userId/kyb/status,
 * GET /users/:userId/limits (spec §6).
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '../../../middleware/idempotency';
import * as controllers from './controllers';
import { getUserLimits } from '../limits/controllers';

const router = Router();

router.post(
  '/users',
  idempotencyMiddleware,
  controllers.createUser
);

router.get('/users/:userId', controllers.getUser);

router.get('/users/:userId/limits', getUserLimits);

router.post(
  '/users/:userId/kyb',
  idempotencyMiddleware,
  controllers.updateKyb
);

router.post(
  '/users/:userId/kyb/submissions',
  idempotencyMiddleware,
  controllers.submitKyb
);

router.get('/users/:userId/kyb/status', controllers.getKybStatus);

router.post('/users/:userId/kyb/documents', controllers.attachKybDocuments);

export const usersRouter = router;
