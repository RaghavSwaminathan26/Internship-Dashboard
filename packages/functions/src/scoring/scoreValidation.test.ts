import { describe, it, expect } from 'vitest';
import { clampScore, validateGapAnalysis, validateScoringResponse } from './scoreValidation';

describe('clampScore', () => {
  it('returns the same value for integers already in [1, 10]', () => {
    for (let i = 1; i <= 10; i++) {
      expect(clampScore(i)).toBe(i);
    }
  });

  it('rounds floats to nearest integer', () => {
    expect(clampScore(3.4)).toBe(3);
    expect(clampScore(3.5)).toBe(4);
    expect(clampScore(7.9)).toBe(8);
  });

  it('clamps values below 1 to 1', () => {
    expect(clampScore(0)).toBe(1);
    expect(clampScore(-5)).toBe(1);
    expect(clampScore(0.4)).toBe(1);
    expect(clampScore(-100)).toBe(1);
  });

  it('clamps values above 10 to 10', () => {
    expect(clampScore(11)).toBe(10);
    expect(clampScore(100)).toBe(10);
    expect(clampScore(10.4)).toBe(10);
    expect(clampScore(10.6)).toBe(10);
  });
});

describe('validateGapAnalysis', () => {
  it('returns valid GapAnalysis for correct input', () => {
    const result = validateGapAnalysis({
      matches: 'Strong TypeScript skills',
      missing: 'No cloud experience',
    });
    expect(result).toEqual({
      matches: 'Strong TypeScript skills',
      missing: 'No cloud experience',
    });
  });

  it('returns null for null input', () => {
    expect(validateGapAnalysis(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(validateGapAnalysis(undefined)).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(validateGapAnalysis('string')).toBeNull();
    expect(validateGapAnalysis(42)).toBeNull();
    expect(validateGapAnalysis(true)).toBeNull();
  });

  it('returns null when matches is not a string', () => {
    expect(validateGapAnalysis({ matches: 123, missing: 'valid' })).toBeNull();
  });

  it('returns null when missing is not a string', () => {
    expect(validateGapAnalysis({ matches: 'valid', missing: null })).toBeNull();
  });

  it('returns null when matches exceeds 200 chars', () => {
    const longString = 'a'.repeat(201);
    expect(validateGapAnalysis({ matches: longString, missing: 'ok' })).toBeNull();
  });

  it('returns null when missing exceeds 200 chars', () => {
    const longString = 'b'.repeat(201);
    expect(validateGapAnalysis({ matches: 'ok', missing: longString })).toBeNull();
  });

  it('accepts strings at exactly 200 chars', () => {
    const exact200 = 'x'.repeat(200);
    const result = validateGapAnalysis({ matches: exact200, missing: exact200 });
    expect(result).toEqual({ matches: exact200, missing: exact200 });
  });
});

describe('validateScoringResponse', () => {
  it('returns valid result for correct scoring response', () => {
    const result = validateScoringResponse({
      matchScore: 7,
      gapAnalysis: {
        matches: 'Good fit for React role',
        missing: 'Lacks AWS experience',
      },
    });
    expect(result).toEqual({
      valid: true,
      score: 7,
      gapAnalysis: {
        matches: 'Good fit for React role',
        missing: 'Lacks AWS experience',
      },
    });
  });

  it('clamps out-of-range scores while still being valid', () => {
    const result = validateScoringResponse({
      matchScore: 15,
      gapAnalysis: { matches: 'a', missing: 'b' },
    });
    expect(result.valid).toBe(true);
    expect(result.score).toBe(10);
  });

  it('rounds and clamps float scores', () => {
    const result = validateScoringResponse({
      matchScore: 3.7,
      gapAnalysis: { matches: 'a', missing: 'b' },
    });
    expect(result.valid).toBe(true);
    expect(result.score).toBe(4);
  });

  it('returns invalid for null input', () => {
    expect(validateScoringResponse(null)).toEqual({ valid: false });
  });

  it('returns invalid for non-object input', () => {
    expect(validateScoringResponse('hello')).toEqual({ valid: false });
  });

  it('returns invalid when matchScore is missing', () => {
    const result = validateScoringResponse({
      gapAnalysis: { matches: 'a', missing: 'b' },
    });
    expect(result.valid).toBe(false);
  });

  it('returns invalid when matchScore is not a number', () => {
    const result = validateScoringResponse({
      matchScore: 'seven',
      gapAnalysis: { matches: 'a', missing: 'b' },
    });
    expect(result.valid).toBe(false);
  });

  it('returns invalid when matchScore is NaN', () => {
    const result = validateScoringResponse({
      matchScore: NaN,
      gapAnalysis: { matches: 'a', missing: 'b' },
    });
    expect(result.valid).toBe(false);
  });

  it('returns invalid when matchScore is Infinity', () => {
    const result = validateScoringResponse({
      matchScore: Infinity,
      gapAnalysis: { matches: 'a', missing: 'b' },
    });
    expect(result.valid).toBe(false);
  });

  it('returns invalid when gapAnalysis is missing', () => {
    const result = validateScoringResponse({ matchScore: 5 });
    expect(result.valid).toBe(false);
  });

  it('returns invalid when gapAnalysis bullets exceed 200 chars', () => {
    const result = validateScoringResponse({
      matchScore: 5,
      gapAnalysis: { matches: 'a'.repeat(201), missing: 'ok' },
    });
    expect(result.valid).toBe(false);
  });
});
