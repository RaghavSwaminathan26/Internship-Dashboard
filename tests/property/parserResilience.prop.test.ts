// Feature: interniq-dashboard, Property 2: Parser Resilience with Invalid Rows
// **Validates: Requirements 2.5**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseMarkdownTable } from '../../packages/functions/src/ingestion/simplifyParser';

/**
 * Generates a valid markdown table row with non-empty fields that won't be
 * misinterpreted as separator rows or contain pipe characters.
 */
const validRowArb = fc
  .record({
    company: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('|') && s.trim().length > 0 && !/^[\s:\-]+$/.test(s)),
    role: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('|') && s.trim().length > 0 && !/^[\s:\-]+$/.test(s)),
    location: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('|') && s.trim().length > 0 && !/^[\s:\-]+$/.test(s)),
    applicationLink: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('|') && s.trim().length > 0 && !/^[\s:\-]+$/.test(s)),
    datePosted: fc.string({ minLength: 1, maxLength: 30 }).filter((s) => !s.includes('|') && s.trim().length > 0 && !/^[\s:\-]+$/.test(s)),
  })
  .map(({ company, role, location, applicationLink, datePosted }) => {
    return `| ${company} | ${role} | ${location} | ${applicationLink} | ${datePosted} |`;
  });

/**
 * Generates various types of invalid markdown rows:
 * - Too few columns (less than 5)
 * - Missing leading/trailing pipes
 * - Empty fields
 * - Only separators/dashes
 * - Completely empty strings
 */
const invalidRowArb = fc.oneof(
  // Row with too few columns (1-4 columns only)
  fc.integer({ min: 1, max: 3 }).chain((cols) => {
    return fc
      .array(fc.string({ minLength: 1, maxLength: 15 }).filter((s) => !s.includes('|')), { minLength: cols, maxLength: cols })
      .map((cells) => `| ${cells.join(' | ')} |`);
  }),
  // Row missing leading pipe
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.startsWith('|') && s.trim().length > 0).map((s) => s),
  // Row missing trailing pipe
  fc.constant('| Something | Data | Here | Link | Date'),
  // Row with all empty cells
  fc.constant('|  |  |  |  |  |'),
  // Separator-only row
  fc.constant('| --- | --- | --- | --- | --- |'),
  // Empty line
  fc.constant(''),
  // Random non-table text
  fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.includes('|') && s.trim().length > 0),
);

/**
 * Generates a markdown table with a proper header and separator, followed by
 * a mix of valid and invalid data rows. Tracks which rows are valid.
 */
const mixedTableArb = fc
  .record({
    validRows: fc.array(validRowArb, { minLength: 0, maxLength: 10 }),
    invalidRows: fc.array(invalidRowArb, { minLength: 0, maxLength: 10 }),
  })
  .chain(({ validRows, invalidRows }) => {
    // Interleave valid and invalid rows randomly
    const allRows = [
      ...validRows.map((row) => ({ row, valid: true })),
      ...invalidRows.map((row) => ({ row, valid: false })),
    ];

    return fc.shuffledSubarray(allRows, { minLength: allRows.length, maxLength: allRows.length }).map((shuffled) => {
      const header = '| Company | Role | Location | Application/Link | Date Posted |';
      const separator = '| --- | --- | --- | --- | --- |';
      const dataLines = shuffled.map((item) => item.row);
      const markdown = [header, separator, ...dataLines].join('\n');
      const validCount = shuffled.filter((item) => item.valid).length;
      const validRowsInOrder = shuffled.filter((item) => item.valid).map((item) => item.row);
      return { markdown, validCount, validRowsInOrder };
    });
  });

describe('Property 2: Parser Resilience with Invalid Rows', () => {
  it('parsed result count equals valid input row count, and order is preserved', () => {
    fc.assert(
      fc.property(mixedTableArb, ({ markdown, validCount, validRowsInOrder }) => {
        const results = parseMarkdownTable(markdown);

        // The count of parsed results should equal the count of valid rows
        expect(results.length).toBe(validCount);

        // Order should be preserved: the i-th result should correspond to the i-th valid row
        for (let i = 0; i < results.length; i++) {
          const expectedRow = validRowsInOrder[i]!;
          // Parse the expected row to get the expected ParsedRow
          const cells = expectedRow.slice(1, -1).split('|').map((c) => c.trim());
          expect(results[i]!.company).toBe(cells[0]);
          expect(results[i]!.role).toBe(cells[1]);
          expect(results[i]!.location).toBe(cells[2]);
          expect(results[i]!.applicationLink).toBe(cells[3]);
          expect(results[i]!.datePosted).toBe(cells[4]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
