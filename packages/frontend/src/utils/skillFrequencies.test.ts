import { describe, it, expect } from 'vitest';
import { computeSkillFrequencies } from './skillFrequencies';
import type { PostingDocument, FirestoreTimestamp } from '@interniq/shared/types';

function makeTimestamp(seconds: number): FirestoreTimestamp {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function makePosting(techStack?: string[]): PostingDocument {
  return {
    id: 'test-' + Math.random().toString(36).slice(2),
    source: 'adzuna',
    rawContent: 'test',
    ingestedAt: makeTimestamp(1000),
    status: 'extracted',
    structured: techStack
      ? {
          roleTitle: 'Dev',
          company: 'Co',
          location: 'Remote',
          techStack,
          deadline: null,
          workMode: 'remote',
          summary: 'A role',
        }
      : undefined,
  };
}

describe('computeSkillFrequencies', () => {
  it('returns empty array for no postings', () => {
    expect(computeSkillFrequencies([])).toEqual([]);
  });

  it('returns empty array when postings have no structured data', () => {
    const postings = [makePosting(undefined), makePosting(undefined)];
    expect(computeSkillFrequencies(postings)).toEqual([]);
  });

  it('counts skills across multiple postings', () => {
    const postings = [
      makePosting(['React', 'TypeScript']),
      makePosting(['react', 'Node.js']),
      makePosting(['TypeScript', 'Node.js', 'Python']),
    ];
    const result = computeSkillFrequencies(postings);

    expect(result).toEqual([
      { skill: 'React', count: 2 },
      { skill: 'TypeScript', count: 2 },
      { skill: 'Node.js', count: 2 },
      { skill: 'Python', count: 1 },
    ]);
  });

  it('is case-insensitive and preserves first-seen casing', () => {
    const postings = [
      makePosting(['react']),
      makePosting(['React']),
      makePosting(['REACT']),
    ];
    const result = computeSkillFrequencies(postings);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ skill: 'react', count: 3 });
  });

  it('returns at most 10 skills', () => {
    const skills = Array.from({ length: 15 }, (_, i) => `Skill${i}`);
    // Give each skill a different frequency
    const postings: PostingDocument[] = [];
    for (let i = 0; i < skills.length; i++) {
      for (let j = 0; j <= i; j++) {
        postings.push(makePosting([skills[i]!]));
      }
    }
    const result = computeSkillFrequencies(postings);

    expect(result).toHaveLength(10);
    // Top 10 should be the skills with highest frequency (indices 14 down to 5)
    expect(result[0]!.skill).toBe('Skill14');
    expect(result[0]!.count).toBe(15);
  });

  it('returns fewer than 10 when fewer distinct skills exist', () => {
    const postings = [makePosting(['Go', 'Rust']), makePosting(['Go'])];
    const result = computeSkillFrequencies(postings);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ skill: 'Go', count: 2 });
    expect(result[1]).toEqual({ skill: 'Rust', count: 1 });
  });

  it('sorts by frequency descending', () => {
    const postings = [
      makePosting(['A', 'B', 'C']),
      makePosting(['B', 'C']),
      makePosting(['C']),
    ];
    const result = computeSkillFrequencies(postings);

    expect(result[0]).toEqual({ skill: 'C', count: 3 });
    expect(result[1]).toEqual({ skill: 'B', count: 2 });
    expect(result[2]).toEqual({ skill: 'A', count: 1 });
  });

  it('handles postings with empty techStack arrays', () => {
    const postings = [makePosting([]), makePosting(['React'])];
    const result = computeSkillFrequencies(postings);

    expect(result).toEqual([{ skill: 'React', count: 1 }]);
  });
});
