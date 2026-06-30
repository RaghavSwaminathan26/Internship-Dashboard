import { GapAnalysis } from '@interniq/shared/types';
import { SCORE_CONSTRAINTS, GAP_ANALYSIS_CONSTRAINTS } from '@interniq/shared/constants';

/**
 * Clamps a numeric score to an integer in the range [1, 10].
 *
 * Steps:
 * 1. Round to nearest integer (Math.round)
 * 2. Clamp to [1, 10]: values < 1 become 1, values > 10 become 10
 *
 * @param score - The raw numeric score to clamp
 * @returns An integer in [1, 10]
 */
export function clampScore(score: number): number {
  const rounded = Math.round(score);
  return Math.min(SCORE_CONSTRAINTS.max, Math.max(SCORE_CONSTRAINTS.min, rounded));
}

/**
 * Validates a raw gap analysis object.
 *
 * Checks:
 * - Must be a non-null object
 * - Must have exactly `matches` and `missing` string fields
 * - Each field must be ≤ 200 characters
 *
 * @param raw - The raw value to validate
 * @returns A validated GapAnalysis object, or null if invalid
 */
export function validateGapAnalysis(raw: unknown): GapAnalysis | null {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj.matches !== 'string' || typeof obj.missing !== 'string') {
    return null;
  }

  if (obj.matches.length > GAP_ANALYSIS_CONSTRAINTS.maxBulletLength) {
    return null;
  }

  if (obj.missing.length > GAP_ANALYSIS_CONSTRAINTS.maxBulletLength) {
    return null;
  }

  return {
    matches: obj.matches,
    missing: obj.missing,
  };
}

/**
 * Validates a complete scoring response from OpenAI.
 *
 * Combines score clamping/validation and gap analysis validation.
 * The response is valid only if:
 * - matchScore is a finite number (will be clamped to [1, 10])
 * - gapAnalysis passes validateGapAnalysis checks
 *
 * @param raw - The raw response object to validate
 * @returns Object with valid flag, and optionally the clamped score and validated gap analysis
 */
export function validateScoringResponse(raw: unknown): {
  valid: boolean;
  score?: number;
  gapAnalysis?: GapAnalysis;
} {
  if (raw === null || raw === undefined || typeof raw !== 'object') {
    return { valid: false };
  }

  const obj = raw as Record<string, unknown>;

  // Validate matchScore exists and is a finite number
  if (typeof obj.matchScore !== 'number' || !isFinite(obj.matchScore)) {
    return { valid: false };
  }

  // Validate gap analysis
  const gapAnalysis = validateGapAnalysis(obj.gapAnalysis);
  if (gapAnalysis === null) {
    return { valid: false };
  }

  const score = clampScore(obj.matchScore);

  return {
    valid: true,
    score,
    gapAnalysis,
  };
}
