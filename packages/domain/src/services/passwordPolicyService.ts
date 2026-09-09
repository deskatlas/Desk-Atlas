/**
 * DeskAtlas Password Policy Service
 * Enforces password security requirements for Admin and Staff accounts (PRD-F13, MF-46):
 * - Minimum 8 characters
 * - At least 1 uppercase letter (A-Z)
 * - At least 1 digit (0-9)
 * - At least 1 special character (!@#$%^&* etc.)
 */

export const PASSWORD_MIN_LENGTH = 8;
export const UPPERCASE_REGEX = /[A-Z]/;
export const DIGIT_REGEX = /[0-9]/;
export const SPECIAL_CHAR_REGEX = /[^A-Za-z0-9\s]/;
export const DEFAULT_STAFF_PASSWORD = 'DeskAtlas123!';

export interface PasswordRuleDetail {
  id: 'minLength' | 'hasUppercase' | 'hasNumber' | 'hasSpecialChar';
  label: string;
  passed: boolean;
}

export interface PasswordValidationResult {
  isValid: boolean;
  minLength: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
  hasSpecialChar: boolean;
  rules: PasswordRuleDetail[];
  errors: string[];
}

export class PasswordPolicyError extends Error {
  constructor(message: string, public readonly errors: string[] = []) {
    super(message);
    this.name = 'PasswordPolicyError';
  }
}

/**
 * Validates a password against the DeskAtlas password policy.
 */
export function validatePassword(password: string | null | undefined): PasswordValidationResult {
  const value = password ?? '';
  const minLength = value.length >= PASSWORD_MIN_LENGTH;
  const hasUppercase = UPPERCASE_REGEX.test(value);
  const hasNumber = DIGIT_REGEX.test(value);
  const hasSpecialChar = SPECIAL_CHAR_REGEX.test(value);

  const rules: PasswordRuleDetail[] = [
    {
      id: 'minLength',
      label: `At least ${PASSWORD_MIN_LENGTH} characters`,
      passed: minLength,
    },
    {
      id: 'hasUppercase',
      label: 'At least 1 uppercase letter (A-Z)',
      passed: hasUppercase,
    },
    {
      id: 'hasNumber',
      label: 'At least 1 number (0-9)',
      passed: hasNumber,
    },
    {
      id: 'hasSpecialChar',
      label: 'At least 1 special character (!@#$%^&* etc.)',
      passed: hasSpecialChar,
    },
  ];

  const errors: string[] = [];
  if (!minLength) errors.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long.`);
  if (!hasUppercase) errors.push('Password must contain at least one uppercase letter (A-Z).');
  if (!hasNumber) errors.push('Password must contain at least one number (0-9).');
  if (!hasSpecialChar) errors.push('Password must contain at least one special character (!@#$%^&* etc.).');

  const isValid = minLength && hasUppercase && hasNumber && hasSpecialChar;

  return {
    isValid,
    minLength,
    hasUppercase,
    hasNumber,
    hasSpecialChar,
    rules,
    errors,
  };
}

/**
 * Asserts that a password meets all policy requirements, throwing a PasswordPolicyError if invalid.
 */
export function assertValidPassword(password: string | null | undefined): void {
  const result = validatePassword(password);
  if (!result.isValid) {
    throw new PasswordPolicyError(
      `Password does not meet security requirements: ${result.errors.join(' ')}`,
      result.errors
    );
  }
}
