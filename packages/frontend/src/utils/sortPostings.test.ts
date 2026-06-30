import { describe, it, expect } from 'vitest';
import { sortPostings } from './sortPostings';
import type { PostingDocument, FirestoreTimestamp } from '@interniq/shared/types';

function makeTimestamp(seconds: number): FirestoreTimestamp {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function makePosting(overrides: Partial<PostingDocument> & { id: string }): PostingDocument {
  return {
    source: 'adzuna',
    rawContent: '',
    ingestedAt: makeTimestamp(1000),
    status: 'extracted',
    ...overrides,
  };
}

describe('sortPostings', () => {
  it('returns empty array for empty input', () => {
    expect(sortPostings([], true)).toEqual([]);
    expect(sortPostings([], false)).toEqual([]);
  });

  it('sorts all postings by ingestedAt DESC when resumeSubmitted is false', () => {
    const postings = [
      makePosting({ id: 'a', ingestedAt: makeTimestamp(100) }),
      makePosting({ id: 'b', ingestedAt: makeTimestamp(300) }),
      makePosting({ id: 'c', ingestedAt: makeTimestamp(200) }),
    ];

    const result = sortPostings(postings, false);
    expect(result.map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });

  it('places scored postings before unscored when resumeSubmitted is true', () => {
    const postings = [
      makePosting({ id: 'unscored', ingestedAt: makeTimestamp(500) }),
      makePosting({
        id: 'scored',
        ingestedAt: makeTimestamp(100),
        scoring: {
          matchScore: 5,
          gapAnalysis: { matches: '', missing: '' },
          scoredAt: makeTimestamp(200),
          resumeHash: 'abc',
        },
      }),
    ];

    const result = sortPostings(postings, true);
    expect(result.map((p) => p.id)).toEqual(['scored', 'unscored']);
  });

  it('sorts scored postings by matchScore DESC', () => {
    const postings = [
      makePosting({
        id: 'low',
        ingestedAt: makeTimestamp(300),
        scoring: {
          matchScore: 3,
          gapAnalysis: { matches: '', missing: '' },
          scoredAt: makeTimestamp(200),
          resumeHash: 'abc',
        },
      }),
      makePosting({
        id: 'high',
        ingestedAt: makeTimestamp(100),
        scoring: {
          matchScore: 9,
          gapAnalysis: { matches: '', missing: '' },
          scoredAt: makeTimestamp(200),
          resumeHash: 'abc',
        },
      }),
      makePosting({
        id: 'mid',
        ingestedAt: makeTimestamp(200),
        scoring: {
          matchScore: 6,
          gapAnalysis: { matches: '', missing: '' },
          scoredAt: makeTimestamp(200),
          resumeHash: 'abc',
        },
      }),
    ];

    const result = sortPostings(postings, true);
    expect(result.map((p) => p.id)).toEqual(['high', 'mid', 'low']);
  });

  it('breaks matchScore ties by ingestedAt DESC', () => {
    const postings = [
      makePosting({
        id: 'older',
        ingestedAt: makeTimestamp(100),
        scoring: {
          matchScore: 7,
          gapAnalysis: { matches: '', missing: '' },
          scoredAt: makeTimestamp(200),
          resumeHash: 'abc',
        },
      }),
      makePosting({
        id: 'newer',
        ingestedAt: makeTimestamp(300),
        scoring: {
          matchScore: 7,
          gapAnalysis: { matches: '', missing: '' },
          scoredAt: makeTimestamp(200),
          resumeHash: 'abc',
        },
      }),
    ];

    const result = sortPostings(postings, true);
    expect(result.map((p) => p.id)).toEqual(['newer', 'older']);
  });

  it('sorts unscored postings by ingestedAt DESC', () => {
    const postings = [
      makePosting({ id: 'u1', ingestedAt: makeTimestamp(100) }),
      makePosting({ id: 'u2', ingestedAt: makeTimestamp(400) }),
      makePosting({ id: 'u3', ingestedAt: makeTimestamp(200) }),
    ];

    const result = sortPostings(postings, true);
    expect(result.map((p) => p.id)).toEqual(['u2', 'u3', 'u1']);
  });

  it('does not mutate the original array', () => {
    const postings = [
      makePosting({ id: 'a', ingestedAt: makeTimestamp(100) }),
      makePosting({ id: 'b', ingestedAt: makeTimestamp(200) }),
    ];
    const original = [...postings];
    sortPostings(postings, false);
    expect(postings).toEqual(original);
  });
});
