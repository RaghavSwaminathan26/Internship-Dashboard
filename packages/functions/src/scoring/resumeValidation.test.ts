import { describe, it, expect } from 'vitest';
import { validateResumeInput } from './resumeValidation';

describe('validateResumeInput', () => {
  it('accepts valid resume text with sufficient non-whitespace characters', () => {
    const text = 'a'.repeat(100);
    const result = validateResumeInput(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects empty string', () => {
    const result = validateResumeInput('');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('non-whitespace');
  });

  it('rejects whitespace-only string', () => {
    const result = validateResumeInput('   \n\t   ');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('non-whitespace');
  });

  it('rejects text with fewer than 50 non-whitespace characters', () => {
    // 49 non-whitespace chars interspersed with spaces
    const text = 'a '.repeat(49) + ' ';
    const result = validateResumeInput(text);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('non-whitespace'))).toBe(true);
  });

  it('accepts text with exactly 50 non-whitespace characters', () => {
    const text = 'a'.repeat(50);
    const result = validateResumeInput(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects text exceeding 10,000 total characters', () => {
    const text = 'a'.repeat(10_001);
    const result = validateResumeInput(text);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('maximum length'))).toBe(true);
  });

  it('accepts text with exactly 10,000 characters', () => {
    const text = 'a'.repeat(10_000);
    const result = validateResumeInput(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns multiple errors when text is too long AND has too few non-whitespace chars', () => {
    // More than 10,000 chars total but fewer than 50 non-whitespace chars
    const text = 'a'.repeat(10) + ' '.repeat(10_000);
    const result = validateResumeInput(text);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
    expect(result.errors[0]).toContain('maximum length');
    expect(result.errors[1]).toContain('non-whitespace');
  });

  it('counts non-whitespace correctly with mixed whitespace types', () => {
    // 50 non-whitespace chars with tabs, newlines, spaces mixed in
    const text = 'a\t'.repeat(25) + 'b\n'.repeat(25);
    const result = validateResumeInput(text);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
