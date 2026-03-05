/**
 * External wallet routes. Spec §2.
 * POST /users/:userId/wallets/external (idempotent), GET list, GET one, PATCH, DELETE.
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '../../../middleware/idempotency';
import * as controllers from './controllers';

const router = Router();

router.post(
  '/users/:userId/wallets/external',
  idempotencyMiddleware,
  controllers.addExternalWallet
);

router.get('/users/:userId/wallets/external', controllers.listExternalWallets);

router.get('/users/:userId/wallets/external/:walletId', controllers.getExternalWallet);

router.patch('/users/:userId/wallets/external/:walletId', controllers.updateExternalWallet);

router.delete('/users/:userId/wallets/external/:walletId', controllers.deleteExternalWallet);

export const walletsRouter = router;
