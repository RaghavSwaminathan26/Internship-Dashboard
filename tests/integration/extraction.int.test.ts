/**
 * Integration test: End-to-end extraction flow.
 * Mock OpenAI API → extraction trigger → structured fields stored in Firestore.
 *
 * Validates: Requirements 3.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mock state ─────────────────────────────────────────────────────

const { mockUpdate, mockCreate, mockLogger, handlerRef } = vi.hoisted(() => {
  return {
    mockUpdate: vi.fn().mockResolvedValue(undefined),
    mockCreate: vi.fn(),
    mockLogger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    handlerRef: { current: null as ((event: unknown) => Promise<void>) | null },
  };
});

// ─── Mock firebase-functions/v2/firestore ───────────────────────────────────

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_path: string, handler: (event: unknown) => Promise<void>) => {
    handlerRef.current = handler;
    return handler;
  }),
}));

// ─── Mock firebase-functions logger ─────────────────────────────────────────

vi.mock('firebase-functions', () => ({
  logger: mockLogger,
}));

// ─── Mock firebase-admin ────────────────────────────────────────────────────

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => ({
      collection: () => ({
        doc: () => ({ update: mockUpdate }),
      }),
    }),
  },
  firestore: () => ({
    collection: () => ({
      doc: () => ({ update: mockUpdate }),
    }),
  }),
}));

// ─── Mock OpenAI ────────────────────────────────────────────────────────────

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = {
      completions: {
        create: mockCreate,
      },
    };
  },
}));

// ─── Import the extraction service (triggers handler capture) ───────────────

import '../../packages/functions/src/extraction/extractionService';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getHandler() {
  if (!handlerRef.current) {
    throw new Error('No handler captured from extraction service');
  }
  return handlerRef.current;
}

function createEvent(postingId: string, docData: Record<string, unknown> | null) {
  return {
    params: { postingId },
    data: docData !== null ? { data: () => docData } : null,
  };
}

function createOpenAIResponse(content: object) {
  return {
    choices: [{ message: { content: JSON.stringify(content) } }],
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Integration: End-to-end extraction (OpenAI → Firestore)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function runHandler(event: unknown) {
    const handler = getHandler();
    const promise = handler(event);
    await vi.runAllTimersAsync();
    return promise;
  }

  it('should extract structured fields from raw posting via OpenAI and store in Firestore', async () => {
    // Arrange: raw posting content and expected OpenAI response
    const rawPostingContent = `
      Software Engineering Intern at Google
      Location: Mountain View, CA
      We're looking for an intern to work on our search infrastructure.
      Tech Stack: Python, Go, C++, distributed systems
      Work Mode: Hybrid
      Application Deadline: 2025-03-15
    `;

    const openAIExtraction = {
      roleTitle: 'Software Engineering Intern',
      company: 'Google',
      location: 'Mountain View, CA',
      techStack: ['Python', 'Go', 'C++', 'distributed systems'],
      deadline: '2025-03-15',
      workMode: 'hybrid',
      summary: 'Search infrastructure internship at Google.',
    };

    mockCreate.mockResolvedValueOnce(createOpenAIResponse(openAIExtraction));

    const event = createEvent('posting-goog-001', { rawContent: rawPostingContent });

    // Act: run the extraction handler
    await runHandler(event);

    // Assert: posting updated with structured fields and status 'extracted'
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({
      structured: {
        roleTitle: 'Software Engineering Intern',
        company: 'Google',
        location: 'Mountain View, CA',
        techStack: ['Python', 'Go', 'C++', 'distributed systems'],
        deadline: '2025-03-15',
        workMode: 'hybrid',
        summary: 'Search infrastructure internship at Google.',
      },
      status: 'extracted',
    });
  });

  it('should send raw content to OpenAI with correct schema format', async () => {
    const rawContent = 'Backend Developer Intern at Meta. Remote. Uses React, Node.js.';

    const openAIExtraction = {
      roleTitle: 'Backend Developer Intern',
      company: 'Meta',
      location: 'Remote',
      techStack: ['React', 'Node.js'],
      deadline: null,
      workMode: 'remote',
      summary: 'Backend development internship at Meta.',
    };

    mockCreate.mockResolvedValueOnce(createOpenAIResponse(openAIExtraction));

    const event = createEvent('posting-meta-001', { rawContent });
    await runHandler(event);

    // Verify OpenAI was called with proper parameters
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-4o-mini');
    expect(callArgs.messages[1].content).toBe(rawContent);
    expect(callArgs.response_format.type).toBe('json_schema');
    expect(callArgs.response_format.json_schema.name).toBe('posting_extraction');
    expect(callArgs.response_format.json_schema.strict).toBe(true);
  });

  it('should handle null deadline from OpenAI and store it correctly', async () => {
    const openAIExtraction = {
      roleTitle: 'ML Intern',
      company: 'OpenAI',
      location: 'San Francisco',
      techStack: ['Python', 'PyTorch'],
      deadline: null,
      workMode: 'onsite',
      summary: 'Machine learning internship.',
    };

    mockCreate.mockResolvedValueOnce(createOpenAIResponse(openAIExtraction));

    const event = createEvent('posting-oai-001', { rawContent: 'ML intern posting...' });
    await runHandler(event);

    const updateArg = mockUpdate.mock.calls[0][0];
    expect(updateArg.structured.deadline).toBeNull();
    expect(updateArg.status).toBe('extracted');
  });

  it('should retry on OpenAI failure and succeed on subsequent attempt', async () => {
    const openAIExtraction = {
      roleTitle: 'DevOps Intern',
      company: 'AWS',
      location: 'Seattle, WA',
      techStack: ['Terraform', 'Docker', 'Kubernetes'],
      deadline: '2025-06-30',
      workMode: 'hybrid',
      summary: 'Cloud infrastructure internship.',
    };

    // First attempt fails, second succeeds
    mockCreate
      .mockRejectedValueOnce(new Error('OpenAI rate limited'))
      .mockResolvedValueOnce(createOpenAIResponse(openAIExtraction));

    const event = createEvent('posting-aws-001', { rawContent: 'DevOps posting...' });
    await runHandler(event);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith({
      structured: expect.objectContaining({
        roleTitle: 'DevOps Intern',
        company: 'AWS',
      }),
      status: 'extracted',
    });
  });

  it('should mark posting as extraction_failed after all retries exhausted', async () => {
    mockCreate
      .mockRejectedValueOnce(new Error('Error 1'))
      .mockRejectedValueOnce(new Error('Error 2'))
      .mockRejectedValueOnce(new Error('Error 3'));

    const event = createEvent('posting-fail-001', { rawContent: 'Some raw content' });
    await runHandler(event);

    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'extraction_failed',
      needs_manual_review: true,
    });
  });
});
