import { ValidationResult } from '@interniq/shared/types';
import { RESUME_CONSTRAINTS } from '@interniq/shared/constants';

/**
 * Validates resume input text against length and content constraints.
 *
 * Rules:
 * - Total character count must not exceed 10,000
 * - Non-whitespace character count must be at least 50
 *
 * @param text - The raw resume text to validate
 * @returns A ValidationResult indicating whether input is valid, with error messages if not
 */
export function validateResumeInput(text: string): ValidationResult {
  const errors: string[] = [];

  if (text.length > RESUME_CONSTRAINTS.maxLength) {
    errors.push(
      `Resume exceeds maximum length of ${RESUME_CONSTRAINTS.maxLength} characters (got ${text.length})`
    );
  }

  const nonWhitespaceCount = text.replace(/\s/g, '').length;
  if (nonWhitespaceCount < RESUME_CONSTRAINTS.minNonWhitespaceChars) {
    errors.push(
      `Resume must contain at least ${RESUME_CONSTRAINTS.minNonWhitespaceChars} non-whitespace characters (got ${nonWhitespaceCount})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
