/**
 * SimplifyJobs Markdown Table Parser
 *
 * Parses the internship table from the SimplifyJobs GitHub repository
 * markdown file into structured ParsedRow objects.
 */

import { ParsedRow } from '@interniq/shared';

/**
 * Parse an entire markdown table into an array of ParsedRow objects.
 * Skips the header row and separator row, then parses each data row.
 * Invalid rows are skipped and logged.
 */
export function parseMarkdownTable(markdown: string): ParsedRow[] {
  const lines = markdown.split('\n');
  const results: ParsedRow[] = [];

  // Find the table: look for header row followed by separator row
  let dataStartIndex = -1;
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!.trim();
    const nextLine = lines[i + 1]!.trim();

    if (isTableRow(line) && isSeparatorRow(nextLine)) {
      dataStartIndex = i + 2; // Skip header + separator
      break;
    }
  }

  if (dataStartIndex === -1) {
    return results;
  }

  // Parse data rows
  for (let i = dataStartIndex; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Stop if we reach a non-table line (empty or no pipes)
    if (!line || !isTableRow(line)) {
      continue;
    }

    const parsed = parseMarkdownRow(line);
    if (parsed) {
      results.push(parsed);
    } else {
      console.warn(`[SimplifyParser] Skipping invalid row at line ${i + 1}: ${line}`);
    }
  }

  return results;
}

/**
 * Parse a single markdown table row into a ParsedRow object.
 * Returns null if the row is invalid or cannot be parsed.
 */
export function parseMarkdownRow(row: string): ParsedRow | null {
  // Remove leading/trailing pipes and split by pipe
  const trimmed = row.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }

  const cells = trimmed
    .slice(1, -1) // Remove first and last pipe
    .split('|')
    .map((cell) => cell.trim());

  // We expect at least 5 columns: company, role, location, applicationLink, datePosted
  if (cells.length < 5) {
    return null;
  }

  const company = cells[0] ?? '';
  const role = cells[1] ?? '';
  const location = cells[2] ?? '';
  const applicationLink = cells[3] ?? '';
  const datePosted = cells[4] ?? '';

  // All fields must be non-empty for a valid row
  if (!company || !role || !location || !applicationLink || !datePosted) {
    return null;
  }

  return {
    company,
    role,
    location,
    applicationLink,
    datePosted,
  };
}

/**
 * Serialize a ParsedRow back to a markdown table row string.
 * Used for round-trip testing (Property 1).
 */
export function serializeToMarkdownRow(row: ParsedRow): string {
  return `| ${row.company} | ${row.role} | ${row.location} | ${row.applicationLink} | ${row.datePosted} |`;
}

/**
 * Check if a line looks like a table row (has pipes).
 */
function isTableRow(line: string): boolean {
  return line.startsWith('|') && line.endsWith('|') && line.includes('|');
}

/**
 * Check if a line is a markdown table separator row (e.g., |---|---|---|).
 */
function isSeparatorRow(line: string): boolean {
  if (!line.startsWith('|') || !line.endsWith('|')) {
    return false;
  }
  const inner = line.slice(1, -1);
  // Separator cells contain only dashes, colons, spaces, and pipes
  return /^[\s|:\-]+$/.test(inner);
}
