/**
 * Unit tests for the Scoring Service.
 * Tests resume hash comparison, score invalidation on resume change,
 * retry exhaustion marking scoring_failed, non-integer score handling,
 * and malformed gap analysis handling.
 *
 * Requirements: 4.3, 4.8, 4.9
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock firebase-functions/v2/https ───────────────────────────────────────

const { capturedCallableHandler } = vi.hoisted(() => {
  return { capturedCallableHandler: { current: null as ((request: any) => Promise<any>) | null } };
});

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: (request: any) => Promise<any>) => {
    capturedCallableHandler.current = handler;
    return handler;
  },
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
      this.name = 'HttpsError';
    }
  },
}));

// ─── Mock firebase-functions/v2/firestore ───────────────────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: vi.fn((_path: string, _handler: any) => {}),
}));

// ─── Mock firebase-functions logger ─────────────────────────────────────────

vi.mock('firebase-functions', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// ─── Mock OpenAI ────────────────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => {
  return { mockCreate: vi.fn() };
});

vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = {
        completions: {
          create: mockCreate,
        },
      };
    },
  };
});

// ─── Mock firebase-admin ────────────────────────────────────────────────────

const {
  mockUpdate,
  mockAdd,
  mockDocGet,
  mockBatchUpdate,
  mockBatchCommit,
  mockWhere,
  mockOrderBy,
} = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockAdd: vi.fn(),
  mockDocGet: vi.fn(),
  mockBatchUpdate: vi.fn(),
  mockBatchCommit: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
}));

function createMockQuerySnapshot(docs: Array<{ id: string; data: () => any; ref: any }>) {
  return {
    empty: docs.length === 0,
    docs,
    size: docs.length,
  };
}

function createMockDoc(id: string, data: any) {
  const ref = { id, get: vi.fn(async () => ({ data: () => data })), update: mockUpdate };
  return { id, data: () => data, ref };
}

vi.mock('firebase-admin', () => {
  const firestoreInstance = {
    collection: (collectionName: string) => {
      if (collectionName === 'sessions') {
        return {
          orderBy: mockOrderBy,
          add: mockAdd,
        };
      }
      if (collectionName === 'postings') {
        return {
          doc: (id: string) => ({
            id,
            update: mockUpdate,
            get: mockDocGet,
          }),
          where: mockWhere,
        };
      }
      return {};
    },
    batch: () => ({
      update: mockBatchUpdate,
      commit: mockBatchCommit,
    }),
  };

  // admin.firestore() is called as a function AND admin.firestore.FieldValue is accessed
  const firestoreFn = Object.assign(() => firestoreInstance, {
    FieldValue: {
      serverTimestamp: () => ({ _type: 'serverTimestamp' }),
      delete: () => ({ _type: 'delete' }),
    },
  });

  const adminMock = {
    firestore: firestoreFn,
  };

  return {
    default: adminMock,
    ...adminMock,
  };
});

// ─── Import module under test (after mocks) ────────────────────────────────

import './scoringService';

// ─── Test Helpers ───────────────────────────────────────────────────────────

function setupSessionQuery(existingHash?: string) {
  const sessionDoc = existingHash
    ? createMockDoc('session-1', { resumeHash: existingHash, resumeText: 'existing resume' })
    : null;

  const sessionSnapshot = createMockQuerySnapshot(sessionDoc ? [sessionDoc] : []);

  mockOrderBy.mockReturnValue({
    limit: vi.fn().mockReturnValue({
      get: vi.fn(async () => sessionSnapshot),
    }),
  });
}

function setupPostingsQuery(status: string, postings: Array<{ id: string; data: any }>) {
  const docs = postings.map((p) => createMockDoc(p.id, p.data));
  const snapshot = createMockQuerySnapshot(docs);

  mockWhere.mockImplementation((_field: string, _op: string, value: string) => {
    if (value === status) {
      return { get: vi.fn(async () => snapshot) };
    }
    return { get: vi.fn(async () => createMockQuerySnapshot([])) };
  });
}

function setupPostingsQueryMultiStatus(postingsByStatus: Record<string, Array<{ id: string; data: any }>>) {
  mockWhere.mockImplementation((_field: string, _op: string, value: string) => {
    const postings = postingsByStatus[value] || [];
    const docs = postings.map((p) => createMockDoc(p.id, p.data));
    return { get: vi.fn(async () => createMockQuerySnapshot(docs)) };
  });
}

function createOpenAIResponse(content: object) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(content),
        },
      },
    ],
  };
}

const validStructured = {
  roleTitle: 'SWE Intern',
  company: 'Google',
  location: 'Mountain View, CA',
  techStack: ['Python', 'Go'],
  deadline: '2025-06-01',
  workMode: 'hybrid' as const,
  summary: 'Backend engineering internship',
};

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('scoringService - resume hash comparison', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'new-session' });
    mockBatchCommit.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('same resume text produces same hash and skips re-scoring existing scored postings', async () => {
    const resumeText = 'This is a valid resume with more than fifty non-whitespace characters for testing purposes here.';

    // Compute expected hash for this text
    const crypto = await import('crypto');
    const expectedHash = crypto.createHash('sha256').update(resumeText.trim()).digest('hex');

    // Session with the same hash already exists
    setupSessionQuery(expectedHash);

    // No extracted postings to score (resume unchanged, only score unscored)
    setupPostingsQuery('extracted', []);

    const handler = capturedCallableHandler.current!;
    const result = await handler({ data: { text: resumeText } });

    expect(result.success).toBe(true);
    expect(result.scoredCount).toBe(0);
    expect(result.totalPostings).toBe(0);
    // Batch commit should NOT be called for invalidation since resume is unchanged
    expect(mockBatchUpdate).not.toHaveBeenCalled();
  });

  it('different resume text produces different hash and triggers re-scoring', async () => {
    const newResumeText = 'A completely different resume with over fifty non-whitespace characters for proper validation testing.';
    const oldHash = 'oldhashvalue1234567890abcdef1234567890abcdef1234567890abcdef12345678';

    // Session with a different hash
    setupSessionQuery(oldHash);

    // Setup scored and scoring_failed postings to be invalidated
    setupPostingsQueryMultiStatus({
      scored: [
        { id: 'posting-1', data: { structured: validStructured, status: 'scored' } },
      ],
      scoring_failed: [
        { id: 'posting-2', data: { structured: validStructured, status: 'scoring_failed' } },
      ],
      extracted: [
        { id: 'posting-1', data: { structured: validStructured, status: 'extracted' } },
        { id: 'posting-2', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // Mock OpenAI to return valid scoring response
    mockCreate.mockResolvedValue(
      createOpenAIResponse({ matchScore: 7, gapAnalysis: { matches: 'Python experience', missing: 'Go experience' } })
    );

    // Mock the doc.get() for checking scoring result
    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scored' }) });

    const handler = capturedCallableHandler.current!;
    const result = await handler({ data: { text: newResumeText } });

    expect(result.success).toBe(true);
    // Batch update should have been called for score invalidation
    expect(mockBatchUpdate).toHaveBeenCalled();
    expect(mockBatchCommit).toHaveBeenCalled();
  });
});

describe('scoringService - score invalidation on resume change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdd.mockResolvedValue({ id: 'new-session' });
    mockBatchCommit.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  it('invalidates scored and scoring_failed postings when resume changes', async () => {
    const newResumeText = 'Brand new resume text with enough non-whitespace characters to pass validation checks easily.';
    const oldHash = 'differenthash0000000000000000000000000000000000000000000000000000';

    setupSessionQuery(oldHash);

    const scoredPosting = createMockDoc('posting-scored', { structured: validStructured, status: 'scored' });
    const failedPosting = createMockDoc('posting-failed', { structured: validStructured, status: 'scoring_failed' });

    // When querying for 'scored' postings, return 1 doc
    // When querying for 'scoring_failed' postings, return 1 doc
    // When querying for 'extracted' postings (after invalidation), return those docs
    let queryCount = 0;
    mockWhere.mockImplementation((_field: string, _op: string, value: string) => {
      if (value === 'scored') {
        return { get: vi.fn(async () => createMockQuerySnapshot([scoredPosting])) };
      }
      if (value === 'scoring_failed') {
        return { get: vi.fn(async () => createMockQuerySnapshot([failedPosting])) };
      }
      if (value === 'extracted') {
        // After invalidation, both are now extracted
        queryCount++;
        return {
          get: vi.fn(async () =>
            createMockQuerySnapshot([
              createMockDoc('posting-scored', { structured: validStructured, status: 'extracted' }),
              createMockDoc('posting-failed', { structured: validStructured, status: 'extracted' }),
            ])
          ),
        };
      }
      return { get: vi.fn(async () => createMockQuerySnapshot([])) };
    });

    mockCreate.mockResolvedValue(
      createOpenAIResponse({ matchScore: 8, gapAnalysis: { matches: 'Strong fit', missing: 'Needs Rust' } })
    );
    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scored' }) });

    const handler = capturedCallableHandler.current!;
    const result = await handler({ data: { text: newResumeText } });

    expect(result.success).toBe(true);
    // Both the scored and scoring_failed postings should be batch-updated to 'extracted'
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalled();
  });
});

describe('scoringService - retry exhaustion marks scoring_failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdd.mockResolvedValue({ id: 'new-session' });
    mockBatchCommit.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks posting as scoring_failed after 3 OpenAI failures', async () => {
    const resumeText = 'A valid resume that contains more than fifty non-whitespace characters for proper validation.';

    // No existing session — first submission
    setupSessionQuery(undefined);

    // One posting to score
    setupPostingsQueryMultiStatus({
      scored: [],
      scoring_failed: [],
      extracted: [
        { id: 'posting-fail', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // OpenAI always fails
    mockCreate.mockRejectedValue(new Error('OpenAI API rate limited'));

    // After scoring fails, the posting should be scoring_failed
    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scoring_failed' }) });

    const handler = capturedCallableHandler.current!;

    // Run with fake timers to avoid waiting for backoff delays
    const resultPromise = handler({ data: { text: resumeText } });

    // Advance timers through backoff delays (5s, 10s)
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.failedCount).toBe(1);
    // posting should be marked as scoring_failed
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'scoring_failed' });
  });
});

describe('scoringService - non-integer score marks scoring_failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdd.mockResolvedValue({ id: 'new-session' });
    mockBatchCommit.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks posting as scoring_failed when OpenAI returns non-numeric score', async () => {
    const resumeText = 'A valid resume that contains more than fifty non-whitespace characters for proper validation.';

    setupSessionQuery(undefined);

    setupPostingsQueryMultiStatus({
      scored: [],
      scoring_failed: [],
      extracted: [
        { id: 'posting-bad-score', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // Return a response where matchScore is not a number (string instead)
    mockCreate.mockResolvedValue(
      createOpenAIResponse({ matchScore: 'seven', gapAnalysis: { matches: 'Good fit', missing: 'Needs more' } })
    );

    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scoring_failed' }) });

    const handler = capturedCallableHandler.current!;

    const resultPromise = handler({ data: { text: resumeText } });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.failedCount).toBe(1);
    // Should be marked as scoring_failed since validation rejects non-number score
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'scoring_failed' });
  });

  it('marks posting as scoring_failed when OpenAI returns Infinity score', async () => {
    const resumeText = 'A valid resume that contains more than fifty non-whitespace characters for proper validation.';

    setupSessionQuery(undefined);

    setupPostingsQueryMultiStatus({
      scored: [],
      scoring_failed: [],
      extracted: [
        { id: 'posting-inf-score', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // Infinity is not finite, so validateScoringResponse should reject it
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ matchScore: Infinity, gapAnalysis: { matches: 'Good', missing: 'Bad' } }) } }],
    });

    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scoring_failed' }) });

    const handler = capturedCallableHandler.current!;
    const resultPromise = handler({ data: { text: resumeText } });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'scoring_failed' });
  });
});

describe('scoringService - malformed gap analysis marks scoring_failed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockAdd.mockResolvedValue({ id: 'new-session' });
    mockBatchCommit.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks posting as scoring_failed when gap analysis is missing', async () => {
    const resumeText = 'A valid resume that contains more than fifty non-whitespace characters for proper validation.';

    setupSessionQuery(undefined);

    setupPostingsQueryMultiStatus({
      scored: [],
      scoring_failed: [],
      extracted: [
        { id: 'posting-no-gap', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // Return response with missing gapAnalysis field
    mockCreate.mockResolvedValue(
      createOpenAIResponse({ matchScore: 5 })
    );

    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scoring_failed' }) });

    const handler = capturedCallableHandler.current!;
    const resultPromise = handler({ data: { text: resumeText } });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'scoring_failed' });
  });

  it('marks posting as scoring_failed when gap analysis bullet exceeds 200 chars', async () => {
    const resumeText = 'A valid resume that contains more than fifty non-whitespace characters for proper validation.';

    setupSessionQuery(undefined);

    setupPostingsQueryMultiStatus({
      scored: [],
      scoring_failed: [],
      extracted: [
        { id: 'posting-long-gap', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // Return response with oversized gap analysis bullet (> 200 chars)
    const oversizedBullet = 'x'.repeat(201);
    mockCreate.mockResolvedValue(
      createOpenAIResponse({ matchScore: 5, gapAnalysis: { matches: oversizedBullet, missing: 'Short' } })
    );

    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scoring_failed' }) });

    const handler = capturedCallableHandler.current!;
    const resultPromise = handler({ data: { text: resumeText } });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'scoring_failed' });
  });

  it('marks posting as scoring_failed when gap analysis has non-string fields', async () => {
    const resumeText = 'A valid resume that contains more than fifty non-whitespace characters for proper validation.';

    setupSessionQuery(undefined);

    setupPostingsQueryMultiStatus({
      scored: [],
      scoring_failed: [],
      extracted: [
        { id: 'posting-bad-gap', data: { structured: validStructured, status: 'extracted' } },
      ],
    });

    // Return response with non-string gap analysis fields
    mockCreate.mockResolvedValue(
      createOpenAIResponse({ matchScore: 5, gapAnalysis: { matches: 123, missing: null } })
    );

    mockDocGet.mockResolvedValue({ data: () => ({ status: 'scoring_failed' }) });

    const handler = capturedCallableHandler.current!;
    const resultPromise = handler({ data: { text: resumeText } });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(10000);
    await vi.advanceTimersByTimeAsync(20000);

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'scoring_failed' });
  });
});
