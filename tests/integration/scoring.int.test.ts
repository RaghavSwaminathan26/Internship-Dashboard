/**
 * Integration test: End-to-end scoring flow.
 * Resume submit → OpenAI scoring → posting updated with matchScore, gapAnalysis, status='scored'.
 *
 * Validates: Requirements 4.1, 5.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock state ─────────────────────────────────────────────────────

const {
  mockOpenAICreate,
  mockLogger,
  submitHandlerRef,
  extractedHandlerRef,
  firestoreData,
} = vi.hoisted(() => {
  return {
    mockOpenAICreate: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    submitHandlerRef: { current: null as ((request: unknown) => Promise<unknown>) | null },
    extractedHandlerRef: { current: null as ((event: unknown) => Promise<void>) | null },
    firestoreData: new Map<string, Record<string, unknown>>(),
  };
});

// ─── Mock firebase-functions/v2/https ───────────────────────────────────────

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handler: (request: unknown) => Promise<unknown>) => {
    submitHandlerRef.current = handler;
    return handler;
  }),
  HttpsError: class HttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

// ─── Mock firebase-functions/v2/firestore ───────────────────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: vi.fn((_path: string, handler: (event: unknown) => Promise<void>) => {
    extractedHandlerRef.current = handler;
    return handler;
  }),
}));

// ─── Mock firebase-functions logger ─────────────────────────────────────────

vi.mock('firebase-functions', () => ({
  logger: mockLogger,
}));

// ─── Mock firebase-admin (full Firestore simulation) ────────────────────────

vi.mock('firebase-admin', () => {
  const createDocRef = (collectionName: string, docId: string) => ({
    id: docId,
    get: vi.fn(async () => {
      const key = `${collectionName}/${docId}`;
      const data = firestoreData.get(key);
      return {
        exists: !!data,
        id: docId,
        data: () => data,
        ref: createDocRef(collectionName, docId),
      };
    }),
    update: vi.fn(async (updateData: Record<string, unknown>) => {
      const key = `${collectionName}/${docId}`;
      const existing = firestoreData.get(key) || {};
      const merged = { ...existing };
      for (const [k, v] of Object.entries(updateData)) {
        if (v && typeof v === 'object' && '_type' in (v as object) && (v as { _type: string })._type === 'delete') {
          delete merged[k];
        } else {
          merged[k] = v;
        }
      }
      firestoreData.set(key, merged);
    }),
  });

  const createCollectionRef = (collectionName: string) => ({
    doc: (docId: string) => createDocRef(collectionName, docId),
    add: vi.fn(async (data: Record<string, unknown>) => {
      const docId = `auto-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const key = `${collectionName}/${docId}`;
      firestoreData.set(key, { ...data, id: docId });
      return createDocRef(collectionName, docId);
    }),
    where: vi.fn((_field: string, _op: string, _value: unknown) => ({
      get: vi.fn(async () => {
        const docs: Array<{
          id: string;
          data: () => Record<string, unknown>;
          ref: ReturnType<typeof createDocRef>;
        }> = [];
        for (const [key, value] of firestoreData.entries()) {
          if (key.startsWith(`${collectionName}/`)) {
            const docId = key.split('/')[1]!;
            if (_field === 'status' && value.status === _value) {
              docs.push({
                id: docId,
                data: () => value,
                ref: createDocRef(collectionName, docId),
              });
            }
          }
        }
        return { docs, empty: docs.length === 0, size: docs.length };
      }),
    })),
    orderBy: vi.fn(() => ({
      limit: vi.fn(() => ({
        get: vi.fn(async () => {
          const docs: Array<{
            id: string;
            data: () => Record<string, unknown>;
            ref: ReturnType<typeof createDocRef>;
          }> = [];
          for (const [key, value] of firestoreData.entries()) {
            if (key.startsWith(`${collectionName}/`)) {
              const docId = key.split('/')[1]!;
              docs.push({ id: docId, data: () => value, ref: createDocRef(collectionName, docId) });
            }
          }
          return { docs: docs.slice(0, 1), empty: docs.length === 0 };
        }),
      })),
    })),
  });

  const mockBatch = {
    update: vi.fn(),
    commit: vi.fn(async () => {}),
  };

  const firestoreInstance = () => ({
    collection: (name: string) => createCollectionRef(name),
    batch: () => mockBatch,
  });

  // Attach static properties to the firestore function
  firestoreInstance.Timestamp = {
    now: () => ({ seconds: 1700000000, nanoseconds: 0, toDate: () => new Date() }),
  };
  firestoreInstance.FieldValue = {
    serverTimestamp: () => ({ _type: 'serverTimestamp' }),
    delete: () => ({ _type: 'delete' }),
  };

  return {
    default: {
      firestore: firestoreInstance,
    },
    firestore: firestoreInstance,
  };
});

// ─── Mock OpenAI ────────────────────────────────────────────────────────────

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockOpenAICreate,
      },
    };
  },
}));

// ─── Mock resume validation (pass-through for integration test) ─────────────

vi.mock('../../packages/functions/src/scoring/resumeValidation', () => ({
  validateResumeInput: (text: string) => {
    if (!text || text.trim().length < 50) {
      return { valid: false, errors: ['Resume too short'] };
    }
    if (text.length > 10000) {
      return { valid: false, errors: ['Resume too long'] };
    }
    return { valid: true, errors: [] };
  },
}));

// ─── Mock score validation ──────────────────────────────────────────────────

vi.mock('../../packages/functions/src/scoring/scoreValidation', () => ({
  validateScoringResponse: (raw: unknown) => {
    const obj = raw as { matchScore?: number; gapAnalysis?: { matches?: string; missing?: string } };
    if (!obj || typeof obj.matchScore !== 'number' || !obj.gapAnalysis) {
      return { valid: false, score: null, gapAnalysis: null };
    }
    return {
      valid: true,
      score: Math.min(10, Math.max(1, Math.round(obj.matchScore))),
      gapAnalysis: obj.gapAnalysis,
    };
  },
}));

// ─── Import scoring service (captures handlers) ─────────────────────────────

import '../../packages/functions/src/scoring/scoringService';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSubmitHandler() {
  if (!submitHandlerRef.current) {
    throw new Error('No submitResume handler captured');
  }
  return submitHandlerRef.current;
}

function createOpenAIScoringResponse(score: number, matches: string, missing: string) {
  return {
    choices: [{
      message: {
        content: JSON.stringify({ matchScore: score, gapAnalysis: { matches, missing } }),
      },
    }],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Integration: End-to-end scoring (resume submit → score → Firestore update)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    firestoreData.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runSubmitHandler(request: unknown) {
    const handler = getSubmitHandler();
    const promise = handler(request);
    await vi.runAllTimersAsync();
    return promise;
  }

  it('should score extracted postings when resume is submitted and update Firestore', async () => {
    // Arrange: put an extracted posting in Firestore
    firestoreData.set('postings/posting-score-001', {
      id: 'posting-score-001',
      source: 'adzuna',
      rawContent: 'Some raw content',
      status: 'extracted',
      structured: {
        roleTitle: 'Frontend Intern',
        company: 'Vercel',
        location: 'Remote',
        techStack: ['React', 'TypeScript', 'Next.js'],
        deadline: '2025-04-01',
        workMode: 'remote',
        summary: 'Frontend development with React and Next.js.',
      },
    });

    // Mock OpenAI scoring response
    mockOpenAICreate.mockResolvedValueOnce(
      createOpenAIScoringResponse(8, 'Strong React and TypeScript skills', 'Missing Next.js experience')
    );

    const resumeText = 'I am a frontend developer with 2 years of React and TypeScript experience. ' +
      'I have built multiple web applications and am familiar with modern web development practices. ' +
      'Looking for an internship to deepen my skills.';

    // Act: submit resume
    const result = await runSubmitHandler({ data: { text: resumeText } });

    // Assert: scoring succeeded
    expect(result).toMatchObject({
      success: true,
      scoredCount: 1,
      failedCount: 0,
      totalPostings: 1,
    });

    // Assert: posting was updated with scoring data
    const updatedPosting = firestoreData.get('postings/posting-score-001');
    expect(updatedPosting).toBeDefined();
    expect(updatedPosting!.status).toBe('scored');
    expect(updatedPosting!.scoring).toMatchObject({
      matchScore: 8,
      gapAnalysis: {
        matches: 'Strong React and TypeScript skills',
        missing: 'Missing Next.js experience',
      },
    });
  });

  it('should mark posting as scoring_failed when OpenAI fails after retries', async () => {
    // Arrange: put an extracted posting in Firestore
    firestoreData.set('postings/posting-fail-001', {
      id: 'posting-fail-001',
      source: 'adzuna',
      rawContent: 'Some raw content',
      status: 'extracted',
      structured: {
        roleTitle: 'Backend Intern',
        company: 'Stripe',
        location: 'San Francisco',
        techStack: ['Python', 'Go'],
        deadline: null,
        workMode: 'hybrid',
        summary: 'Backend systems internship.',
      },
    });

    // Mock OpenAI failing all 3 attempts
    mockOpenAICreate
      .mockRejectedValueOnce(new Error('OpenAI error 1'))
      .mockRejectedValueOnce(new Error('OpenAI error 2'))
      .mockRejectedValueOnce(new Error('OpenAI error 3'));

    const resumeText = 'I am a backend developer with Python experience and interest in distributed systems. ' +
      'Built several REST APIs and familiar with databases and caching layers.';

    // Act: submit resume
    const result = await runSubmitHandler({ data: { text: resumeText } });

    // Assert: scoring failed
    expect(result).toMatchObject({
      success: true,
      scoredCount: 0,
      failedCount: 1,
      totalPostings: 1,
    });

    // Assert: posting marked as scoring_failed
    const updatedPosting = firestoreData.get('postings/posting-fail-001');
    expect(updatedPosting).toBeDefined();
    expect(updatedPosting!.status).toBe('scoring_failed');
  });

  it('should reject invalid resume input (too short)', async () => {
    const shortResume = 'Too short';

    const handler = getSubmitHandler();

    await expect(handler({ data: { text: shortResume } })).rejects.toThrow();
  });

  it('should store session document with resume hash on submission', async () => {
    // No extracted postings, so no scoring happens, but session should be stored
    mockOpenAICreate.mockResolvedValue(
      createOpenAIScoringResponse(5, 'Some matches', 'Some gaps')
    );

    const resumeText = 'I am a full-stack developer with experience in React, Node.js, and PostgreSQL. ' +
      'Built production applications at scale and looking to grow my career in tech.';

    await runSubmitHandler({ data: { text: resumeText } });

    // Check that a session was stored
    let sessionFound = false;
    for (const [key, value] of firestoreData.entries()) {
      if (key.startsWith('sessions/')) {
        sessionFound = true;
        expect(value).toHaveProperty('resumeText');
        expect(value).toHaveProperty('resumeHash');
        expect(typeof value.resumeHash).toBe('string');
        expect((value.resumeHash as string)).toHaveLength(64); // SHA-256 hex
      }
    }
    expect(sessionFound).toBe(true);
  });
});
