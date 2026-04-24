import { Router } from 'express';
import { listNetworks } from '@/api/v1/networks/controllers';

const router = Router();

/** GET /api/v1/networks?coin=USDT */
router.get('/networks', listNetworks);

export const networksRouter = router;
