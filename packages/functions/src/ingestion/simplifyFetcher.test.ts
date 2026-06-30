/**
 * Unit tests for SimplifyJobs fetcher with retry logic.
 * Tests: fetch, retry, validation of table structure, and parsing.
 */

import { describe, it, expect } from 'vitest';
import {
  fetchSimplifyPostings,
  hasValidTableStructure,
  type FetchFn,
} from './simplifyFetcher';

// ─── Test Helpers ───────────────────────────────────────────────────────────

const VALID_MARKDOWN = `# Summer 2026 Internships

| Company | Role | Location | Application | Date Posted |
|---------|------|----------|-------------|-------------|
| Google | SWE Intern | Mountain View, CA | https://google.com/apply | Jan 15 |
| Meta | ML Intern | Menlo Park, CA | https://meta.com/apply | Jan 16 |
| Amazon | Backend Intern | Seattle, WA | https://amazon.com/apply | Jan 17 |
`;

const INVALID_MARKDOWN_NO_TABLE = `# Summer 2026 Internships

This is a list of internships:
- Google SWE Intern
- Meta ML Intern
`;

function createMockFetch(response: { ok: boolean; status: number; text: string }): FetchFn {
  return async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => response.text,
  });
}

function createFailingFetch(error: Error): FetchFn {
  return async () => {
    throw error;
  };
}

function createFetchSequence(responses: Array<{ ok: boolean; status: number; text: string } | Error>): FetchFn {
  let callIndex = 0;
  return async () => {
    const response = responses[callIndex++];
    if (response instanceof Error) {
      throw response;
    }
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.text,
    };
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('hasValidTableStructure', () => {
  it('returns true for valid markdown with table', () => {
    expect(hasValidTableStructure(VALID_MARKDOWN)).toBe(true);
  });

  it('returns false for markdown without a table', () => {
    expect(hasValidTableStructure(INVALID_MARKDOWN_NO_TABLE)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(hasValidTableStructure('')).toBe(false);
  });

  it('returns false for table with header and separator but no data rows', () => {
    const noDataRows = `| Company | Role |
|---------|------|
`;
    expect(hasValidTableStructure(noDataRows)).toBe(false);
  });

  it('returns true for minimal valid table (header + separator + one data row)', () => {
    const minimal = `| Company | Role | Location | Link | Date |
|---|---|---|---|---|
| Google | SWE | CA | http://g.co | Jan |`;
    expect(hasValidTableStructure(minimal)).toBe(true);
  });
});

describe('fetchSimplifyPostings', () => {
  it('fetches and parses markdown into posting records', async () => {
    const mockFetch = createMockFetch({ ok: true, status: 200, text: VALID_MARKDOWN });

    const postings = await fetchSimplifyPostings({}, mockFetch);

    expect(postings).toHaveLength(3);
    expect(postings[0]!.source).toBe('simplifyjobs');
    expect(postings[0]!.status).toBe('raw');
    expect(postings[0]!.parsedRow.company).toBe('Google');
    expect(postings[0]!.parsedRow.role).toBe('SWE Intern');
    expect(postings[1]!.parsedRow.company).toBe('Meta');
    expect(postings[2]!.parsedRow.company).toBe('Amazon');
  });

  it('derives unique IDs from company and role', async () => {
    const mockFetch = createMockFetch({ ok: true, status: 200, text: VALID_MARKDOWN });

    const postings = await fetchSimplifyPostings({}, mockFetch);

    expect(postings[0]!.id).toBe('google-swe-intern');
    expect(postings[1]!.id).toBe('meta-ml-intern');
    expect(postings[2]!.id).toBe('amazon-backend-intern');
  });

  it('throws when markdown has no valid table structure', async () => {
    const mockFetch = createMockFetch({ ok: true, status: 200, text: INVALID_MARKDOWN_NO_TABLE });

    await expect(fetchSimplifyPostings({}, mockFetch)).rejects.toThrow(
      /does not contain a recognizable table structure/
    );
  });

  it('retries on network error with exponential backoff', async () => {
    const fetchFn = createFetchSequence([
      new Error('Network timeout'),
      new Error('Connection refused'),
      { ok: true, status: 200, text: VALID_MARKDOWN },
    ]);

    const postings = await fetchSimplifyPostings({}, fetchFn);
    expect(postings).toHaveLength(3);
  }, 10000);

  it('retries on non-OK HTTP response', async () => {
    const fetchFn = createFetchSequence([
      { ok: false, status: 503, text: 'Service Unavailable' },
      { ok: true, status: 200, text: VALID_MARKDOWN },
    ]);

    const postings = await fetchSimplifyPostings({}, fetchFn);
    expect(postings).toHaveLength(3);
  }, 10000);

  it('throws after all retry attempts are exhausted', async () => {
    const fetchFn = createFailingFetch(new Error('Persistent network error'));

    await expect(fetchSimplifyPostings({}, fetchFn)).rejects.toThrow(
      /all 4 attempts failed/
    );
  }, 15000);

  it('uses custom markdownUrl from config', async () => {
    let requestedUrl = '';
    const mockFetch: FetchFn = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        text: async () => VALID_MARKDOWN,
      };
    };

    await fetchSimplifyPostings({ markdownUrl: 'https://custom.url/README.md' }, mockFetch);
    expect(requestedUrl).toBe('https://custom.url/README.md');
  });

  it('stores rawContent as JSON string of the parsed row', async () => {
    const mockFetch = createMockFetch({ ok: true, status: 200, text: VALID_MARKDOWN });

    const postings = await fetchSimplifyPostings({}, mockFetch);

    const parsed = JSON.parse(postings[0]!.rawContent);
    expect(parsed.company).toBe('Google');
    expect(parsed.role).toBe('SWE Intern');
  });
});
