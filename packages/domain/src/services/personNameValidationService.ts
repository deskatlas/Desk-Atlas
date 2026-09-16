/**
 * DeskAtlas Standard Person Name Validation Service (MF-106 / PRD-F2, PRD-F4, PRD-F8, PRD-F13)
 * 
 * Enforces acceptable personal and legal name characters across:
 * - Customer online reservations
 * - Kiosk walk-in reservations
 * - Staff and Admin account creation / invitations / profiles
 * 
 * Rules:
 * - Allowed: Alphabetic letters (including Latin diacritics/accents e.g. ñ, é, ü, ç), whitespace,
 *   hyphens (-), periods (.), and apostrophes (', ’).
 * - Forbidden: Numeric digits (0-9), non-name symbols (@, #, $, %, ^, &, *, +, =, <, >, /, \, _, ~, |, etc.), and emojis.
 * - Structure: Must contain at least one alphabetic letter; cannot consist solely of punctuation or spaces; length 1-60 characters.
 */

export interface PersonNameValidationResult {
  isValid: boolean;
  error?: string;
}

// Regex matching allowed characters: Latin alphabets (basic & accented diacritics), spaces, apostrophes, hyphens, periods
export const ALLOWED_NAME_CHARS_REGEX = /^[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s.'’-]+$/;

// Regex ensuring at least one letter is present
export const AT_LEAST_ONE_LETTER_REGEX = /[a-zA-Z\u00C0-\u024F\u1E00-\u1EFF]/;

export function validatePersonName(
  name: string | null | undefined,
  fieldLabel: string = "Name"
): PersonNameValidationResult {
  if (name === null || name === undefined || typeof name !== "string") {
    return {
      isValid: false,
      error: `${fieldLabel} is required.`,
    };
  }

  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return {
      isValid: false,
      error: `${fieldLabel} is required.`,
    };
  }

  if (trimmed.length > 60) {
    return {
      isValid: false,
      error: `${fieldLabel} cannot exceed 60 characters.`,
    };
  }

  if (!ALLOWED_NAME_CHARS_REGEX.test(trimmed)) {
    return {
      isValid: false,
      error: `${fieldLabel} can only contain letters, spaces, hyphens, periods, and apostrophes.`,
    };
  }

  if (!AT_LEAST_ONE_LETTER_REGEX.test(trimmed)) {
    return {
      isValid: false,
      error: `${fieldLabel} must contain at least one letter.`,
    };
  }

  return { isValid: true };
}
