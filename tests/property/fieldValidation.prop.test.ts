// Feature: interniq-dashboard, Property 3: Structured Field Validation and Truncation
// **Validates: Requirements 3.2, 3.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateAndTruncateFields } from '../../packages/functions/src/extraction/fieldValidation';
import { FIELD_CONSTRAINTS } from '../../packages/shared/constants';

/**
 * Generator for arbitrary strings of varying length (0 to 500+ chars).
 * Tests that truncation works regardless of input string size.
 */
const arbitraryLengthString = fc.string({ minLength: 0, maxLength: 600 });

/**
 * Generator for arbitrary tech stack arrays with random-sized items.
 * Can produce oversized arrays (0 to 60 items) with oversized item strings (0 to 100 chars).
 */
const arbitraryTechStack = fc.array(
  fc.string({ minLength: 0, maxLength: 100 }),
  { minLength: 0, maxLength: 60 }
);

/**
 * Generator for arbitrary workMode values - both valid and invalid.
 */
const arbitraryWorkMode = fc.oneof(
  fc.constantFrom('remote', 'hybrid', 'onsite'),
  fc.string({ minLength: 0, maxLength: 50 }),
  fc.constant(undefined),
  fc.constant(null),
  fc.constant(123)
);

/**
 * Generator for raw objects with random-length strings and oversized tech stack lists.
 */
const rawObjectArbitrary = fc.record({
  roleTitle: arbitraryLengthString,
  company: arbitraryLengthString,
  location: arbitraryLengthString,
  summary: arbitraryLengthString,
  techStack: arbitraryTechStack,
  workMode: arbitraryWorkMode,
  deadline: fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
});

describe('Property 3: Structured Field Validation and Truncation', () => {
  it('all output string fields are at most their defined maximum length', () => {
    fc.assert(
      fc.property(rawObjectArbitrary, (raw) => {
        const result = validateAndTruncateFields(raw);

        expect(result.roleTitle.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.roleTitle.maxLength);
        expect(result.company.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.company.maxLength);
        expect(result.location.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.location.maxLength);
        expect(result.summary.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.summary.maxLength);
      }),
      { numRuns: 100 }
    );
  });

  it('techStack has at most 30 items with each item at most 50 characters', () => {
    fc.assert(
      fc.property(rawObjectArbitrary, (raw) => {
        const result = validateAndTruncateFields(raw);

        expect(result.techStack.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.techStack.maxItems);
        for (const item of result.techStack) {
          expect(item.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.techStack.itemMaxLength);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('workMode is always a valid enum value', () => {
    fc.assert(
      fc.property(rawObjectArbitrary, (raw) => {
        const result = validateAndTruncateFields(raw);

        expect(FIELD_CONSTRAINTS.workMode.enum).toContain(result.workMode);
      }),
      { numRuns: 100 }
    );
  });

  it('handles non-object inputs gracefully with valid output', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(null),
          fc.constant(undefined),
          fc.integer(),
          fc.string(),
          fc.constant([]),
          fc.boolean()
        ),
        (raw) => {
          const result = validateAndTruncateFields(raw);

          // All string fields should be within max length (empty string is valid)
          expect(result.roleTitle.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.roleTitle.maxLength);
          expect(result.company.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.company.maxLength);
          expect(result.location.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.location.maxLength);
          expect(result.summary.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.summary.maxLength);
          expect(result.techStack.length).toBeLessThanOrEqual(FIELD_CONSTRAINTS.techStack.maxItems);
          expect(FIELD_CONSTRAINTS.workMode.enum).toContain(result.workMode);
        }
      ),
      { numRuns: 100 }
    );
  });
});
