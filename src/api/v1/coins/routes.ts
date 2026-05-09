import { Router } from 'express';
import { listCoins } from '@/api/v1/coins/controllers';

const router = Router();

/** GET /api/v1/coins — Palremit-supported assets (get_all_coins). */
router.get('/coins', listCoins);

export const coinsRouter = router;
