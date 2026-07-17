/**
 * Misc controllers — static reference data for partner clients.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { PRE_DUE_DILIGENCE_QUESTIONNAIRE } from '@/api/v1/misc/preDueDiligenceQuestionnaire';
import { SOF_QUESTIONNAIRE } from '@/api/v1/misc/sofQuestionnaire';

/** GET /api/v1/misc/pre-due-diligence-questionnaire */
export async function getPreDueDiligenceQuestionnaire(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    sendSuccess(res, PRE_DUE_DILIGENCE_QUESTIONNAIRE);
  } catch (e) {
    next(e);
  }
}

/** GET /api/v1/misc/source-of-funds-questionnaire */
export async function getSourceOfFundsQuestionnaire(
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
