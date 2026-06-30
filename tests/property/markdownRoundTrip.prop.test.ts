// Feature: interniq-dashboard, Property 1: Markdown Table Parse Round-Trip
// **Validates: Requirements 2.7**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseMarkdownRow, serializeToMarkdownRow } from '../../packages/functions/src/ingestion/simplifyParser';
import { ParsedRow } from '../../packages/shared/types';

/**
 * Generator for non-empty strings that don't contain pipe characters or newlines.
 * Pipe characters would break the markdown table format since they're used as delimiters.
 * Newlines would break row parsing since rows are split by newline.
 */
const nonEmptyNoPipeString = fc.string({ minLength: 1 }).map((s) => {
  // Remove pipes, newlines, and trim
  const cleaned = s.replace(/[|\n\r]/g, '').trim();
  // Ensure non-empty after cleaning
  return cleaned.length > 0 ? cleaned : 'a';
});

/**
 * Generator for valid ParsedRow objects with arbitrary non-empty strings.
 */
const parsedRowArbitrary: fc.Arbitrary<ParsedRow> = fc.record({
  company: nonEmptyNoPipeString,
  role: nonEmptyNoPipeString,
  location: nonEmptyNoPipeString,
  applicationLink: nonEmptyNoPipeString,
  datePosted: nonEmptyNoPipeString,
});

describe('Property 1: Markdown Table Parse Round-Trip', () => {
  it('serialize → parse produces a result equivalent to original', () => {
    fc.assert(
      fc.property(parsedRowArbitrary, (row: ParsedRow) => {
        // Serialize to markdown row
        const serialized = serializeToMarkdownRow(row);

        // Parse it back
        const parsed = parseMarkdownRow(serialized);

        // Must successfully parse
        expect(parsed).not.toBeNull();

        // Must be equivalent to the original
        expect(parsed).toEqual(row);
      }),
      { numRuns: 100 }
    );
  });
});
