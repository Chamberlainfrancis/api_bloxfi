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
router.post('/offramps/:offrampId/retry-fiat-payout', controllers.retryOfframpFiatPayout);
router.patch('/users/:userId/metadata', controllers.patchUserMetadata);
router.get('/businesses', controllers.listBusinesses);
router.get('/businesses/search', controllers.searchBusinesses);

// 033: business provider customer identity (proxies to the orchestrator's
// admin API — see core/admin/providerCustomer.ts).
router.put(
  '/businesses/:businessReference/providers/:providerName/customer',
  controllers.putBusinessProviderCustomer
);
router.get('/businesses/:businessReference/providers', controllers.getBusinessProviderCustomers);
router.delete(
  '/businesses/:businessReference/providers/:providerName/customer',
  controllers.deleteBusinessProviderCustomer
);

export const adminRouter = router;
