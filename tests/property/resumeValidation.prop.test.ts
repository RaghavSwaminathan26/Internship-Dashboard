// Feature: interniq-dashboard, Property 7: Resume Input Validation
// **Validates: Requirements 4.10, 8.3**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateResumeInput } from '../../packages/functions/src/scoring/resumeValidation';
import { RESUME_CONSTRAINTS } from '../../packages/shared/constants';

const { maxLength, minNonWhitespaceChars } = RESUME_CONSTRAINTS;

/**
 * Helper: count non-whitespace characters in a string (characters NOT matched by \s).
 */
function countNonWhitespace(text: string): number {
  return text.replace(/\s/g, '').length;
}

/**
 * Generator for strings composed of a mix of whitespace and non-whitespace characters
 * with controlled length and ratio.
 */
function resumeTextArbitrary(opts: {
  minLen?: number;
  maxLen?: number;
}): fc.Arbitrary<string> {
  const minLen = opts.minLen ?? 0;
  const maxLen = opts.maxLen ?? maxLength + 500;

  // Generate a string with a mix of whitespace and non-whitespace
  return fc
    .array(
      fc.oneof(
        // Non-whitespace characters (printable ASCII excluding whitespace)
        fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
        // Whitespace characters: space, tab, newline, carriage return
        fc.constantFrom(' ', '\t', '\n', '\r')
      ),
      { minLength: minLen, maxLength: maxLen }
    )
    .map((chars) => chars.join(''));
}

describe('Property 7: Resume Input Validation', () => {
  it('rejects strings with more than 10,000 total characters', () => {
    // Generate strings that exceed maxLength but have enough non-whitespace
    const tooLongText = fc
      .integer({ min: maxLength + 1, max: maxLength + 2000 })
      .chain((len) =>
        fc.array(
          fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
          { minLength: len, maxLength: len }
        ).map((chars) => chars.join(''))
      );

    fc.assert(
      fc.property(tooLongText, (text: string) => {
        const result = validateResumeInput(text);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects strings with fewer than 50 non-whitespace characters', () => {
    // Generate strings that are within maxLength but have < 50 non-whitespace chars
    const tooFewNonWhitespace = fc
      .integer({ min: 0, max: minNonWhitespaceChars - 1 })
      .chain((nonWsCount) =>
        fc.tuple(
          // Generate exactly nonWsCount non-whitespace characters
          fc.array(
            fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
            { minLength: nonWsCount, maxLength: nonWsCount }
          ),
          // Generate some whitespace padding (keep total within maxLength)
          fc.array(
            fc.constantFrom(' ', '\t', '\n', '\r'),
            { minLength: 0, maxLength: Math.min(200, maxLength - nonWsCount) }
          )
        ).map(([nonWs, ws]) => {
          // Interleave non-whitespace and whitespace
          const combined = [...nonWs, ...ws];
          // Shuffle deterministically by interleaving
          const result: string[] = [];
          let ni = 0, wi = 0;
          while (ni < nonWs.length || wi < ws.length) {
            if (ni < nonWs.length) result.push(nonWs[ni++]);
            if (wi < ws.length) result.push(ws[wi++]);
          }
          return result.join('');
        })
      );

    fc.assert(
      fc.property(tooFewNonWhitespace, (text: string) => {
        const result = validateResumeInput(text);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('accepts strings with at most 10,000 total chars AND at least 50 non-whitespace chars', () => {
    // Generate valid strings: length <= maxLength and >= minNonWhitespaceChars non-whitespace
    const validText = fc
      .integer({ min: minNonWhitespaceChars, max: 500 })
      .chain((nonWsCount) =>
        fc.tuple(
          // Generate exactly nonWsCount non-whitespace characters
          fc.array(
            fc.integer({ min: 33, max: 126 }).map((c) => String.fromCharCode(c)),
            { minLength: nonWsCount, maxLength: nonWsCount }
          ),
          // Generate whitespace to pad, keeping total <= maxLength
          fc.array(
            fc.constantFrom(' ', '\t', '\n', '\r'),
            { minLength: 0, maxLength: Math.min(200, maxLength - nonWsCount) }
          )
        ).map(([nonWs, ws]) => {
          // Interleave them
          const result: string[] = [];
          let ni = 0, wi = 0;
          while (ni < nonWs.length || wi < ws.length) {
            if (ni < nonWs.length) result.push(nonWs[ni++]);
            if (wi < ws.length) result.push(ws[wi++]);
          }
          return result.join('');
        })
      );

    fc.assert(
      fc.property(validText, (text: string) => {
        // Confirm preconditions
        expect(text.length).toBeLessThanOrEqual(maxLength);
        expect(countNonWhitespace(text)).toBeGreaterThanOrEqual(minNonWhitespaceChars);

        const result = validateResumeInput(text);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      }),
      { numRuns: 100 }
    );
  });

  it('correctly classifies arbitrary strings based on length and non-whitespace count', () => {
    fc.assert(
      fc.property(resumeTextArbitrary({ minLen: 0, maxLen: maxLength + 500 }), (text: string) => {
        const result = validateResumeInput(text);
        const totalChars = text.length;
        const nonWsChars = countNonWhitespace(text);

        const shouldReject = totalChars > maxLength || nonWsChars < minNonWhitespaceChars;

        if (shouldReject) {
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThan(0);
        } else {
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }
      }),
      { numRuns: 100 }
    );
  });
});
