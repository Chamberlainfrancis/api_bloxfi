import { Router } from 'express';
import { idempotencyMiddleware } from '@/middleware/idempotency';
import * as controllers from '@/api/v1/beneficiaries/controllers';

const router = Router();

router.post('/', idempotencyMiddleware, controllers.createBeneficiary);
router.get('/', controllers.listBeneficiaries);
router.get('/:id', controllers.getBeneficiary);

export const beneficiariesRouter = router;
