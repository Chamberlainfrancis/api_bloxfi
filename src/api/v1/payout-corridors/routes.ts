import { Router } from 'express';
import * as controllers from '@/api/v1/payout-corridors/controllers';

const router = Router();

/** GET /api/v1/payout-corridors?asset=USD&country=GE */
router.get('/payout-corridors', controllers.listPayoutCorridors);

/** GET /api/v1/payout-corridors/requirements?asset&country&destinationType&beneficiaryType */
router.get('/payout-corridors/requirements', controllers.getPayoutCorridorRequirements);

export const payoutCorridorsRouter = router;
