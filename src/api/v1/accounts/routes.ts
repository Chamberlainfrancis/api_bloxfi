/**
 * Fiat account routes. Spec §3.
 * POST /users/:userId/accounts (idempotent), GET list, GET one, DELETE.
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '../../../middleware/idempotency';
import * as controllers from './controllers';

const router = Router();

router.post(
  '/users/:userId/accounts',
  idempotencyMiddleware,
  controllers.createAccount
);

router.get('/users/:userId/accounts', controllers.listAccounts);

router.get('/users/:userId/accounts/:accountId', controllers.getAccount);

router.delete('/users/:userId/accounts/:accountId', controllers.deleteAccount);

export const accountsRouter = router;
