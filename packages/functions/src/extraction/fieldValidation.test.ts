/**
 * Unit tests for structured field validation and truncation.
 */

import { describe, it, expect } from 'vitest';
import { validateAndTruncateFields, validateDeadline } from './fieldValidation';

describe('validateDeadline', () => {
  it('returns valid ISO 8601 date unchanged', () => {
    expect(validateDeadline('2024-06-15')).toBe('2024-06-15');
    expect(validateDeadline('2023-01-01')).toBe('2023-01-01');
    expect(validateDeadline('2025-12-31')).toBe('2025-12-31');
  });

  it('returns null for non-string values', () => {
    expect(validateDeadline(null)).toBeNull();
    expect(validateDeadline(undefined)).toBeNull();
    expect(validateDeadline(123)).toBeNull();
    expect(validateDeadline({})).toBeNull();
    expect(validateDeadline([])).toBeNull();
  });

  it('returns null for invalid date formats', () => {
    expect(validateDeadline('06-15-2024')).toBeNull();
    expect(validateDeadline('2024/06/15')).toBeNull();
    expect(validateDeadline('not-a-date')).toBeNull();
    expect(validateDeadline('')).toBeNull();
    expect(validateDeadline('2024-6-15')).toBeNull();
    expect(validateDeadline('2024-06-15T00:00:00Z')).toBeNull();
  });

  it('returns null for invalid date values', () => {
    expect(validateDeadline('2024-13-01')).toBeNull(); // month > 12
    expect(validateDeadline('2024-00-01')).toBeNull(); // month 0
    expect(validateDeadline('2024-02-30')).toBeNull(); // Feb 30 invalid
    expect(validateDeadline('2023-02-29')).toBeNull(); // 2023 not leap year
  });

  it('handles leap year correctly', () => {
    expect(validateDeadline('2024-02-29')).toBe('2024-02-29'); // 2024 is leap year
  });
});

describe('validateAndTruncateFields', () => {
  it('passes through valid fields unchanged', () => {
    const input = {
      roleTitle: 'Software Engineer Intern',
      company: 'Acme Corp',
      location: 'San Francisco, CA',
      techStack: ['TypeScript', 'React', 'Node.js'],
      deadline: '2024-08-01',
      workMode: 'remote',
      summary: 'Great internship opportunity',
    };

    const result = validateAndTruncateFields(input);
    expect(result).toEqual(input);
  });

  it('truncates strings exceeding max length', () => {
    const longString = 'a'.repeat(300);
    const input = {
      roleTitle: longString,
      company: longString,
      location: longString,
      techStack: [],
      deadline: null,
      workMode: 'hybrid',
      summary: longString,
    };

    const result = validateAndTruncateFields(input);
    expect(result.roleTitle).toHaveLength(200);
    expect(result.company).toHaveLength(200);
    expect(result.location).toHaveLength(200);
    expect(result.summary).toHaveLength(200);
  });

  it('caps techStack to 30 items', () => {
    const techStack = Array.from({ length: 50 }, (_, i) => `tech-${i}`);
    const input = {
      roleTitle: 'Test',
      company: 'Test',
      location: 'Test',
      techStack,
      deadline: null,
      workMode: 'onsite',
      summary: 'Test',
    };

    const result = validateAndTruncateFields(input);
    expect(result.techStack).toHaveLength(30);
  });

  it('truncates each techStack item to 50 chars', () => {
    const longItem = 'x'.repeat(80);
    const input = {
      roleTitle: 'Test',
      company: 'Test',
      location: 'Test',
      techStack: [longItem, 'short'],
      deadline: null,
      workMode: 'remote',
      summary: 'Test',
    };

    const result = validateAndTruncateFields(input);
    expect(result.techStack[0]).toHaveLength(50);
    expect(result.techStack[1]).toBe('short');
  });

  it('defaults workMode to onsite for invalid values', () => {
    const input = {
      roleTitle: 'Test',
      company: 'Test',
      location: 'Test',
      techStack: [],
      deadline: null,
      workMode: 'invalid-mode',
      summary: 'Test',
    };

    const result = validateAndTruncateFields(input);
    expect(result.workMode).toBe('onsite');
  });

  it('defaults workMode to onsite when missing', () => {
    const result = validateAndTruncateFields({});
    expect(result.workMode).toBe('onsite');
  });

  it('handles null/undefined/non-object input gracefully', () => {
    expect(validateAndTruncateFields(null)).toEqual({
      roleTitle: '',
      company: '',
      location: '',
      techStack: [],
      deadline: null,
      workMode: 'onsite',
      summary: '',
    });

    expect(validateAndTruncateFields(undefined)).toEqual({
      roleTitle: '',
      company: '',
      location: '',
      techStack: [],
      deadline: null,
      workMode: 'onsite',
      summary: '',
    });
  });

  it('sets deadline to null for invalid dates', () => {
    const input = {
      roleTitle: 'Test',
      company: 'Test',
      location: 'Test',
      techStack: [],
      deadline: 'not-a-date',
      workMode: 'remote',
      summary: 'Test',
    };

    const result = validateAndTruncateFields(input);
    expect(result.deadline).toBeNull();
  });

  it('handles non-array techStack gracefully', () => {
    const input = {
      roleTitle: 'Test',
      company: 'Test',
      location: 'Test',
      techStack: 'not-an-array',
      deadline: null,
      workMode: 'hybrid',
      summary: 'Test',
    };

    const result = validateAndTruncateFields(input);
    expect(result.techStack).toEqual([]);
  });
});
