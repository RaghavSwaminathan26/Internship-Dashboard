// Feature: interniq-dashboard, Property 9: Filter AND Logic Correctness
// **Validates: Requirements 6.2, 6.4, 6.6**

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { filterPostings } from '../../packages/frontend/src/utils/filterPostings';
import type { PostingDocument, FilterState, WorkMode } from '../../packages/shared/types';

// --- Generators ---

const workModeArb: fc.Arbitrary<WorkMode> = fc.constantFrom('remote', 'hybrid', 'onsite');

const structuredFieldsArb = fc.record({
  roleTitle: fc.string({ minLength: 1, maxLength: 50 }),
  company: fc.string({ minLength: 1, maxLength: 50 }),
  location: fc.string({ minLength: 1, maxLength: 50 }),
  techStack: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
  deadline: fc.option(fc.constant('2025-06-01'), { nil: null }),
  workMode: workModeArb,
  summary: fc.string({ minLength: 1, maxLength: 50 }),
});

const structuredFieldsWithNoLocationArb = fc.record({
  roleTitle: fc.string({ minLength: 1, maxLength: 50 }),
  company: fc.string({ minLength: 1, maxLength: 50 }),
  location: fc.constant(''),
  techStack: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 5 }),
  deadline: fc.option(fc.constant('2025-06-01'), { nil: null }),
  workMode: workModeArb,
  summary: fc.string({ minLength: 1, maxLength: 50 }),
});

const firestoreTimestampArb = fc.record({
  seconds: fc.integer({ min: 1000000000, max: 2000000000 }),
  nanoseconds: fc.integer({ min: 0, max: 999999999 }),
  toDate: fc.constant(() => new Date()),
});

const postingDocumentArb: fc.Arbitrary<PostingDocument> = fc.record({
  id: fc.uuid(),
  source: fc.constantFrom('adzuna' as const, 'simplifyjobs' as const),
  rawContent: fc.string({ minLength: 1, maxLength: 100 }),
  ingestedAt: firestoreTimestampArb as fc.Arbitrary<any>,
  status: fc.constantFrom('raw' as const, 'extracted' as const, 'scored' as const),
  structured: fc.oneof(
    structuredFieldsArb,
    structuredFieldsWithNoLocationArb,
    fc.constant(undefined)
  ) as fc.Arbitrary<any>,
});

const filterStateArb: fc.Arbitrary<FilterState> = fc.record({
  location: fc.oneof(
    fc.constant(''),
    fc.string({ minLength: 1, maxLength: 20 })
  ),
  techStack: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 3 }),
  workMode: fc.subarray(['remote', 'hybrid', 'onsite'] as WorkMode[]),
});

// --- Helper: manually check if a posting satisfies all active filters ---

function satisfiesAllFilters(posting: PostingDocument, filters: FilterState): boolean {
  const locationFilter = filters.location.trim();
  const locationActive = locationFilter.length > 0;
  const techStackActive = filters.techStack.length > 0;
  const workModeActive = filters.workMode.length > 0;

  // Location filter
  if (locationActive) {
    const postingLocation = posting.structured?.location;
    if (!postingLocation) {
      return false;
    }
    if (!postingLocation.toLowerCase().includes(locationFilter.toLowerCase())) {
      return false;
    }
  }

  // Tech stack filter (any match, case-insensitive)
  if (techStackActive) {
    const postingTechStack = posting.structured?.techStack;
    if (!postingTechStack || postingTechStack.length === 0) {
      return false;
    }
    const postingTechLower = postingTechStack.map((t) => t.toLowerCase());
    const filterTechLower = filters.techStack.map((t) => t.toLowerCase());
    const hasMatch = filterTechLower.some((tag) => postingTechLower.includes(tag));
    if (!hasMatch) {
      return false;
    }
  }

  // Work mode filter (any match)
  if (workModeActive) {
    const postingWorkMode = posting.structured?.workMode;
    if (!postingWorkMode) {
      return false;
    }
    if (!filters.workMode.includes(postingWorkMode)) {
      return false;
    }
  }

  return true;
}

// --- Property Tests ---

describe('Property 9: Filter AND Logic Correctness', () => {
  it('every posting in the result satisfies ALL active filters', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 0, maxLength: 20 }),
        filterStateArb,
        (postings, filters) => {
          const result = filterPostings(postings, filters);

          for (const posting of result) {
            expect(satisfiesAllFilters(posting, filters)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no posting outside the result satisfies all active filters', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 0, maxLength: 20 }),
        filterStateArb,
        (postings, filters) => {
          const result = filterPostings(postings, filters);
          const resultIds = new Set(result.map((p) => p.id));
          const excluded = postings.filter((p) => !resultIds.has(p.id));

          for (const posting of excluded) {
            expect(satisfiesAllFilters(posting, filters)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('postings with no location are excluded when location filter is active', () => {
    fc.assert(
      fc.property(
        fc.array(postingDocumentArb, { minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (postings, locationFilter) => {
          const filters: FilterState = {
            location: locationFilter,
            techStack: [],
            workMode: [],
          };

          const result = filterPostings(postings, filters);

          for (const posting of result) {
            // Every posting in the result must have a non-empty location
            expect(posting.structured?.location).toBeTruthy();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
