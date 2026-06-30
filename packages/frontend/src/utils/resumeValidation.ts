/**
 * Resume input validation utilities.
 * Validates: Requirements 8.1, 8.3
 */

export const MAX_RESUME_LENGTH = 10_000;
export const MIN_NON_WHITESPACE = 50;

/**
 * Count non-whitespace characters in a string.
 */
export function countNonWhitespace(input: string): number {
  return input.replace(/\s/g, '').length;
}

/**
 * Validate resume text for submission.
 * Rejects empty, whitespace-only, or text with fewer than 50 non-whitespace characters.
 * Returns an error message string or null if valid.
 */
export function validateResumeText(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return 'Resume must contain at least 50 non-whitespace characters.';
  }
  const nonWsCount = countNonWhitespace(input);
  if (nonWsCount < MIN_NON_WHITESPACE) {
    return 'Resume must contain at least 50 non-whitespace characters.';
  }
  return null;
}
