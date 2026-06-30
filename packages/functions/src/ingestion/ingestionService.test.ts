/**
 * Unit tests for the Ingestion Service orchestrator.
 * Tests deduplication, batch writes, independent source failure handling,
 * and summary logging.
 *
 * Requirements: 1.2, 1.3, 2.2, 2.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runIngestion, IngestionConfig, IngestionResult } from './ingestionService';

// ─── Mock firebase-admin ────────────────────────────────────────────────────

// We need to mock firebase-admin before importing the module
vi.mock('firebase-admin', () => {
  const mockTimestamp = { seconds: 1700000000, nanoseconds: 0, toDate: () => new Date() };

  return {
    default: {
      firestore: () => ({}),
    },
    firestore: {
      Timestamp: {
        now: () => mockTimestamp,
      },
    },
  };
});

// Mock the fetchers
vi.mock('./adzunaFetcher', () => ({
  fetchAdzunaPostings: vi.fn(),
}));

vi.mock('./simplifyFetcher', () => ({
  fetchSimplifyPostings: vi.fn(),
}));

import { fetchAdzunaPostings } from './adzunaFetcher';
import { fetchSimplifyPostings } from './simplifyFetcher';

const mockFetchAdzuna = vi.mocked(fetchAdzunaPostings);
const mockFetchSimplify = vi.mocked(fetchSimplifyPostings);

// ─── Firestore Mock Helpers ─────────────────────────────────────────────────

function createMockFirestore(existingIds: string[] = []) {
  const committedDocs: Record<string, unknown>[] = [];
  const batchOps: Array<{ id: string; data: unknown }> = [];

  const mockBatch = {
    set: vi.fn((docRef: { id: string }, data: unknown) => {
      batchOps.push({ id: docRef.id, data });
    }),
    commit: vi.fn(async () => {
      committedDocs.push(...batchOps.map((op) => op.data as Record<string, unknown>));
      batchOps.length = 0;
    }),
  };

  const mockCollection = {
    doc: (id: string) => ({ id, path: `postings/${id}` }),
  };

  const mockDb = {
    collection: vi.fn((_name: string) => mockCollection),
    batch: vi.fn(() => mockBatch),
    getAll: vi.fn(async (...refs: Array<{ id: string }>) => {
      return refs.map((ref) => ({
        id: ref.id,
        exists: existingIds.includes(ref.id),
      }));
    }),
  };

  return { mockDb: mockDb as unknown as FirebaseFirestore.Firestore, committedDocs, mockBatch };
}

// ─── Test Data ──────────────────────────────────────────────────────────────

const defaultConfig: IngestionConfig = {
  adzuna: {
    appId: 'test-app-id',
    apiKey: 'test-api-key',
  },
  simplify: {},
};

function createAdzunaPostings(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `adzuna-${i + 1}`,
    source: 'adzuna' as const,
    rawContent: JSON.stringify({ title: `Job ${i + 1}` }),
    ingestedAt: new Date(),
    status: 'raw' as const,
  }));
}

function createSimplifyPostings(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `company-role-${i + 1}`,
    source: 'simplifyjobs' as const,
    rawContent: JSON.stringify({ company: `Company ${i + 1}`, role: `Role ${i + 1}` }),
    parsedRow: {
      company: `Company ${i + 1}`,
      role: `Role ${i + 1}`,
      location: 'Remote',
      applicationLink: 'https://example.com',
      datePosted: '2024-01-01',
    },
    ingestedAt: new Date(),
    status: 'raw' as const,
  }));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ingestionService - runIngestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch from both sources and store all new postings', async () => {
    const adzunaPostings = createAdzunaPostings(3);
    const simplifyPostings = createSimplifyPostings(2);

    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue(simplifyPostings);

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(5);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.newPostingsStored).toBe(5);
    expect(result.errors).toHaveLength(0);
  });

  it('should skip duplicates that already exist in Firestore', async () => {
    const adzunaPostings = createAdzunaPostings(3);
    const simplifyPostings = createSimplifyPostings(2);

    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue(simplifyPostings);

    // 2 of the 5 postings already exist
    const { mockDb } = createMockFirestore(['adzuna-1', 'company-role-1']);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(5);
    expect(result.duplicatesSkipped).toBe(2);
    expect(result.newPostingsStored).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  it('should continue processing other source when one source fails', async () => {
    mockFetchAdzuna.mockRejectedValue(new Error('Adzuna API down'));
    mockFetchSimplify.mockResolvedValue(createSimplifyPostings(3));

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(3);
    expect(result.newPostingsStored).toBe(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Adzuna');
  });

  it('should continue processing when SimplifyJobs fails', async () => {
    mockFetchAdzuna.mockResolvedValue(createAdzunaPostings(2));
    mockFetchSimplify.mockRejectedValue(new Error('GitHub unreachable'));

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(2);
    expect(result.newPostingsStored).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('SimplifyJobs');
  });

  it('should report both errors when both sources fail', async () => {
    mockFetchAdzuna.mockRejectedValue(new Error('Adzuna down'));
    mockFetchSimplify.mockRejectedValue(new Error('GitHub down'));

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.newPostingsStored).toBe(0);
    expect(result.errors).toHaveLength(2);
  });

  it('should use batch writes for storing postings', async () => {
    mockFetchAdzuna.mockResolvedValue(createAdzunaPostings(3));
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb, mockBatch } = createMockFirestore([]);

    await runIngestion(defaultConfig, mockDb as any);

    expect(mockBatch.set).toHaveBeenCalledTimes(3);
    expect(mockBatch.commit).toHaveBeenCalledTimes(1);
  });

  it('should store postings with correct fields (id, source, rawContent, status, ingestedAt)', async () => {
    const adzunaPostings = createAdzunaPostings(1);
    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb, mockBatch } = createMockFirestore([]);

    await runIngestion(defaultConfig, mockDb as any);

    const setCall = mockBatch.set.mock.calls[0];
    const storedData = setCall[1] as Record<string, unknown>;

    expect(storedData).toHaveProperty('id', 'adzuna-1');
    expect(storedData).toHaveProperty('source', 'adzuna');
    expect(storedData).toHaveProperty('rawContent');
    expect(storedData).toHaveProperty('status', 'raw');
    expect(storedData).toHaveProperty('ingestedAt');
  });

  it('should return empty result when no postings fetched from either source', async () => {
    mockFetchAdzuna.mockResolvedValue([]);
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(0);
    expect(result.duplicatesSkipped).toBe(0);
    expect(result.newPostingsStored).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should handle all postings being duplicates', async () => {
    mockFetchAdzuna.mockResolvedValue(createAdzunaPostings(2));
    mockFetchSimplify.mockResolvedValue(createSimplifyPostings(2));

    const { mockDb, mockBatch } = createMockFirestore([
      'adzuna-1',
      'adzuna-2',
      'company-role-1',
      'company-role-2',
    ]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(4);
    expect(result.duplicatesSkipped).toBe(4);
    expect(result.newPostingsStored).toBe(0);
    // No batch writes should occur when all are duplicates
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});
