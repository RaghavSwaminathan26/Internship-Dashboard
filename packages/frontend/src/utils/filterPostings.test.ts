import { describe, it, expect } from 'vitest';
import { filterPostings } from './filterPostings';
import type { PostingDocument, FilterState, FirestoreTimestamp } from '@interniq/shared/types';

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

const emptyFilters: FilterState = { location: '', techStack: [], workMode: [] };

describe('filterPostings', () => {
  it('returns all postings when no filters are active', () => {
    const postings = [
      makePosting({ id: 'a' }),
      makePosting({ id: 'b' }),
    ];
    expect(filterPostings(postings, emptyFilters)).toEqual(postings);
  });

  it('filters by location substring (case-insensitive)', () => {
    const postings = [
      makePosting({ id: 'sf', structured: { roleTitle: '', company: '', location: 'San Francisco, CA', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'ny', structured: { roleTitle: '', company: '', location: 'New York, NY', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'la', structured: { roleTitle: '', company: '', location: 'Los Angeles, CA', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
    ];

    const filters: FilterState = { location: 'francisco', techStack: [], workMode: [] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['sf']);
  });

  it('excludes postings with no location when location filter is active', () => {
    const postings = [
      makePosting({ id: 'has-location', structured: { roleTitle: '', company: '', location: 'Remote', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'no-structured', }),
      makePosting({ id: 'empty-location', structured: { roleTitle: '', company: '', location: '', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
    ];

    const filters: FilterState = { location: 'Remote', techStack: [], workMode: [] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['has-location']);
  });

  it('filters by tech stack (any match)', () => {
    const postings = [
      makePosting({ id: 'react', structured: { roleTitle: '', company: '', location: '', techStack: ['React', 'TypeScript'], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'python', structured: { roleTitle: '', company: '', location: '', techStack: ['Python', 'Django'], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'java', structured: { roleTitle: '', company: '', location: '', techStack: ['Java', 'Spring'], deadline: null, workMode: 'onsite', summary: '' } }),
    ];

    const filters: FilterState = { location: '', techStack: ['React', 'Python'], workMode: [] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['react', 'python']);
  });

  it('tech stack filter is case-insensitive', () => {
    const postings = [
      makePosting({ id: 'ts', structured: { roleTitle: '', company: '', location: '', techStack: ['typescript'], deadline: null, workMode: 'remote', summary: '' } }),
    ];

    const filters: FilterState = { location: '', techStack: ['TypeScript'], workMode: [] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['ts']);
  });

  it('excludes postings with no tech stack when tech stack filter is active', () => {
    const postings = [
      makePosting({ id: 'has-tech', structured: { roleTitle: '', company: '', location: '', techStack: ['React'], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'no-structured' }),
      makePosting({ id: 'empty-tech', structured: { roleTitle: '', company: '', location: '', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
    ];

    const filters: FilterState = { location: '', techStack: ['React'], workMode: [] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['has-tech']);
  });

  it('filters by work mode (any match)', () => {
    const postings = [
      makePosting({ id: 'remote', structured: { roleTitle: '', company: '', location: '', techStack: [], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'hybrid', structured: { roleTitle: '', company: '', location: '', techStack: [], deadline: null, workMode: 'hybrid', summary: '' } }),
      makePosting({ id: 'onsite', structured: { roleTitle: '', company: '', location: '', techStack: [], deadline: null, workMode: 'onsite', summary: '' } }),
    ];

    const filters: FilterState = { location: '', techStack: [], workMode: ['remote', 'hybrid'] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['remote', 'hybrid']);
  });

  it('applies AND logic across multiple filters', () => {
    const postings = [
      makePosting({ id: 'match', structured: { roleTitle: '', company: '', location: 'San Francisco', techStack: ['React'], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'wrong-location', structured: { roleTitle: '', company: '', location: 'New York', techStack: ['React'], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'wrong-tech', structured: { roleTitle: '', company: '', location: 'San Francisco', techStack: ['Python'], deadline: null, workMode: 'remote', summary: '' } }),
      makePosting({ id: 'wrong-mode', structured: { roleTitle: '', company: '', location: 'San Francisco', techStack: ['React'], deadline: null, workMode: 'onsite', summary: '' } }),
    ];

    const filters: FilterState = { location: 'San Francisco', techStack: ['React'], workMode: ['remote'] };
    const result = filterPostings(postings, filters);
    expect(result.map((p) => p.id)).toEqual(['match']);
  });

  it('returns empty array when no postings match', () => {
    const postings = [
      makePosting({ id: 'a', structured: { roleTitle: '', company: '', location: 'Seattle', techStack: ['Go'], deadline: null, workMode: 'onsite', summary: '' } }),
    ];

    const filters: FilterState = { location: 'Tokyo', techStack: [], workMode: [] };
    const result = filterPostings(postings, filters);
    expect(result).toEqual([]);
  });
});
