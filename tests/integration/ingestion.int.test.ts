/**
 * Integration test: End-to-end ingestion flow.
 * Mock Adzuna API → runIngestion → Firestore writes with correct schema.
 *
 * Validates: Requirements 1.1, 5.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock firebase-admin ────────────────────────────────────────────────────

const mockTimestamp = { seconds: 1700000000, nanoseconds: 0, toDate: () => new Date() };

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => ({}),
  },
  firestore: {
    Timestamp: {
      now: () => mockTimestamp,
    },
  },
}));

// ─── Mock Adzuna fetcher ────────────────────────────────────────────────────

const mockFetchAdzuna = vi.fn();
vi.mock('../../packages/functions/src/ingestion/adzunaFetcher', () => ({
  fetchAdzunaPostings: (...args: unknown[]) => mockFetchAdzuna(...args),
}));

// ─── Mock SimplifyJobs fetcher ──────────────────────────────────────────────

const mockFetchSimplify = vi.fn();
vi.mock('../../packages/functions/src/ingestion/simplifyFetcher', () => ({
  fetchSimplifyPostings: (...args: unknown[]) => mockFetchSimplify(...args),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import { runIngestion } from '../../packages/functions/src/ingestion/ingestionService';

// ─── Firestore Mock ─────────────────────────────────────────────────────────

interface BatchOp {
  id: string;
  data: Record<string, unknown>;
}

function createMockFirestore(existingIds: string[] = []) {
  const committedDocs: Record<string, unknown>[] = [];
  const batchOps: BatchOp[] = [];

  const mockBatch = {
    set: vi.fn((docRef: { id: string }, data: Record<string, unknown>) => {
      batchOps.push({ id: docRef.id, data });
    }),
    commit: vi.fn(async () => {
      committedDocs.push(...batchOps.map((op) => op.data));
      batchOps.length = 0;
    }),
  };

  const mockCollection = {
    doc: (id: string) => ({ id, path: `postings/${id}` }),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
    batch: vi.fn(() => mockBatch),
    getAll: vi.fn(async (...refs: Array<{ id: string }>) => {
      return refs.map((ref) => ({
        id: ref.id,
        exists: existingIds.includes(ref.id),
      }));
    }),
  };

  return { mockDb, committedDocs, mockBatch };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Integration: End-to-end ingestion (Adzuna → Firestore)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should ingest postings from mocked Adzuna API and write to Firestore with correct schema', async () => {
    // Arrange: mock Adzuna returning 3 postings
    const adzunaPostings = [
      {
        id: 'adzuna-101',
        source: 'adzuna' as const,
        rawContent: JSON.stringify({
          id: '101',
          title: 'Software Engineer Intern',
          description: 'Build amazing products',
          company: { display_name: 'TechCorp' },
          location: { display_name: 'San Francisco, CA', area: ['US'] },
        }),
        ingestedAt: new Date('2024-06-01T10:00:00Z'),
        status: 'raw' as const,
      },
      {
        id: 'adzuna-102',
        source: 'adzuna' as const,
        rawContent: JSON.stringify({
          id: '102',
          title: 'Data Science Intern',
          description: 'Work on ML models',
          company: { display_name: 'DataCo' },
          location: { display_name: 'Remote', area: ['US'] },
        }),
        ingestedAt: new Date('2024-06-01T10:00:00Z'),
        status: 'raw' as const,
      },
      {
        id: 'adzuna-103',
        source: 'adzuna' as const,
        rawContent: JSON.stringify({
          id: '103',
          title: 'Backend Intern',
          description: 'API development',
          company: { display_name: 'ServerInc' },
          location: { display_name: 'New York, NY', area: ['US'] },
        }),
        ingestedAt: new Date('2024-06-01T10:00:00Z'),
        status: 'raw' as const,
      },
    ];

    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb, mockBatch } = createMockFirestore([]);

    // Act: run the full ingestion pipeline
    const result = await runIngestion(
      { adzuna: { appId: 'test-app', apiKey: 'test-key' } },
      mockDb as any
    );

    // Assert: result summary
    expect(result.totalFetched).toBe(3);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.newPostingsStored).toBe(3);
    expect(result.errors).toHaveLength(0);

    // Assert: batch writes occurred with correct schema
    expect(mockBatch.set).toHaveBeenCalledTimes(3);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);

    // Verify document schema: id, source, rawContent, status='raw', ingestedAt
    for (let i = 0; i < 3; i++) {
      const setCall = mockBatch.set.mock.calls[i];
      const docRef = setCall[0] as { id: string };
      const data = setCall[1] as Record<string, unknown>;

      expect(docRef.id).toBe(`adzuna-10${i + 1}`);
      expect(data).toHaveProperty('id', `adzuna-10${i + 1}`);
      expect(data).toHaveProperty('source', 'adzuna');
      expect(data).toHaveProperty('rawContent');
      expect(typeof data.rawContent).toBe('string');
      expect(data).toHaveProperty('status', 'raw');
      expect(data).toHaveProperty('ingestedAt');
    }
  });

  it('should deduplicate existing postings and only write new ones', async () => {
    const adzunaPostings = [
      {
        id: 'adzuna-200',
        source: 'adzuna' as const,
        rawContent: JSON.stringify({ title: 'New Posting' }),
        ingestedAt: new Date(),
        status: 'raw' as const,
      },
      {
        id: 'adzuna-201',
        source: 'adzuna' as const,
        rawContent: JSON.stringify({ title: 'Existing Posting' }),
        ingestedAt: new Date(),
        status: 'raw' as const,
      },
    ];

    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue([]);

    // adzuna-201 already exists in Firestore
    const { mockDb, mockBatch } = createMockFirestore(['adzuna-201']);

    const result = await runIngestion(
      { adzuna: { appId: 'test-app', apiKey: 'test-key' } },
      mockDb as any
    );

    expect(result.totalFetched).toBe(2);
    expect(result.duplicatesSkipped).toBe(1);
    expect(result.newPostingsStored).toBe(1);

    // Only the new posting was written
    expect(mockBatch.set).toHaveBeenCalledTimes(1);
    const writtenDoc = mockBatch.set.mock.calls[0][0] as { id: string };
    expect(writtenDoc.id).toBe('adzuna-200');
  });

  it('should handle errors from Adzuna API gracefully and report them', async () => {
    mockFetchAdzuna.mockRejectedValue(new Error('Adzuna API timeout after retries'));
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(
      { adzuna: { appId: 'test-app', apiKey: 'test-key' } },
      mockDb as any
    );

    expect(result.totalFetched).toBe(0);
    expect(result.newPostingsStored).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Adzuna');
  });
});
