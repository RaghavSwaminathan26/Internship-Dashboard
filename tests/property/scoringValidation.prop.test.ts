// Feature: interniq-dashboard, Property 6: Scoring Response Validation
// **Validates: Requirements 4.5, 4.9**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateScoringResponse } from '../../packages/functions/src/scoring/scoreValidation';
import { GAP_ANALYSIS_CONSTRAINTS } from '../../packages/shared/constants';

const { maxBulletLength } = GAP_ANALYSIS_CONSTRAINTS;

/**
 * Generator for valid gap analysis objects: both `matches` and `missing` are
 * strings with length ≤ 200 characters.
 */
function validGapAnalysisArb(): fc.Arbitrary<{ matches: string; missing: string }> {
  return fc.record({
    matches: fc.string({ minLength: 0, maxLength: maxBulletLength }),
    missing: fc.string({ minLength: 0, maxLength: maxBulletLength }),
  });
}

/**
 * Generator for invalid gap analysis values: missing fields, wrong types,
 * oversized strings, or non-object values.
 */
function invalidGapAnalysisArb(): fc.Arbitrary<unknown> {
  return fc.oneof(
    // null / undefined / primitive types
    fc.constant(null),
    fc.constant(undefined),
    fc.integer(),
    fc.string(),
    fc.boolean(),
    // Object missing `matches`
    fc.record({ missing: fc.string({ minLength: 0, maxLength: maxBulletLength }) }).map(
      (obj) => obj as unknown
    ),
    // Object missing `missing`
    fc.record({ matches: fc.string({ minLength: 0, maxLength: maxBulletLength }) }).map(
      (obj) => obj as unknown
    ),
    // `matches` is not a string
    fc.record({
      matches: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)) as fc.Arbitrary<unknown>,
      missing: fc.string({ minLength: 0, maxLength: maxBulletLength }),
    }),
    // `missing` is not a string
    fc.record({
      matches: fc.string({ minLength: 0, maxLength: maxBulletLength }),
      missing: fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)) as fc.Arbitrary<unknown>,
    }),
    // `matches` exceeds 200 chars
    fc.record({
      matches: fc.string({ minLength: maxBulletLength + 1, maxLength: maxBulletLength + 100 }),
      missing: fc.string({ minLength: 0, maxLength: maxBulletLength }),
    }),
    // `missing` exceeds 200 chars
    fc.record({
      matches: fc.string({ minLength: 0, maxLength: maxBulletLength }),
      missing: fc.string({ minLength: maxBulletLength + 1, maxLength: maxBulletLength + 100 }),
    })
  );
}

/**
 * Generator for valid finite numbers (the matchScore).
 */
function validScoreArb(): fc.Arbitrary<number> {
  return fc.oneof(
    fc.integer({ min: -1000, max: 1000 }),
    fc.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
  );
}

/**
 * Generator for invalid matchScore values: NaN, Infinity, non-number types, or missing.
 */
function invalidScoreArb(): fc.Arbitrary<unknown> {
  return fc.oneof(
    fc.constant(NaN),
    fc.constant(Infinity),
    fc.constant(-Infinity),
    fc.constant(undefined),
    fc.constant(null),
    fc.string(),
    fc.boolean(),
    fc.constant([]),
    fc.constant({})
  );
}

