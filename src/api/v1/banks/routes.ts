import { Router } from 'express';
import * as controllers from '@/api/v1/banks/controllers';

const router = Router();

/** GET /api/v1/banks?asset=NGN — supported banks for a fiat payout asset (Palremit). */
router.get('/banks', controllers.listBanks);

/** POST /api/v1/banks/resolve — fiat bank account name lookup (Palremit); not for crypto. */
router.post('/banks/resolve', controllers.resolveBankAccount);

export const banksRouter = router;
