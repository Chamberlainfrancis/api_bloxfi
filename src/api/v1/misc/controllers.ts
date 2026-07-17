/**
 * Misc controllers — static reference data for partner clients.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { SOF_QUESTIONNAIRE } from '@/api/v1/misc/sofQuestionnaire';

/** GET /api/v1/misc/pre-due-diligence-questionnaire — returns SOF_QUESTIONNAIRE (path unchanged). */
export async function getPreDueDiligenceQuestionnaire(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    sendSuccess(res, SOF_QUESTIONNAIRE);
  } catch (e) {
    next(e);
  }
}
