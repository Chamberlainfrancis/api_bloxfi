/**
 * Admin dashboard routes (NO AUTH). Mounted at /dashboard/api in app.ts,
 * before the API-key auth middleware.
 */

import { Router } from 'express';
import * as controllers from '@/api/admin/controllers';
import * as bw from '@/api/admin/businessWallets.controllers';

const router = Router();

router.get('/transactions', controllers.listTransactions);
router.get('/transactions/:type/:id', controllers.getTransaction);
router.post('/transactions/:type/:id/mark', controllers.markTransaction);
router.post('/transactions/onramp/:id/mark-fiat-received', controllers.markOnrampFiatReceived);
router.get('/fee-settlements/pending', controllers.listPendingFeeSettlements);
router.post('/fee-settlements/:id/approve', controllers.approveFeeSettlement);
router.post('/offramps/:offrampId/retry-fiat-payout', controllers.retryOfframpFiatPayout);
// Refunds: the provider's refunded/expired signal is shown, but only an admin marks REFUNDED.
router.get('/offramps/refunds', controllers.listOfframpRefunds);
router.post('/offramps/:offrampId/mark-refunded', controllers.markOfframpRefunded);
router.get('/held-payouts', controllers.listHeldPayouts);
router.get('/offramps/:offrampId/hold', controllers.getOfframpPayoutHold);
router.post('/offramps/:offrampId/accept-rate', controllers.acceptOfframpPayoutRate);
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

// Sender / payee name settings (core/admin/senderInfo.ts). Writes are
// passcode-gated like every other mutating dashboard action.
router.get('/sender-info', controllers.listSenderInfo);
router.put('/sender-info', controllers.putSenderInfo);
router.delete('/sender-info/:id', controllers.deleteSenderInfo);

// Rates: bloxfi FX spread per (fiat, side, coins) (core/admin/pairMarkup.ts).
// Writes are passcode-gated like every other mutating dashboard action.
router.get('/pair-markups', controllers.listPairMarkups);
router.put('/pair-markups', controllers.putPairMarkup);
router.delete('/pair-markups/:id', controllers.deletePairMarkup);

router.get('/dakota/applications', controllers.listDakotaKybApplicants);
router.get('/dakota/applications/:applicationId', controllers.getDakotaKybApplicant);
router.post('/dakota/applications/:applicationId/attestations', controllers.postDakotaKybAttestations);

// Business wallets
router.get('/business-wallets', bw.listWallets);
router.get('/business-wallets/:userId', bw.getWallet);
router.post('/business-wallets/:userId/enable', bw.enableWallet);
router.patch('/business-wallets/:userId/settings', bw.updateSettings);
router.post('/business-wallets/:userId/pause', bw.pauseDebits);
router.post('/business-wallets/:userId/whitelist', bw.addWhitelist);
router.post('/business-wallets/:userId/whitelist/:id/remove', bw.removeWhitelist);
router.post('/business-wallets/:userId/adjustments', bw.postAdjustment);
router.post('/business-wallet-deposits/:id/credit', bw.creditDeposit);
router.post('/business-wallet-deposits/:id/refund', bw.refundDeposit);
router.post('/business-wallet-withdrawals/:id/approve', bw.approveWithdrawal);
router.post('/business-wallet-withdrawals/:id/reject', bw.rejectWithdrawal);

export const adminRouter = router;
