/**
 * Adzuna API fetcher with pagination and exponential backoff retry.
 * Fetches internship postings filtered to technology/software categories.
 *
 * Requirements: 1.1, 1.4, 1.5
 */

import {
  RETRY_CONFIG,
  INGESTION_CONSTRAINTS,
  POSTING_SOURCES,
} from '@interniq/shared/constants';
import type { PostingSource } from '@interniq/shared/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdzunaConfig {
  appId: string;
  apiKey: string;
  /** Base URL for the Adzuna API (default: https://api.adzuna.com/v1/api) */
  baseUrl?: string;
  /** Country code (default: us) */
  country?: string;
  /** Results per page (default: 50) */
  resultsPerPage?: number;
}

/** Shape of a single result from the Adzuna API response */
export interface AdzunaApiResult {
  id: string;
  title: string;
  description: string;
  company: { display_name: string };
  location: { display_name: string; area: string[] };
  redirect_url: string;
  created: string;
  category: { tag: string; label: string };
  [key: string]: unknown;
}

/** Adzuna API page response */
export interface AdzunaApiResponse {
  results: AdzunaApiResult[];
  count: number;
}

/** Raw posting object ready for Firestore storage */
export interface RawAdzunaPosting {
  id: string;
  source: PostingSource;
  rawContent: string;
  ingestedAt: Date;
  status: 'raw';
}

// ─── Default fetch implementation ───────────────────────────────────────────

type FetchFn = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const defaultFetch: FetchFn = async (url: string) => {
  const response = await fetch(url);
  return response;
};

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
 * Build the Adzuna API URL for fetching technology/software internship postings.
 */
function buildAdzunaUrl(config: AdzunaConfig, page: number): string {
  const baseUrl = config.baseUrl ?? 'https://api.adzuna.com/v1/api';
  const country = config.country ?? 'us';
  const resultsPerPage = config.resultsPerPage ?? 50;

  const params = new URLSearchParams({
    app_id: config.appId,
    app_key: config.apiKey,
    results_per_page: String(resultsPerPage),
    what: 'intern',
    category: 'it-jobs',
  });

  return `${baseUrl}/jobs/${country}/search/${page}?${params.toString()}`;
}

// ─── Main Fetcher ───────────────────────────────────────────────────────────

/**
 * Fetch internship postings from the Adzuna API with pagination and retry logic.
 *
 * - Paginates through results until all available postings are retrieved or
 *   INGESTION_CONSTRAINTS.maxPostingsPerRun (500) is reached.
 * - Filters to technology/software categories via the `category` parameter.
 * - On error: logs with timestamp, retries with exponential backoff (1s * 2^(attempt-1)).
 * - If all retries fail: logs final failure, throws error (no partial results per Req 1.5).
 *
 * @param config - Adzuna API configuration (appId, apiKey, optional baseUrl/country)
 * @param fetchFn - Optional fetch implementation for testing
 * @returns Array of raw posting objects ready for Firestore storage
 * @throws Error if all retry attempts are exhausted
 */
export async function fetchAdzunaPostings(
  config: AdzunaConfig,
  fetchFn: FetchFn = defaultFetch
): Promise<RawAdzunaPosting[]> {
  const { maxRetries, baseIntervalMs, maxDelayMs } = RETRY_CONFIG.ingestionAdzuna;
  const maxPostings = INGESTION_CONSTRAINTS.maxPostingsPerRun;
  const resultsPerPage = config.resultsPerPage ?? 50;

  const postings: RawAdzunaPosting[] = [];
  let page = 1;

  while (postings.length < maxPostings) {
    const url = buildAdzunaUrl(config, page);
    const responseData = await fetchPageWithRetry(url, page, fetchFn, maxRetries, baseIntervalMs, maxDelayMs);

    const results = responseData.results;
    if (!results || results.length === 0) {
      // No more results available
      break;
    }

    for (const result of results) {
      if (postings.length >= maxPostings) {
        break;
      }

      postings.push({
        id: String(result.id),
        source: POSTING_SOURCES.ADZUNA as PostingSource,
        rawContent: JSON.stringify(result),
        ingestedAt: new Date(),
        status: 'raw',
      });
    }

    // If we got fewer results than requested, we've reached the last page
    if (results.length < resultsPerPage) {
      break;
    }

    page++;
  }

  return postings;
}

/**
 * Fetch a single page from the Adzuna API with retry logic.
 * Retries on failure with exponential backoff. Throws if all retries are exhausted.
 */
async function fetchPageWithRetry(
  url: string,
  page: number,
  fetchFn: FetchFn,
  maxRetries: number,
  baseIntervalMs: number,
  maxDelayMs: number
): Promise<AdzunaApiResponse> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fetchFn(url);

      if (!response.ok) {
        throw new Error(`Adzuna API returned HTTP ${response.status} for page ${page}`);
      }

      const data = await response.json();
      return data as AdzunaApiResponse;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt <= maxRetries) {
        const delayMs = calculateBackoffDelay(attempt, baseIntervalMs, maxDelayMs);
        console.error(
          `[${new Date().toISOString()}] Adzuna API error (page ${page}, attempt ${attempt}/${maxRetries + 1}): ${lastError.message}. Retrying in ${delayMs}ms...`
        );
        await delay(delayMs);
      }
    }
  }

  // All retries exhausted — log final failure and throw (Req 1.5: no partial results)
  const finalMessage = `[${new Date().toISOString()}] Adzuna API: all ${maxRetries + 1} attempts failed for page ${page}. Last error: ${lastError?.message}`;
  console.error(finalMessage);
  throw new Error(finalMessage);
}
