/**
 * SimplifyJobs GitHub fetcher with exponential backoff retry.
 * Fetches the raw markdown internship table from the SimplifyJobs Summer 2026
 * GitHub repository and parses it into structured posting records.
 *
 * Requirements: 2.1, 2.4, 2.6
 */

import {
  RETRY_CONFIG,
  POSTING_SOURCES,
} from '@interniq/shared/constants';
import type { PostingSource, ParsedRow } from '@interniq/shared/types';
import { parseMarkdownTable } from './simplifyParser';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SimplifyFetcherConfig {
  /** URL to the raw markdown file (default: SimplifyJobs Summer 2026 repo) */
  markdownUrl?: string;
}

/** Raw posting object ready for Firestore storage */
export interface RawSimplifyPosting {
  id: string;
  source: PostingSource;
  rawContent: string;
  parsedRow: ParsedRow;
  ingestedAt: Date;
  status: 'raw';
}

export type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_MARKDOWN_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/Summer2026-Internships/dev/README.md';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Delay execution by the specified number of milliseconds.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay: baseInterval * 2^(attempt - 1), capped at maxDelay.
 */
function calculateBackoffDelay(attempt: number, baseIntervalMs: number, maxDelayMs: number): number {
  const uncapped = baseIntervalMs * Math.pow(2, attempt - 1);
  return Math.min(uncapped, maxDelayMs);
}

/**
 * Validate that the markdown content contains a recognizable table structure.
 * A recognizable table is defined as at least one header row followed by a
 * separator row and at least one data row.
 *
 * Header row: starts and ends with `|`, contains `|` separators
 * Separator row: starts and ends with `|`, contains only dashes, colons, spaces, and pipes
 * Data row: starts and ends with `|`, contains `|` separators
 */
export function hasValidTableStructure(markdown: string): boolean {
  const lines = markdown.split('\n');

  for (let i = 0; i < lines.length - 2; i++) {
    const line = lines[i]!.trim();
    const nextLine = lines[i + 1]!.trim();
    const dataLine = lines[i + 2]!.trim();

    if (isTableRow(line) && isSeparatorRow(nextLine) && isTableRow(dataLine)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a line looks like a table row (has pipes at start and end).
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
  return /^[\s|:\-]+$/.test(inner);
}

/**
 * Derive a unique ID for a SimplifyJobs posting from company name and role title.
 */
function derivePostingId(company: string, role: string): string {
  const normalized = `${company}-${role}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized;
}

// ─── Default fetch implementation ───────────────────────────────────────────

const defaultFetch: FetchFn = async (url: string) => {
  const response = await fetch(url);
  return response;
};

// ─── Main Fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch and parse internship postings from the SimplifyJobs GitHub repository.
 *
 * - Fetches the raw markdown from the configured URL.
 * - Validates the markdown contains a recognizable table structure.
 * - Parses all valid rows into ParsedRow objects using the existing parser.
 * - On error: logs with timestamp, retries with exponential backoff (1s * 2^(attempt-1)).
 * - If all retries fail: logs final failure, throws error (Req 2.6).
 *
 * @param config - Optional configuration (markdownUrl override)
 * @param fetchFn - Optional fetch implementation for testing
 * @returns Array of raw posting objects ready for Firestore storage
 * @throws Error if all retry attempts are exhausted or markdown has no valid table
 */
export async function fetchSimplifyPostings(
  config: SimplifyFetcherConfig = {},
  fetchFn: FetchFn = defaultFetch
): Promise<RawSimplifyPosting[]> {
  const { maxRetries, baseIntervalMs, maxDelayMs } = RETRY_CONFIG.ingestionSimplify;
  const url = config.markdownUrl ?? DEFAULT_MARKDOWN_URL;

  const markdown = await fetchMarkdownWithRetry(url, fetchFn, maxRetries, baseIntervalMs, maxDelayMs);

  // Validate table structure (Req 2.4)
  if (!hasValidTableStructure(markdown)) {
    const errorMsg = `[${new Date().toISOString()}] SimplifyJobs: markdown does not contain a recognizable table structure`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }

  // Parse all valid rows (invalid rows are skipped and logged by parseMarkdownTable)
  const parsedRows = parseMarkdownTable(markdown);

  // Convert to raw posting objects
  const postings: RawSimplifyPosting[] = parsedRows.map((row) => ({
    id: derivePostingId(row.company, row.role),
    source: POSTING_SOURCES.SIMPLIFYJOBS as PostingSource,
    rawContent: JSON.stringify(row),
    parsedRow: row,
    ingestedAt: new Date(),
    status: 'raw' as const,
  }));

  return postings;
}

/**
 * Fetch the raw markdown content with retry logic.
 * Retries on network errors or non-OK responses with exponential backoff.
 * Throws if all retries are exhausted.
 */
async function fetchMarkdownWithRetry(
  url: string,
  fetchFn: FetchFn,
  maxRetries: number,
  baseIntervalMs: number,
  maxDelayMs: number
): Promise<string> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fetchFn(url);

      if (!response.ok) {
        throw new Error(`SimplifyJobs GitHub returned HTTP ${response.status}`);
      }

      const text = await response.text();
      return text;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt <= maxRetries) {
        const delayMs = calculateBackoffDelay(attempt, baseIntervalMs, maxDelayMs);
        console.error(
          `[${new Date().toISOString()}] SimplifyJobs fetch error (attempt ${attempt}/${maxRetries + 1}): ${lastError.message}. Retrying in ${delayMs}ms...`
        );
        await delay(delayMs);
      }
    }
  }

  // All retries exhausted — log final failure and throw (Req 2.6)
  const finalMessage = `[${new Date().toISOString()}] SimplifyJobs: all ${maxRetries + 1} attempts failed. Last error: ${lastError?.message}`;
  console.error(finalMessage);
  throw new Error(finalMessage);
}
