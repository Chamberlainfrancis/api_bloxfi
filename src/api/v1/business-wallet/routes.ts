/**
 * Business wallet partner routes. Deposit addresses, balances and whitelist
 * are set up by admins; partners read them and request withdrawals.
 */

import { Router } from 'express';
import { idempotencyMiddleware } from '@/middleware/idempotency';
import * as controllers from '@/api/v1/business-wallet/controllers';

const router = Router();

router.get('/users/:userId/wallet', controllers.getWallet);
router.get('/users/:userId/balances', controllers.getBalances);
router.get('/users/:userId/wallet/transactions', controllers.listWalletTransactions);
router.get('/users/:userId/wallet/whitelist', controllers.listWhitelist);
router.post('/users/:userId/wallet/withdrawals', idempotencyMiddleware, controllers.createWithdrawal);
router.get('/users/:userId/wallet/withdrawals', controllers.listWithdrawals);
router.get('/users/:userId/wallet/withdrawals/:withdrawalId', controllers.getWithdrawal);

export const businessWalletRouter = router;
