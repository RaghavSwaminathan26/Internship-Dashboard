// Feature: interniq-dashboard, Property 2: Parser Resilience with Invalid Rows
// **Validates: Requirements 2.5**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { parseMarkdownTable, parseMarkdownRow } from '../../packages/functions/src/ingestion/simplifyParser';

/**
 * Generates a string that is non-empty after trimming and does not contain pipe characters.
 * These are valid cell values for the markdown parser.
 */
const validCellArb = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => !s.includes('|') && s.trim().length > 0);

/**
 * Generates a valid markdown table row with non-empty fields.
 * A row is considered valid by the parser if:
 * 1. It starts and ends with |
 * 2. It has at least 5 columns when split by |
 * 3. All 5 required fields are non-empty after trim
 */
const validRowArb = fc
  .tuple(validCellArb, validCellArb, validCellArb, validCellArb, validCellArb)
  .map(([company, role, location, link, date]) => {
    return `| ${company} | ${role} | ${location} | ${link} | ${date} |`;
  });

/**
 * Generates rows that the parser will definitely reject (return null from parseMarkdownRow).
 * Invalid rows include:
 * - Too few columns (less than 5)
 * - Missing leading pipe
 * - Missing trailing pipe
 * - Rows with empty cells (trimmed to empty)
 * - Empty lines
 * - Non-table text (no pipes at all)
 */
const invalidRowArb: fc.Arbitrary<string> = fc.oneof(
  // Row with too few columns (1-4 columns)
  fc.integer({ min: 1, max: 4 }).chain((cols) => {
    return fc
      .array(validCellArb, { minLength: cols, maxLength: cols })
      .map((cells) => `| ${cells.join(' | ')} |`);
  }),
  // Row missing leading pipe
  fc
    .tuple(validCellArb, validCellArb, validCellArb, validCellArb, validCellArb)
    .map(([a, b, c, d, e]) => `${a} | ${b} | ${c} | ${d} | ${e} |`),
  // Row missing trailing pipe
  fc
    .tuple(validCellArb, validCellArb, validCellArb, validCellArb, validCellArb)
    .map(([a, b, c, d, e]) => `| ${a} | ${b} | ${c} | ${d} | ${e}`),
  // Row with at least one empty cell
  fc.integer({ min: 0, max: 4 }).chain((emptyIdx) => {
    return fc
      .tuple(validCellArb, validCellArb, validCellArb, validCellArb, validCellArb)
      .map(([a, b, c, d, e]) => {
        const cells = [a, b, c, d, e];
        cells[emptyIdx] = '  '; // whitespace-only becomes empty after trim
        return `| ${cells.join(' | ')} |`;
      });
  }),
  // Empty line
  fc.constant(''),
  // Random non-table text (no pipe at start)
  fc.string({ minLength: 1, maxLength: 40 }).filter((s) => !s.startsWith('|') && s.trim().length > 0),
);

/**
 * Verify that invalid rows are actually invalid as determined by parseMarkdownRow.
 * This is a sanity guard for our generator.
 */
function isActuallyValid(row: string): boolean {
  return parseMarkdownRow(row) !== null;
}

/**
 * Generates a markdown table with a proper header and separator, followed by
 * a mix of valid and invalid data rows. We verify the classification against
 * the actual parser to ensure correctness.
 */
const mixedTableArb = fc
  .tuple(
    fc.array(validRowArb, { minLength: 0, maxLength: 10 }),
    fc.array(invalidRowArb, { minLength: 0, maxLength: 10 }),
  )
  .chain(([validRows, invalidRows]) => {
    const allItems = [
      ...validRows.map((row) => ({ row, expectedValid: true })),
      ...invalidRows.map((row) => ({ row, expectedValid: false })),
    ];

    return fc
      .shuffledSubarray(allItems, { minLength: allItems.length, maxLength: allItems.length })
      .map((shuffled) => {
        const header = '| Company | Role | Location | Application/Link | Date Posted |';
        const separator = '| --- | --- | --- | --- | --- |';
        const dataLines = shuffled.map((item) => item.row);
        const markdown = [header, separator, ...dataLines].join('\n');

        // Use the actual parser to determine which rows are truly valid in context.
        // This ensures our property test is grounded in real behavior.
        const actuallyValidRows = shuffled.filter((item) => isActuallyValid(item.row));
        const validCount = actuallyValidRows.length;
        const validRowsInOrder = actuallyValidRows.map((item) => item.row);

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
          const expectedParsed = parseMarkdownRow(expectedRow);
          expect(results[i]).toEqual(expectedParsed);
        }
      }),
      { numRuns: 100 },
    );
  });
});
