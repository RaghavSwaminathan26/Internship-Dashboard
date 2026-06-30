/**
 * Integration test: Firestore real-time listener (usePostings hook).
 * Tests that the usePostings hook sets up an onSnapshot subscription
 * and receives new postings via the real-time listener.
 *
 * Validates: Requirements 5.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';

// ─── Hoisted mock state ─────────────────────────────────────────────────────

const { mockOnSnapshot, mockCollection, mockQuery, mockOrderBy, snapshotCallbackRef } = vi.hoisted(() => {
  const snapshotCallbackRef = {
    current: null as ((snapshot: unknown) => void) | null,
    error: null as ((error: unknown) => void) | null,
  };

  return {
    mockOnSnapshot: vi.fn((
      _query: unknown,
      onNext: (snapshot: unknown) => void,
      onError?: (error: unknown) => void
    ) => {
      snapshotCallbackRef.current = onNext;
      snapshotCallbackRef.error = onError || null;
      return vi.fn(); // unsubscribe function
    }),
    mockCollection: vi.fn(),
    mockQuery: vi.fn((...args: unknown[]) => args),
    mockOrderBy: vi.fn((...args: unknown[]) => ({ orderBy: args })),
    snapshotCallbackRef,
  };
});

// ─── Mock firebase/firestore ────────────────────────────────────────────────

vi.mock('firebase/firestore', () => ({
  collection: mockCollection,
  onSnapshot: mockOnSnapshot,
  query: mockQuery,
  orderBy: mockOrderBy,
}));

// ─── Mock the firebase app module ───────────────────────────────────────────

vi.mock('../../packages/frontend/src/firebase', () => ({
  db: { type: 'mock-firestore-db' },
}));

// ─── Mock @tanstack/react-query ─────────────────────────────────────────────

const mockSetQueryData = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: mockSetQueryData,
    invalidateQueries: mockInvalidateQueries,
  }),
  useQuery: vi.fn(({ queryKey }: { queryKey: readonly string[] }) => ({
    data: undefined,
    isLoading: true,
    error: null,
  })),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ─── Import the hook ────────────────────────────────────────────────────────

import { usePostings } from '../../packages/frontend/src/hooks/usePostings';

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Integration: Firestore real-time listener (usePostings)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCallbackRef.current = null;
    snapshotCallbackRef.error = null;
  });

  it('should set up an onSnapshot subscription when the hook mounts', () => {
    renderHook(() => usePostings());

    // Verify onSnapshot was called to set up the real-time listener
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);

    // Verify it was called with a query, a success callback, and an error callback
    expect(mockOnSnapshot).toHaveBeenCalledWith(
      expect.anything(),     // query
      expect.any(Function),  // onNext callback
      expect.any(Function),  // onError callback
    );
  });

  it('should create a query on the postings collection ordered by ingestedAt desc', () => {
    renderHook(() => usePostings());

    // Verify collection was called with db and 'postings'
    expect(mockCollection).toHaveBeenCalledWith(
      { type: 'mock-firestore-db' },
      'postings'
    );

    // Verify orderBy was called with 'ingestedAt' and 'desc'
    expect(mockOrderBy).toHaveBeenCalledWith('ingestedAt', 'desc');
  });

  it('should write snapshot data to React Query cache when new postings arrive', () => {
    renderHook(() => usePostings());

    // Simulate a Firestore snapshot arriving with new postings
    const mockSnapshot = {
      docs: [
        {
          id: 'posting-1',
          data: () => ({
            source: 'adzuna',
            rawContent: 'Posting 1 content',
            status: 'extracted',
            structured: {
              roleTitle: 'SWE Intern',
              company: 'Google',
              location: 'Mountain View',
              techStack: ['Python'],
              deadline: null,
              workMode: 'hybrid',
              summary: 'Great opportunity',
            },
          }),
        },
        {
          id: 'posting-2',
          data: () => ({
            source: 'simplifyjobs',
            rawContent: 'Posting 2 content',
            status: 'scored',
            structured: {
              roleTitle: 'ML Intern',
              company: 'Meta',
              location: 'Remote',
              techStack: ['PyTorch'],
              deadline: '2025-06-01',
              workMode: 'remote',
              summary: 'ML internship',
            },
            scoring: {
              matchScore: 7,
              gapAnalysis: { matches: 'Python skills', missing: 'ML experience' },
            },
          }),
        },
      ],
    };

    // Trigger the snapshot callback
    act(() => {
      snapshotCallbackRef.current!(mockSnapshot);
    });

    // Verify data was written to React Query cache
    expect(mockSetQueryData).toHaveBeenCalledTimes(1);
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ['postings'],
      expect.arrayContaining([
        expect.objectContaining({ id: 'posting-1', source: 'adzuna' }),
        expect.objectContaining({ id: 'posting-2', source: 'simplifyjobs' }),
      ])
    );
  });

  it('should handle new postings appearing in real-time (simulating a new ingestion)', () => {
    renderHook(() => usePostings());

    // First snapshot: empty
    act(() => {
      snapshotCallbackRef.current!({ docs: [] });
    });

    expect(mockSetQueryData).toHaveBeenCalledWith(['postings'], []);

    // Second snapshot: a new posting appears (simulating ingestion result)
    const newPosting = {
      id: 'new-posting-001',
      data: () => ({
        source: 'adzuna',
        rawContent: 'New internship at startup',
        status: 'raw',
        ingestedAt: { seconds: 1700000000, nanoseconds: 0 },
      }),
    };

    act(() => {
      snapshotCallbackRef.current!({ docs: [newPosting] });
    });

    expect(mockSetQueryData).toHaveBeenCalledTimes(2);
    const secondCall = mockSetQueryData.mock.calls[1];
    expect(secondCall[1]).toHaveLength(1);
    expect(secondCall[1][0]).toMatchObject({
      id: 'new-posting-001',
      source: 'adzuna',
      status: 'raw',
    });
  });

  it('should invalidate queries on listener error', () => {
    renderHook(() => usePostings());

    // Trigger error callback
    const mockError = new Error('Firestore permission denied');
    act(() => {
      snapshotCallbackRef.error!(mockError);
    });

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['postings'] });
  });

  it('should return unsubscribe function that gets called on unmount', () => {
    const mockUnsubscribe = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(mockUnsubscribe);

    const { unmount } = renderHook(() => usePostings());

    // Unmount should call the unsubscribe function
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });
});
