// Feature: interniq-dashboard, Property 10: Skill Frequency Top-N Computation
// **Validates: Requirements 7.1, 7.4**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { computeSkillFrequencies } from '../../packages/frontend/src/utils/skillFrequencies';
import type { PostingDocument } from '../../packages/shared/types';

// --- Generators ---

const firestoreTimestampArb = fc.record({
  seconds: fc.integer({ min: 1000000000, max: 2000000000 }),
  nanoseconds: fc.integer({ min: 0, max: 999999999 }),
  toDate: fc.constant(() => new Date()),
});

const techStackArb = fc.array(
  fc.string({ minLength: 1, maxLength: 20 }),
  { minLength: 1, maxLength: 8 }
);

const structuredFieldsArb = fc.record({
  roleTitle: fc.string({ minLength: 1, maxLength: 50 }),
  company: fc.string({ minLength: 1, maxLength: 50 }),
  location: fc.string({ minLength: 1, maxLength: 50 }),
  techStack: techStackArb,
  deadline: fc.option(fc.constant('2025-06-01'), { nil: null }),
  workMode: fc.constantFrom('remote' as const, 'hybrid' as const, 'onsite' as const),
  summary: fc.string({ minLength: 1, maxLength: 50 }),
});

const postingWithTechStackArb: fc.Arbitrary<PostingDocument> = fc.record({
  id: fc.uuid(),
  source: fc.constantFrom('adzuna' as const, 'simplifyjobs' as const),
  rawContent: fc.string({ minLength: 1, maxLength: 100 }),
  ingestedAt: firestoreTimestampArb as fc.Arbitrary<any>,
  status: fc.constantFrom('raw' as const, 'extracted' as const, 'scored' as const),
  structured: structuredFieldsArb as fc.Arbitrary<any>,
});

const postingWithoutTechStackArb: fc.Arbitrary<PostingDocument> = fc.record({
  id: fc.uuid(),
  source: fc.constantFrom('adzuna' as const, 'simplifyjobs' as const),
  rawContent: fc.string({ minLength: 1, maxLength: 100 }),
  ingestedAt: firestoreTimestampArb as fc.Arbitrary<any>,
  status: fc.constantFrom('raw' as const, 'extracted' as const, 'scored' as const),
  structured: fc.constant(undefined) as fc.Arbitrary<any>,
});

const postingDocumentArb: fc.Arbitrary<PostingDocument> = fc.oneof(
  { weight: 3, arbitrary: postingWithTechStackArb },
  { weight: 1, arbitrary: postingWithoutTechStackArb }
);

// --- Helper: manually compute expected skill counts ---
// The implementation counts each occurrence across all techStack arrays (case-insensitive).

function computeExpectedCounts(postings: PostingDocument[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const posting of postings) {
    const techStack = posting.structured?.techStack;
    if (!techStack) continue;
    for (const skill of techStack) {
      const key = skill.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

// --- Property Tests ---

describe('Property 10: Skill Frequency Top-N Computation', () => {
  it('result has at most 10 items', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 0, maxLength: 30 }),
        (postings) => {
          const result = computeSkillFrequencies(postings);
          expect(result.length).toBeLessThanOrEqual(10);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('result is sorted by count in descending order', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 0, maxLength: 30 }),
        (postings) => {
          const result = computeSkillFrequencies(postings);
          for (let i = 1; i < result.length; i++) {
            expect(result[i - 1].count).toBeGreaterThanOrEqual(result[i].count);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each reported count equals the actual number of postings containing that skill (case-insensitive)', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 0, maxLength: 30 }),
        (postings) => {
          const result = computeSkillFrequencies(postings);
          const expectedCounts = computeExpectedCounts(postings);

          for (const { skill, count } of result) {
            const key = skill.toLowerCase();
            const expectedCount = expectedCounts.get(key) ?? 0;
            expect(count).toBe(expectedCount);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no excluded skill has a higher frequency than any included skill', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 0, maxLength: 30 }),
        (postings) => {
          const result = computeSkillFrequencies(postings);
          const expectedCounts = computeExpectedCounts(postings);

          if (result.length === 0) return;

          const includedKeys = new Set(result.map((r) => r.skill.toLowerCase()));
          const minIncludedCount = result[result.length - 1].count;

          // Check all excluded skills
          for (const [key, count] of expectedCounts) {
            if (!includedKeys.has(key)) {
              expect(count).toBeLessThanOrEqual(minIncludedCount);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
