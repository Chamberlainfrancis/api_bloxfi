/**
 * Admin dashboard routes (NO AUTH). Mounted at /dashboard/api in app.ts,
 * before the API-key auth middleware.
 */

import { Router } from 'express';
import * as controllers from '@/api/admin/controllers';

const router = Router();

router.get('/transactions', controllers.listTransactions);
router.get('/transactions/:type/:id', controllers.getTransaction);
router.post('/transactions/:type/:id/mark', controllers.markTransaction);
router.get('/fee-settlements/pending', controllers.listPendingFeeSettlements);
router.post('/fee-settlements/:offrampId/approve', controllers.approveFeeSettlement);

export const adminRouter = router;
