import { Router } from 'express';
import * as controllers from '@/api/v1/misc/controllers';

const router = Router();

/** GET /api/v1/misc/pre-due-diligence-questionnaire — USD SOF questionnaire (path kept for clients). */
router.get(
  '/misc/pre-due-diligence-questionnaire',
  controllers.getPreDueDiligenceQuestionnaire
);

export const miscRouter = router;
