/**
 * @deprecated Import from `@/api/v1/misc/sofQuestionnaire` instead.
 * Kept so existing imports of PRE_DUE_DILIGENCE_QUESTIONNAIRE keep working.
 * GET /api/v1/misc/pre-due-diligence-questionnaire now returns SOF_QUESTIONNAIRE.
 */

export {
  SOF_QUESTIONNAIRE,
  PRE_DUE_DILIGENCE_QUESTIONNAIRE,
  OCCUPATION_CODES,
  type SofQuestionnaire,
  type SofQuestionnaireField,
} from '@/api/v1/misc/sofQuestionnaire';