describe('Property 6: Scoring Response Validation', () => {
  it('accepts valid scoring responses with a finite matchScore and valid gapAnalysis', () => {
    const validResponse = fc.record({
      matchScore: validScoreArb(),
      gapAnalysis: validGapAnalysisArb(),
    });

    fc.assert(
      fc.property(validResponse, (response) => {
        const result = validateScoringResponse(response);
        expect(result.valid).toBe(true);
        expect(result.score).toBeDefined();
        expect(result.score).toBeGreaterThanOrEqual(1);
        expect(result.score).toBeLessThanOrEqual(10);
        expect(Number.isInteger(result.score)).toBe(true);
        expect(result.gapAnalysis).toBeDefined();
        expect(result.gapAnalysis!.matches.length).toBeLessThanOrEqual(maxBulletLength);
        expect(result.gapAnalysis!.missing.length).toBeLessThanOrEqual(maxBulletLength);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects responses with an invalid matchScore (NaN, Infinity, non-number, missing)', () => {
    const invalidScoreResponse = fc.record({
      matchScore: invalidScoreArb(),
      gapAnalysis: validGapAnalysisArb(),
    });

    fc.assert(
      fc.property(invalidScoreResponse, (response) => {
        const result = validateScoringResponse(response);
        expect(result.valid).toBe(false);
        expect(result.score).toBeUndefined();
        expect(result.gapAnalysis).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects responses with an invalid gapAnalysis (wrong types, oversized, missing fields)', () => {
    const invalidGapResponse = fc.record({
      matchScore: validScoreArb(),
      gapAnalysis: invalidGapAnalysisArb(),
    });

    fc.assert(
      fc.property(invalidGapResponse, (response) => {
        const result = validateScoringResponse(response);
        expect(result.valid).toBe(false);
        expect(result.score).toBeUndefined();
        expect(result.gapAnalysis).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects non-object inputs (null, undefined, primitives)', () => {
    const nonObjectInputs = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.integer(),
      fc.string(),
      fc.boolean()
    );

    fc.assert(
      fc.property(nonObjectInputs, (input) => {
        const result = validateScoringResponse(input);
        expect(result.valid).toBe(false);
        expect(result.score).toBeUndefined();
        expect(result.gapAnalysis).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('correctly classifies arbitrary scoring responses: accepted iff score is finite number AND gapAnalysis has valid matches/missing ≤ 200 chars', () => {
    // Generate arbitrary objects that may or may not be valid scoring responses
    const arbitraryResponse = fc.oneof(
      // Potentially valid
      fc.record({
        matchScore: fc.oneof(validScoreArb(), invalidScoreArb()) as fc.Arbitrary<unknown>,
        gapAnalysis: fc.oneof(validGapAnalysisArb(), invalidGapAnalysisArb()),
      }),
      // Missing matchScore
      fc.record({
        gapAnalysis: fc.oneof(validGapAnalysisArb(), invalidGapAnalysisArb()),
      }),
      // Missing gapAnalysis
      fc.record({
        matchScore: fc.oneof(validScoreArb(), invalidScoreArb()) as fc.Arbitrary<unknown>,
      }),
      // Non-objects
      fc.oneof(
        fc.constant(null),
        fc.constant(undefined),
        fc.integer(),
        fc.string()
      ).map((v) => v as unknown)
    );

    fc.assert(
      fc.property(arbitraryResponse, (input) => {
        const result = validateScoringResponse(input);

        // Determine expected validity
        const isObject = input !== null && input !== undefined && typeof input === 'object';
        if (!isObject) {
          expect(result.valid).toBe(false);
          return;
        }

        const obj = input as Record<string, unknown>;
        const hasValidScore =
          typeof obj.matchScore === 'number' && isFinite(obj.matchScore as number);

        const hasValidGap = (() => {
          const gap = obj.gapAnalysis;
          if (gap === null || gap === undefined || typeof gap !== 'object') return false;
          const g = gap as Record<string, unknown>;
          if (typeof g.matches !== 'string' || typeof g.missing !== 'string') return false;
          if ((g.matches as string).length > maxBulletLength) return false;
          if ((g.missing as string).length > maxBulletLength) return false;
          return true;
        })();

        const shouldAccept = hasValidScore && hasValidGap;

        if (shouldAccept) {
          expect(result.valid).toBe(true);
          expect(result.score).toBeGreaterThanOrEqual(1);
          expect(result.score).toBeLessThanOrEqual(10);
          expect(result.gapAnalysis).toBeDefined();
        } else {
          expect(result.valid).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});
