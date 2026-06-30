// Feature: interniq-dashboard, Property 4: Invalid Date Normalization
// **Validates: Requirements 3.5**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateDeadline } from '../../packages/functions/src/extraction/fieldValidation';

/**
 * Returns the number of days in a given month/year, accounting for leap years.
 */
function daysInMonth(year: number, month: number): number {
  // month is 1-based
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return daysPerMonth[month - 1]!;
}

/**
 * Generator for valid ISO 8601 dates (YYYY-MM-DD) with valid calendar dates.
 * Year range: 1900-2100, valid month/day combinations including leap year handling.
 */
const validIsoDate: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 1900, max: 2100 }),
    month: fc.integer({ min: 1, max: 12 }),
  })
  .chain(({ year, month }) =>
    fc.integer({ min: 1, max: daysInMonth(year, month) }).map((day) => {
      const y = String(year).padStart(4, '0');
      const m = String(month).padStart(2, '0');
      const d = String(day).padStart(2, '0');
      return `${y}-${m}-${d}`;
    })
  );

/**
 * Generator for invalid date strings: arbitrary strings that are NOT valid ISO 8601 dates.
 * Includes wrong formats, impossible dates, random text, etc.
 */
const invalidDateString: fc.Arbitrary<string> = fc.oneof(
  // Arbitrary strings (very unlikely to be valid YYYY-MM-DD)
  fc.string().filter((s) => {
    // Filter out any accidental valid dates
    return validateDeadline(s) === null;
  }),
  // Wrong format: DD-MM-YYYY
  fc.tuple(
    fc.integer({ min: 1, max: 28 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1900, max: 2100 })
  ).map(([d, m, y]) => `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`),
  // Impossible dates: Feb 30, Feb 31, Apr 31, etc.
  fc.constantFrom('2024-02-30', '2024-02-31', '2023-04-31', '2023-06-31', '2023-09-31', '2023-11-31'),
  // Non-leap year Feb 29
  fc.constantFrom('2023-02-29', '2025-02-29', '1900-02-29', '2100-02-29'),
  // Invalid month/day values
  fc.constantFrom('2024-13-01', '2024-00-15', '2024-01-32', '2024-01-00'),
  // Dates with extra characters
  fc.tuple(
    fc.integer({ min: 1900, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  ).map(([y, m, d]) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T00:00:00`),
  // Slash-separated dates
  fc.tuple(
    fc.integer({ min: 1900, max: 2100 }),
    fc.integer({ min: 1, max: 12 }),
    fc.integer({ min: 1, max: 28 })
  ).map(([y, m, d]) => `${y}/${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}`)
);

describe('Property 4: Invalid Date Normalization', () => {
  it('valid ISO 8601 dates are preserved unchanged', () => {
    fc.assert(
      fc.property(validIsoDate, (dateStr: string) => {
        const result = validateDeadline(dateStr);
        expect(result).toBe(dateStr);
      }),
      { numRuns: 100 }
    );
  });

  it('invalid dates return null', () => {
    fc.assert(
      fc.property(invalidDateString, (dateStr: string) => {
        const result = validateDeadline(dateStr);
        expect(result).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('non-string values return null', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer(),
          fc.constant(null),
          fc.constant(undefined),
          fc.boolean(),
          fc.object(),
          fc.array(fc.anything())
        ),
        (value: unknown) => {
          const result = validateDeadline(value);
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});
