"use strict";
/**
 * Shared constants for InternIQ Dashboard.
 * Field constraints, retry configurations, and status enums.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRENDS_TOP_N = exports.SCORING_TIMEOUT_MS = exports.WORK_MODES = exports.POSTING_SOURCES = exports.POSTING_STATUS = exports.RETRY_CONFIG = exports.INGESTION_CONSTRAINTS = exports.FILTER_CONSTRAINTS = exports.SCORE_CONSTRAINTS = exports.GAP_ANALYSIS_CONSTRAINTS = exports.RESUME_CONSTRAINTS = exports.FIELD_CONSTRAINTS = void 0;
// ─── Field Constraints ──────────────────────────────────────────────────────
exports.FIELD_CONSTRAINTS = {
    roleTitle: { maxLength: 200 },
    company: { maxLength: 200 },
    location: { maxLength: 200 },
    techStack: { maxItems: 30, itemMaxLength: 50 },
    deadline: { format: 'iso8601-date-or-null' },
    workMode: { enum: ['remote', 'hybrid', 'onsite'] },
    summary: { maxLength: 200 },
};
// ─── Resume Constraints ─────────────────────────────────────────────────────
exports.RESUME_CONSTRAINTS = {
    maxLength: 10000,
    minNonWhitespaceChars: 50,
};
// ─── Gap Analysis Constraints ───────────────────────────────────────────────
exports.GAP_ANALYSIS_CONSTRAINTS = {
    maxBulletLength: 200,
    requiredBullets: 2,
};
// ─── Score Constraints ──────────────────────────────────────────────────────
exports.SCORE_CONSTRAINTS = {
    min: 1,
    max: 10,
};
// ─── Filter Constraints ─────────────────────────────────────────────────────
exports.FILTER_CONSTRAINTS = {
    locationMaxLength: 100,
};
// ─── Ingestion Constraints ──────────────────────────────────────────────────
exports.INGESTION_CONSTRAINTS = {
    maxPostingsPerRun: 500,
};
exports.RETRY_CONFIG = {
    ingestionAdzuna: {
        maxRetries: 3,
        baseIntervalMs: 1000,
        maxDelayMs: 4000,
    },
    ingestionSimplify: {
        maxRetries: 3,
        baseIntervalMs: 1000,
        maxDelayMs: 4000,
    },
    extraction: {
        maxRetries: 3,
        baseIntervalMs: 2000,
        maxDelayMs: 8000,
    },
    scoring: {
        maxRetries: 3,
        baseIntervalMs: 5000,
        maxDelayMs: 20000,
    },
};
// ─── Posting Status Values ──────────────────────────────────────────────────
exports.POSTING_STATUS = {
    RAW: 'raw',
    EXTRACTED: 'extracted',
    EXTRACTION_FAILED: 'extraction_failed',
    SCORED: 'scored',
    SCORING_FAILED: 'scoring_failed',
    NEEDS_MANUAL_REVIEW: 'needs_manual_review',
};
// ─── Posting Sources ────────────────────────────────────────────────────────
exports.POSTING_SOURCES = {
    ADZUNA: 'adzuna',
    SIMPLIFYJOBS: 'simplifyjobs',
};
// ─── Work Mode Values ───────────────────────────────────────────────────────
exports.WORK_MODES = {
    REMOTE: 'remote',
    HYBRID: 'hybrid',
    ONSITE: 'onsite',
};
// ─── Scoring Timeout ────────────────────────────────────────────────────────
exports.SCORING_TIMEOUT_MS = 60000; // 60 seconds
// ─── Trends Chart ───────────────────────────────────────────────────────────
exports.TRENDS_TOP_N = 10;
//# sourceMappingURL=constants.js.map