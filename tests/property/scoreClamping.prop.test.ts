// Feature: interniq-dashboard, Property 5: Score Clamping Invariant
// **Validates: Requirements 4.6**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { clampScore } from '../../packages/functions/src/scoring/scoreValidation';
import { SCORE_CONSTRAINTS } from '../../packages/shared/constants';

const { min, max } = SCORE_CONSTRAINTS;

describe('Property 5: Score Clamping Invariant', () => {
  it('for any numeric value, result is an integer in [1, 10]', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          // Arbitrary doubles including negatives, large values, fractions
          fc.double({ min: -1e15, max: 1e15, noNaN: true, noDefaultInfinity: true }),
          // Negative numbers
          fc.double({ min: -1e10, max: -0.001, noNaN: true, noDefaultInfinity: true }),
          // Large positive numbers
          fc.double({ min: 10.001, max: 1e10, noNaN: true, noDefaultInfinity: true }),
          // Fractions between 0 and 11
          fc.double({ min: 0, max: 11, noNaN: true, noDefaultInfinity: true }),
          // Integers out of range (negative)
          fc.integer({ min: -1000, max: 0 }),
          // Integers out of range (large positive)
          fc.integer({ min: 11, max: 1000 })
        ),
        (score: number) => {
          const result = clampScore(score);

          // Result must be an integer
          expect(Number.isInteger(result)).toBe(true);

          // Result must be in [1, 10]
          expect(result).toBeGreaterThanOrEqual(min);
          expect(result).toBeLessThanOrEqual(max);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('for any integer already in [1, 10], result equals the input unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min, max }),
        (score: number) => {
          const result = clampScore(score);
          expect(result).toBe(score);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('values below 1 are clamped to 1', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -1e10, max: 0.49, noNaN: true, noDefaultInfinity: true }),
          fc.integer({ min: -1000, max: 0 })
        ),
        (score: number) => {
          const result = clampScore(score);
          expect(result).toBe(min);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('values above 10 are clamped to 10', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: 10.5, max: 1e10, noNaN: true, noDefaultInfinity: true }),
          fc.integer({ min: 11, max: 1000 })
        ),
        (score: number) => {
          const result = clampScore(score);
          expect(result).toBe(max);
        }
      ),
      { numRuns: 100 }
    );
  });
});
