/**
 * Shared constants for InternIQ Dashboard.
 * Field constraints, retry configurations, and status enums.
 */

// ─── Field Constraints ──────────────────────────────────────────────────────
export const FIELD_CONSTRAINTS = {
  roleTitle: { maxLength: 200 },
  company: { maxLength: 200 },
  location: { maxLength: 200 },
  techStack: { maxItems: 30, itemMaxLength: 50 },
  deadline: { format: 'iso8601-date-or-null' as const },
  workMode: { enum: ['remote', 'hybrid', 'onsite'] as const },
  summary: { maxLength: 200 },
} as const;

// ─── Resume Constraints ─────────────────────────────────────────────────────
export const RESUME_CONSTRAINTS = {
  maxLength: 10_000,
  minNonWhitespaceChars: 50,
} as const;

// ─── Gap Analysis Constraints ───────────────────────────────────────────────
export const GAP_ANALYSIS_CONSTRAINTS = {
  maxBulletLength: 200,
  requiredBullets: 2,
} as const;

// ─── Score Constraints ──────────────────────────────────────────────────────
export const SCORE_CONSTRAINTS = {
  min: 1,
  max: 10,
} as const;

// ─── Filter Constraints ─────────────────────────────────────────────────────
export const FILTER_CONSTRAINTS = {
  locationMaxLength: 100,
} as const;

// ─── Ingestion Constraints ──────────────────────────────────────────────────
export const INGESTION_CONSTRAINTS = {
  maxPostingsPerRun: 500,
} as const;

// ─── Retry Configuration ────────────────────────────────────────────────────
// delay = baseInterval * 2^(attemptNumber - 1)
export interface RetryConfig {
  maxRetries: number;
  baseIntervalMs: number;
  maxDelayMs: number;
}


export const RETRY_CONFIG = {
  ingestionAdzuna: {
    maxRetries: 3,
    baseIntervalMs: 1_000,
    maxDelayMs: 4_000,
  } satisfies RetryConfig,

  ingestionSimplify: {
    maxRetries: 3,
    baseIntervalMs: 1_000,
    maxDelayMs: 4_000,
  } satisfies RetryConfig,

  extraction: {
    maxRetries: 3,
    baseIntervalMs: 2_000,
    maxDelayMs: 8_000,
  } satisfies RetryConfig,

  scoring: {
    maxRetries: 3,
    baseIntervalMs: 5_000,
    maxDelayMs: 20_000,
  } satisfies RetryConfig,
} as const;

// ─── Posting Status Values ──────────────────────────────────────────────────
export const POSTING_STATUS = {
  RAW: 'raw',
  EXTRACTED: 'extracted',
  EXTRACTION_FAILED: 'extraction_failed',
  SCORED: 'scored',
  SCORING_FAILED: 'scoring_failed',
  NEEDS_MANUAL_REVIEW: 'needs_manual_review',
} as const;

export type PostingStatusValue = (typeof POSTING_STATUS)[keyof typeof POSTING_STATUS];

// ─── Posting Sources ────────────────────────────────────────────────────────
export const POSTING_SOURCES = {
  ADZUNA: 'adzuna',
  SIMPLIFYJOBS: 'simplifyjobs',
} as const;

export type PostingSourceValue = (typeof POSTING_SOURCES)[keyof typeof POSTING_SOURCES];

// ─── Work Mode Values ───────────────────────────────────────────────────────
export const WORK_MODES = {
  REMOTE: 'remote',
  HYBRID: 'hybrid',
  ONSITE: 'onsite',
} as const;

export type WorkModeValue = (typeof WORK_MODES)[keyof typeof WORK_MODES];

// ─── Scoring Timeout ────────────────────────────────────────────────────────
export const SCORING_TIMEOUT_MS = 60_000; // 60 seconds

// ─── Trends Chart ───────────────────────────────────────────────────────────
export const TRENDS_TOP_N = 10;
