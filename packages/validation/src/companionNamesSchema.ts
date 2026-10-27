import { z } from 'zod';

// Allowed characters: Latin alphabets (basic and accented diacritics), spaces, apostrophes, hyphens, periods
export const COMPANION_NAME_REGEX = /^[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s.'’-]+$/;
export const COMPANION_NAME_HAS_LETTER_REGEX = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/;

export interface CompanionNameValidationResult {
  isValid: boolean;
  error?: string;
}

export function validateCompanionName(name: unknown): CompanionNameValidationResult {
  if (typeof name !== 'string') {
    return { isValid: false, error: 'Companion name must be a string.' };
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Companion name cannot be empty.' };
  }

  if (trimmed.length > 100) {
    return { isValid: false, error: 'Companion name cannot exceed 100 characters.' };
  }

  // Reject markup or control characters
  if (/[<>\0-\x1F\x7F]/.test(trimmed)) {
    return { isValid: false, error: 'Companion name contains invalid characters or markup.' };
  }

  if (!COMPANION_NAME_REGEX.test(trimmed)) {
    return { isValid: false, error: 'Companion name contains invalid characters.' };
  }

  if (!COMPANION_NAME_HAS_LETTER_REGEX.test(trimmed)) {
    return { isValid: false, error: 'Companion name must contain at least one letter.' };
  }

  return { isValid: true };
}

export function validateCompanionNames(
  names: unknown,
  capacity: number = 1
): { isValid: boolean; error?: string; cleanedNames: string[] } {
  if (!Array.isArray(names)) {
    return { isValid: false, error: 'Companion names must be an array.', cleanedNames: [] };
  }

  const maxCompanions = Math.max(0, capacity - 1);
  const cleaned: string[] = [];

  for (const item of names) {
    if (typeof item !== 'string') {
      return { isValid: false, error: 'Companion name must be a string.', cleanedNames: [] };
    }
    const trimmed = item.trim();
    if (trimmed.length > 0) {
      const check = validateCompanionName(trimmed);
      if (!check.isValid) {
        return { isValid: false, error: check.error, cleanedNames: [] };
      }
      cleaned.push(trimmed);
    }
  }

  if (cleaned.length > maxCompanions) {
    return {
      isValid: false,
      error: `Companion names count (${cleaned.length}) exceeds maximum allowance of ${maxCompanions} for spot capacity ${capacity}.`,
      cleanedNames: [],
    };
  }

  return { isValid: true, cleanedNames: cleaned };
}

export const companionNameZodSchema = z
  .string()
  .trim()
  .min(1, 'Companion name cannot be empty.')
  .max(100, 'Companion name cannot exceed 100 characters.')
  .refine((val) => !/[<>\0-\x1F\x7F]/.test(val), {
    message: 'Companion name contains invalid characters or markup.',
  })
  .refine((val) => COMPANION_NAME_REGEX.test(val), {
    message: 'Companion name contains invalid characters.',
  })
  .refine((val) => COMPANION_NAME_HAS_LETTER_REGEX.test(val), {
    message: 'Companion name must contain at least one letter.',
  });

export function createCompanionNamesZodSchema(capacity: number = 1) {
  const maxAllowed = Math.max(0, capacity - 1);
  return z
    .array(companionNameZodSchema)
    .max(maxAllowed, `Companion names cannot exceed capacity allowance of ${maxAllowed}.`);
}

