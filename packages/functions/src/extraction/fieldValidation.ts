/**
 * Structured field validation and truncation for extraction service.
 * Enforces max lengths, list sizes, and enum values per FIELD_CONSTRAINTS.
 */

import { FIELD_CONSTRAINTS } from '@interniq/shared/constants';
import { StructuredFields, WorkMode } from '@interniq/shared/types';

const VALID_WORK_MODES: readonly WorkMode[] = FIELD_CONSTRAINTS.workMode.enum;
const DEFAULT_WORK_MODE: WorkMode = 'onsite';

/**
 * Validates a date string against ISO 8601 date format (YYYY-MM-DD).
 * Returns the date string if valid, or null if invalid.
 */
export function validateDeadline(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  // Must match YYYY-MM-DD format exactly
  const iso8601DateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso8601DateRegex.test(value)) {
    return null;
  }

  // Verify it's an actual valid date (e.g., not 2024-13-45)
  const [yearStr, monthStr, dayStr] = value.split('-');
  const year = parseInt(yearStr!, 10);
  const month = parseInt(monthStr!, 10);
  const day = parseInt(dayStr!, 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Use Date to validate the actual date (handles leap years, days in month)
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return value;
}

/**
 * Truncates a string to the specified max length.
 */
function truncateString(value: unknown, maxLength: number): string {
  const str = typeof value === 'string' ? value : '';
  return str.length > maxLength ? str.slice(0, maxLength) : str;
}

/**
 * Validates and truncates structured fields from a raw/unknown object.
 * - Truncates strings that exceed max length
 * - Caps techStack to max items, truncates each item
 * - Validates workMode is a valid enum value (defaults to 'onsite')
 * - Validates deadline is ISO 8601 date or null
 */
export function validateAndTruncateFields(raw: unknown): StructuredFields {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;

  const roleTitle = truncateString(obj.roleTitle, FIELD_CONSTRAINTS.roleTitle.maxLength);
  const company = truncateString(obj.company, FIELD_CONSTRAINTS.company.maxLength);
  const location = truncateString(obj.location, FIELD_CONSTRAINTS.location.maxLength);
  const summary = truncateString(obj.summary, FIELD_CONSTRAINTS.summary.maxLength);

  // Validate and truncate techStack
  const rawTechStack = Array.isArray(obj.techStack) ? obj.techStack : [];
  const techStack = rawTechStack
    .slice(0, FIELD_CONSTRAINTS.techStack.maxItems)
    .map((item: unknown) => truncateString(item, FIELD_CONSTRAINTS.techStack.itemMaxLength));

  // Validate workMode enum
  const rawWorkMode = obj.workMode;
  const workMode: WorkMode = (
    typeof rawWorkMode === 'string' &&
    (VALID_WORK_MODES as readonly string[]).includes(rawWorkMode)
  )
    ? (rawWorkMode as WorkMode)
    : DEFAULT_WORK_MODE;

  // Validate deadline
  const deadline = validateDeadline(obj.deadline);

  return {
    roleTitle,
    company,
    location,
    techStack,
    deadline,
    workMode,
    summary,
  };
}
