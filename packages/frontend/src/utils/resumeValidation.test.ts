import { describe, expect, it } from 'vitest';
import { countNonWhitespace, MAX_RESUME_LENGTH, MIN_NON_WHITESPACE, validateResumeText } from './resumeValidation';

describe('countNonWhitespace', () => {
  it('returns 0 for an empty string', () => {
    expect(countNonWhitespace('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countNonWhitespace('   \t\n  ')).toBe(0);
  });

  it('counts only non-whitespace characters', () => {
    expect(countNonWhitespace('hello world')).toBe(10);
  });

  it('counts characters with mixed whitespace types', () => {
    expect(countNonWhitespace(' a\tb\nc ')).toBe(3);
  });
});

describe('validateResumeText', () => {
  it('rejects empty string', () => {
    const result = validateResumeText('');
    expect(result).not.toBeNull();
    expect(result).toContain('50 non-whitespace characters');
  });

  it('rejects whitespace-only string', () => {
    const result = validateResumeText('   \t\n   ');
    expect(result).not.toBeNull();
    expect(result).toContain('50 non-whitespace characters');
  });

  it('rejects text with fewer than 50 non-whitespace characters', () => {
    // 49 non-whitespace chars
    const input = 'a'.repeat(49);
    const result = validateResumeText(input);
    expect(result).not.toBeNull();
    expect(result).toContain('50 non-whitespace characters');
  });

  it('accepts text with exactly 50 non-whitespace characters', () => {
    const input = 'a'.repeat(50);
    const result = validateResumeText(input);
    expect(result).toBeNull();
  });

  it('accepts text with more than 50 non-whitespace characters', () => {
    const input = 'a'.repeat(100);
    const result = validateResumeText(input);
    expect(result).toBeNull();
  });

  it('counts non-whitespace correctly when mixed with whitespace', () => {
    // 49 'a' characters with lots of spaces — should fail
    const input = Array.from({ length: 49 }, () => 'a').join(' ');
    const result = validateResumeText(input);
    expect(result).not.toBeNull();
  });

  it('accepts when non-whitespace is spread among whitespace and totals 50+', () => {
    // 50 'a' characters with spaces in between — should pass
    const input = Array.from({ length: 50 }, () => 'a').join(' ');
    const result = validateResumeText(input);
    expect(result).toBeNull();
  });
});

describe('constants', () => {
  it('MAX_RESUME_LENGTH is 10000', () => {
    expect(MAX_RESUME_LENGTH).toBe(10_000);
  });

  it('MIN_NON_WHITESPACE is 50', () => {
    expect(MIN_NON_WHITESPACE).toBe(50);
  });
});
