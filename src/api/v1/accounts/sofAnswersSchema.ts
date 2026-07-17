/**
 * Zod schema for sofQuestionnaire answers — mirrors SOF_QUESTIONNAIRE field defs.
 */

import { z } from 'zod';
import { SOF_QUESTIONNAIRE } from '@/api/v1/misc/sofQuestionnaire';

function fieldSchema(field: (typeof SOF_QUESTIONNAIRE.fields)[number]): z.ZodTypeAny {
  if (field.type === 'select' && field.options?.length) {
    const values = field.options.map((o) => o.value) as [string, ...string[]];
    const enumSchema = z.enum(values);
    return field.required ? enumSchema : enumSchema.optional();
  }
  if (field.type === 'url') {
    const urlSchema = z.string().url();
    return field.required ? urlSchema : urlSchema.optional();
  }
  if (field.type === 'number') {
    return field.required ? z.number() : z.number().optional();
  }
  const textSchema = z.string().min(1);
  return field.required ? textSchema : textSchema.optional();
}

const shape: Record<string, z.ZodTypeAny> = {};
for (const field of SOF_QUESTIONNAIRE.fields) {
  // sourceOfFundsDocument may be supplied top-level instead — always optional here;
  // createAccountBodySchema enforces that one of the two is present for onramp.
  if (field.name === 'sourceOfFundsDocument') {
    shape[field.name] = z.string().url().optional();
    continue;
  }
  shape[field.name] = fieldSchema(field);
}

export const sofQuestionnaireAnswersSchema = z.object(shape).strict();

export type SofQuestionnaireAnswers = z.infer<typeof sofQuestionnaireAnswersSchema>;
