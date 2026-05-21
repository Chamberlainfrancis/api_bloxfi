/**
 * Validate client destination against Palremit corridor detail destination_fields.
 */

import type { PalremitDestinationFieldDescriptor } from '@/core/integrations/palremitCorridors';

function getAtPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined;
    return (cur as Record<string, unknown>)[key];
  }, obj);
}

function isFieldVisible(
  field: PalremitDestinationFieldDescriptor,
  values: Record<string, unknown>
): boolean {
  if (!field.conditional_required?.length || field.required) return true;
  return field.conditional_required.some((branch) => {
    const trigger = getAtPath(values, branch.when.path);
    return branch.when.equals !== undefined && trigger === branch.when.equals;
  });
}

function isFieldRequired(
  field: PalremitDestinationFieldDescriptor,
  values: Record<string, unknown>
): boolean {
  if (field.required) return true;
  return (field.conditional_required ?? []).some((branch) => {
    const trigger = getAtPath(values, branch.when.path);
    return branch.when.equals !== undefined && trigger === branch.when.equals;
  });
}

function validateFieldValue(
  field: PalremitDestinationFieldDescriptor,
  value: unknown,
  required: boolean
): string | null {
  if (value == null || value === '') {
    return required ? `${field.label} is required` : null;
  }
  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') return `${field.label} must be a boolean`;
    return null;
  }
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `${field.label} must be a number`;
    }
    return null;
  }
  const str = String(value);
  if (field.minLength != null && str.length < field.minLength) {
    return `${field.label} must be at least ${field.minLength} characters`;
  }
  if (field.maxLength != null && str.length > field.maxLength) {
    return `${field.label} must be at most ${field.maxLength} characters`;
  }
  if (field.pattern) {
    try {
      const re = new RegExp(field.pattern);
      if (!re.test(str)) return `${field.label} format is invalid`;
    } catch {
      /* ignore invalid pattern from provider */
    }
  }
  const enumChoices =
    field.conditional_required?.find((b) => b.enum?.length)?.enum ?? field.enum;
  if (enumChoices?.length) {
    const allowed = new Set(enumChoices.map((c) => String(c.value)));
    if (!allowed.has(str)) return `${field.label} must be one of the allowed values`;
  }
  return null;
}

export interface CorridorValidationResult {
  valid: boolean;
  errors: Array<{ path: string; message: string }>;
}

/**
 * Validate destination object against corridor detail fields (skips beneficiary.type — set by corridor).
 */
export function validateDestinationAgainstCorridorFields(
  destination: Record<string, unknown>,
  destinationFields: PalremitDestinationFieldDescriptor[]
): CorridorValidationResult {
  const errors: Array<{ path: string; message: string }> = [];

  for (const field of destinationFields) {
    if (field.path === 'beneficiary.type') continue;
    if (!isFieldVisible(field, destination)) continue;

    const required = isFieldRequired(field, destination);
    const value = getAtPath(destination, field.path);
    const msg = validateFieldValue(field, value, required);
    if (msg) errors.push({ path: field.path, message: msg });
  }

  return { valid: errors.length === 0, errors };
}
