// Feature: interniq-dashboard, Property 8: Posting Sort Order Invariant
// **Validates: Requirements 5.1, 5.4**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sortPostings } from '../../packages/frontend/src/utils/sortPostings';
import type { PostingDocument, FirestoreTimestamp } from '../../packages/shared/types';

/**
 * Helper: create a minimal FirestoreTimestamp-like object.
 */
function makeTimestamp(seconds: number, nanoseconds: number): FirestoreTimestamp {
  return {
    seconds,
    nanoseconds,
    toDate: () => new Date(seconds * 1000 + nanoseconds / 1_000_000),
  };
}

/**
 * Arbitrary for a FirestoreTimestamp with random seconds and nanoseconds.
 */
const timestampArb = fc
  .record({
    seconds: fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
    nanoseconds: fc.integer({ min: 0, max: 999_999_999 }),
  })
  .map(({ seconds, nanoseconds }) => makeTimestamp(seconds, nanoseconds));

/**
 * Arbitrary for an unscored PostingDocument (no scoring field).
 */
const unscoredPostingArb: fc.Arbitrary<PostingDocument> = fc
  .record({
    id: fc.uuid(),
    ingestedAt: timestampArb,
  })
  .map(({ id, ingestedAt }) => ({
    id,
    source: 'adzuna' as const,
    rawContent: 'raw content',
    ingestedAt,
    status: 'extracted' as const,
  }));

/**
 * Arbitrary for a scored PostingDocument (has scoring.matchScore in [1, 10]).
 */
const scoredPostingArb: fc.Arbitrary<PostingDocument> = fc
  .record({
    id: fc.uuid(),
    ingestedAt: timestampArb,
    matchScore: fc.integer({ min: 1, max: 10 }),
  })
  .map(({ id, ingestedAt, matchScore }) => ({
    id,
    source: 'adzuna' as const,
    rawContent: 'raw content',
    ingestedAt,
    status: 'scored' as const,
    scoring: {
      matchScore,
      gapAnalysis: { matches: 'matches', missing: 'missing' },
      scoredAt: makeTimestamp(ingestedAt.seconds + 100, 0),
      resumeHash: 'hash123',
    },
  }));

/**
 * Arbitrary for a mixed list of scored and unscored postings.
 * Ensures at least 1 posting total, with a mix of both types.
 */
const postingListArb: fc.Arbitrary<PostingDocument[]> = fc
  .tuple(
    fc.array(scoredPostingArb, { minLength: 0, maxLength: 15 }),
    fc.array(unscoredPostingArb, { minLength: 0, maxLength: 15 })
  )
  .filter(([scored, unscored]) => scored.length + unscored.length >= 1)
  .chain(([scored, unscored]) =>
    // Shuffle the combined list to ensure sort is not relying on input order
    fc.shuffledSubarray([...scored, ...unscored], {
      minLength: scored.length + unscored.length,
      maxLength: scored.length + unscored.length,
    })
  );

/**
 * Helper: compare two timestamps, returns negative if a < b, positive if a > b.
 */
function compareTimestampsDesc(a: FirestoreTimestamp, b: FirestoreTimestamp): number {
  if (b.seconds !== a.seconds) {
    return b.seconds - a.seconds;
  }
  return b.nanoseconds - a.nanoseconds;
}

describe('Property 8: Posting Sort Order Invariant', () => {
  it('all scored postings appear before all unscored postings', () => {
    fc.assert(
      fc.property(postingListArb, (postings) => {
        const sorted = sortPostings(postings, true);

        // Find the last scored posting index and first unscored posting index
        let lastScoredIdx = -1;
        let firstUnscoredIdx = sorted.length;

        for (let i = 0; i < sorted.length; i++) {
          if (sorted[i].scoring?.matchScore != null) {
            lastScoredIdx = i;
          } else if (firstUnscoredIdx === sorted.length) {
            firstUnscoredIdx = i;
          }
        }

        // All scored postings must come before all unscored ones
        if (lastScoredIdx >= 0 && firstUnscoredIdx < sorted.length) {
          expect(lastScoredIdx).toBeLessThan(firstUnscoredIdx);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('scored postings are ordered by matchScore DESC, ties broken by ingestedAt DESC', () => {
    fc.assert(
      fc.property(postingListArb, (postings) => {
        const sorted = sortPostings(postings, true);

        // Extract scored postings from the sorted result
        const scoredResults = sorted.filter((p) => p.scoring?.matchScore != null);

        // Verify ordering for adjacent pairs
        for (let i = 0; i < scoredResults.length - 1; i++) {
          const curr = scoredResults[i];
          const next = scoredResults[i + 1];
          const currScore = curr.scoring!.matchScore;
          const nextScore = next.scoring!.matchScore;

          if (currScore !== nextScore) {
            // Higher score comes first (DESC)
            expect(currScore).toBeGreaterThan(nextScore);
          } else {
            // Same score: newer ingestedAt comes first (DESC)
            const cmp = compareTimestampsDesc(curr.ingestedAt, next.ingestedAt);
            expect(cmp).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  it('unscored postings are ordered by ingestedAt DESC', () => {
    fc.assert(
      fc.property(postingListArb, (postings) => {
        const sorted = sortPostings(postings, true);

        // Extract unscored postings from the sorted result
        const unscoredResults = sorted.filter((p) => p.scoring?.matchScore == null);

        // Verify ordering for adjacent pairs
        for (let i = 0; i < unscoredResults.length - 1; i++) {
          const curr = unscoredResults[i];
          const next = unscoredResults[i + 1];
          const cmp = compareTimestampsDesc(curr.ingestedAt, next.ingestedAt);
          expect(cmp).toBeLessThanOrEqual(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});
