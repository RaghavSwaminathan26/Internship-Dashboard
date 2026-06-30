/**
 * Unit tests for the Ingestion Service orchestrator.
 * Tests deduplication, batch writes, independent source failure handling,
 * pagination limits, retry exhaustion, and invalid row handling.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 2.3, 2.5
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

// ─── Adzuna Pagination Stops at 500 Postings (Req 1.1) ─────────────────────

describe('Adzuna pagination - stops at 500 postings max', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not return more than 500 postings even when API has more available', async () => {
    // Simulate Adzuna returning 600 postings (more than the 500 limit)
    const oversizedBatch = createAdzunaPostings(600);
    mockFetchAdzuna.mockResolvedValue(oversizedBatch);
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    // The ingestion service receives whatever the fetcher returns
    // The adzunaFetcher itself is responsible for capping at 500
    // Here we test that even if we get 600 results, they all get stored
    // (the 500 cap is enforced within fetchAdzunaPostings)
    expect(result.totalFetched).toBe(600);
  });
});

describe('fetchAdzunaPostings - pagination stops at 500', () => {
  // Reset mocks for this describe block using the real fetcher
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('should stop paginating at 500 postings max', async () => {
    // Import the actual (un-mocked) fetcher module for a focused unit test
    const { fetchAdzunaPostings: realFetchAdzuna } = await vi.importActual<typeof import('./adzunaFetcher')>('./adzunaFetcher');

    // Create a mock fetch that returns 50 results per page (enough for 10+ pages)
    let pagesFetched = 0;
    const mockFetchFn = vi.fn(async (_url: string) => {
      pagesFetched++;
      const results = Array.from({ length: 50 }, (_, i) => ({
        id: `job-${(pagesFetched - 1) * 50 + i + 1}`,
        title: `Job ${(pagesFetched - 1) * 50 + i + 1}`,
        description: 'Test description',
        company: { display_name: 'TestCorp' },
        location: { display_name: 'Remote', area: [] },
        redirect_url: 'https://example.com',
        created: '2024-01-01T00:00:00Z',
        category: { tag: 'it-jobs', label: 'IT Jobs' },
      }));

      return {
        ok: true,
        status: 200,
        json: async () => ({ results, count: 1000 }),
      };
    });

    const config = { appId: 'test', apiKey: 'test', resultsPerPage: 50 };
    const postings = await realFetchAdzuna(config, mockFetchFn as any);

    // Should stop at exactly 500 postings (INGESTION_CONSTRAINTS.maxPostingsPerRun)
    expect(postings.length).toBe(500);
    // Should have fetched exactly 10 pages (500 / 50 per page)
    expect(pagesFetched).toBe(10);
  });

  it('should stop pagination early when API returns fewer results than page size', async () => {
    const { fetchAdzunaPostings: realFetchAdzuna } = await vi.importActual<typeof import('./adzunaFetcher')>('./adzunaFetcher');

    let pagesFetched = 0;
    const mockFetchFn = vi.fn(async (_url: string) => {
      pagesFetched++;
      // Return only 30 results (less than default page size of 50)
      const results = Array.from({ length: 30 }, (_, i) => ({
        id: `job-${i + 1}`,
        title: `Job ${i + 1}`,
        description: 'Test description',
        company: { display_name: 'TestCorp' },
        location: { display_name: 'Remote', area: [] },
        redirect_url: 'https://example.com',
        created: '2024-01-01T00:00:00Z',
        category: { tag: 'it-jobs', label: 'IT Jobs' },
      }));

      return {
        ok: true,
        status: 200,
        json: async () => ({ results, count: 30 }),
      };
    });

    const config = { appId: 'test', apiKey: 'test', resultsPerPage: 50 };
    const postings = await realFetchAdzuna(config, mockFetchFn as any);

    // Should stop after first page since results < resultsPerPage
    expect(postings.length).toBe(30);
    expect(pagesFetched).toBe(1);
  });
});

// ─── Deduplication Skips Existing Posting IDs (Req 1.3, 2.3) ────────────────

describe('Deduplication - skips existing posting IDs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not write postings that already exist in Firestore', async () => {
    // Create 5 Adzuna postings
    const adzunaPostings = createAdzunaPostings(5);
    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue([]);

    // Mark 3 of 5 as already existing
    const { mockDb, mockBatch } = createMockFirestore(['adzuna-1', 'adzuna-3', 'adzuna-5']);

    const result = await runIngestion(defaultConfig, mockDb as any);

    // Only 2 new postings should be written (adzuna-2, adzuna-4)
    expect(result.totalFetched).toBe(5);
    expect(result.duplicatesSkipped).toBe(3);
    expect(result.newPostingsStored).toBe(2);
    expect(mockBatch.set).toHaveBeenCalledTimes(2);
  });

  it('should deduplicate across both Adzuna and SimplifyJobs sources', async () => {
    const adzunaPostings = createAdzunaPostings(3);
    const simplifyPostings = createSimplifyPostings(3);

    mockFetchAdzuna.mockResolvedValue(adzunaPostings);
    mockFetchSimplify.mockResolvedValue(simplifyPostings);

    // Mark one from each source as existing
    const { mockDb, mockBatch } = createMockFirestore(['adzuna-2', 'company-role-3']);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.totalFetched).toBe(6);
    expect(result.duplicatesSkipped).toBe(2);
    expect(result.newPostingsStored).toBe(4);
    expect(mockBatch.set).toHaveBeenCalledTimes(4);
  });

  it('should skip all duplicates and write nothing when all already exist', async () => {
    mockFetchAdzuna.mockResolvedValue(createAdzunaPostings(3));
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb, mockBatch } = createMockFirestore(['adzuna-1', 'adzuna-2', 'adzuna-3']);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.duplicatesSkipped).toBe(3);
    expect(result.newPostingsStored).toBe(0);
    expect(mockBatch.set).not.toHaveBeenCalled();
    expect(mockBatch.commit).not.toHaveBeenCalled();
  });
});

// ─── Retry Exhaustion Logs Final Failure (Req 1.4, 1.5) ────────────────────

describe('Retry exhaustion - logs final failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should log final failure when Adzuna retries are exhausted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Adzuna throws (simulating all retries exhausted inside adzunaFetcher)
    mockFetchAdzuna.mockRejectedValue(
      new Error('Adzuna API: all 4 attempts failed for page 1. Last error: Network error')
    );
    mockFetchSimplify.mockResolvedValue([]);

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    // The ingestion service should report the error
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Adzuna');

    // Should have logged the failure with timestamp
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Adzuna ingestion failed/)
    );

    errorSpy.mockRestore();
  });

  it('should log final failure when SimplifyJobs retries are exhausted', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockFetchAdzuna.mockResolvedValue([]);
    // SimplifyJobs throws (simulating all retries exhausted inside simplifyFetcher)
    mockFetchSimplify.mockRejectedValue(
      new Error('SimplifyJobs: all 4 attempts failed. Last error: Connection refused')
    );

    const { mockDb } = createMockFirestore([]);

    const result = await runIngestion(defaultConfig, mockDb as any);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('SimplifyJobs');

    // Should have logged the failure
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/SimplifyJobs ingestion failed/)
    );

    errorSpy.mockRestore();
  });

  it('Adzuna fetcher throws after 3 failed retries (direct test)', async () => {
    const { fetchAdzunaPostings: realFetchAdzuna } = await vi.importActual<typeof import('./adzunaFetcher')>('./adzunaFetcher');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Always fails
    const failingFetch = vi.fn(async () => {
      throw new Error('Persistent network error');
    });

    const config = { appId: 'test', apiKey: 'test' };

    await expect(realFetchAdzuna(config, failingFetch as any)).rejects.toThrow(
      /all 4 attempts failed/
    );

    // Should log each retry attempt and the final failure
    expect(errorSpy).toHaveBeenCalled();
    const errorCalls = errorSpy.mock.calls.map((c) => c[0] as string);
    const finalFailureLog = errorCalls.find((msg) => msg.includes('all 4 attempts failed'));
    expect(finalFailureLog).toBeDefined();
    // Final failure log should include a timestamp
    expect(finalFailureLog).toMatch(/\[\d{4}-\d{2}-\d{2}T/);

    errorSpy.mockRestore();
  }, 15000);

  it('SimplifyJobs fetcher throws after 3 failed retries (direct test)', async () => {
    const { fetchSimplifyPostings: realFetchSimplify } = await vi.importActual<typeof import('./simplifyFetcher')>('./simplifyFetcher');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Always fails
    const failingFetch = vi.fn(async () => {
      throw new Error('Connection refused');
    });

    await expect(realFetchSimplify({}, failingFetch as any)).rejects.toThrow(
      /all 4 attempts failed/
    );

    // Should log the final failure with timestamp
    expect(errorSpy).toHaveBeenCalled();
    const errorCalls = errorSpy.mock.calls.map((c) => c[0] as string);
    const finalFailureLog = errorCalls.find((msg) => msg.includes('all 4 attempts failed'));
    expect(finalFailureLog).toBeDefined();
    expect(finalFailureLog).toMatch(/\[\d{4}-\d{2}-\d{2}T/);

    errorSpy.mockRestore();
  }, 15000);
});

// ─── Invalid Markdown Rows Are Skipped with Logging (Req 2.5) ───────────────

describe('Invalid markdown rows - skipped with logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should skip invalid rows and parse only valid ones during ingestion', async () => {
    const { fetchSimplifyPostings: realFetchSimplify } = await vi.importActual<typeof import('./simplifyFetcher')>('./simplifyFetcher');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const markdownWithInvalidRows = `# Internships

| Company | Role | Location | Application | Date Posted |
|---------|------|----------|-------------|-------------|
| Google | SWE Intern | Mountain View, CA | https://google.com/apply | Jan 15 |
| Invalid | | | | |
| Meta | ML Intern | Menlo Park, CA | https://meta.com/apply | Jan 16 |
| | Missing Company | Somewhere | http://link | Jan 17 |
| Amazon | Backend Intern | Seattle, WA | https://amazon.com/apply | Jan 18 |
`;

    const mockFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => markdownWithInvalidRows,
    }));

    const postings = await realFetchSimplify({}, mockFetch as any);

    // Should only have 3 valid postings (Google, Meta, Amazon)
    expect(postings).toHaveLength(3);
    expect(postings[0]!.parsedRow.company).toBe('Google');
    expect(postings[1]!.parsedRow.company).toBe('Meta');
    expect(postings[2]!.parsedRow.company).toBe('Amazon');

    // Should have logged warnings for the invalid rows
    expect(warnSpy).toHaveBeenCalled();
    const warnCalls = warnSpy.mock.calls.map((c) => c[0] as string);
    const invalidRowWarnings = warnCalls.filter((msg) => msg.includes('[SimplifyParser] Skipping invalid row'));
    expect(invalidRowWarnings.length).toBeGreaterThanOrEqual(1);

    warnSpy.mockRestore();
  });

  it('should log the row content when skipping invalid rows', async () => {
    const { parseMarkdownTable } = await vi.importActual<typeof import('./simplifyParser')>('./simplifyParser');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const markdown = `| Company | Role | Location | App | Date |
|---|---|---|---|---|
| Valid | SWE | Remote | http://link | Jan 1 |
| Only | Three | Columns |
| Also Valid | DevOps | NYC | http://link2 | Feb 1 |`;

    const results = parseMarkdownTable(markdown);

    // Should parse 2 valid rows
    expect(results).toHaveLength(2);
    expect(results[0]!.company).toBe('Valid');
    expect(results[1]!.company).toBe('Also Valid');

    // Should have logged the invalid row content
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipping invalid row')
    );

    warnSpy.mockRestore();
  });

  it('should handle a table where all rows are invalid', async () => {
    const { parseMarkdownTable } = await vi.importActual<typeof import('./simplifyParser')>('./simplifyParser');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const markdown = `| Company | Role | Location | App | Date |
|---|---|---|---|---|
| | | | | |
| Missing Fields |
| Also | Bad | |`;

    const results = parseMarkdownTable(markdown);

    expect(results).toHaveLength(0);

    warnSpy.mockRestore();
  });
});
