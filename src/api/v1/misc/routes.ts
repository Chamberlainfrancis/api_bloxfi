import { Router } from 'express';
import * as controllers from '@/api/v1/misc/controllers';

const router = Router();

/** GET /api/v1/misc/pre-due-diligence-questionnaire — Pre-Due Diligence Form (v2). */
router.get(
  '/misc/pre-due-diligence-questionnaire',
  controllers.getPreDueDiligenceQuestionnaire
);

export const miscRouter = router;
