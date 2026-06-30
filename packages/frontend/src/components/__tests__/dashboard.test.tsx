import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { PostingDocument, FirestoreTimestamp } from '@interniq/shared/types';
import PostingList from '../PostingList';
import FilterPanel from '../FilterPanel';
import TrendsChart from '../TrendsChart';
import ResumeInput from '../ResumeInput';

// Mock firebase/functions to avoid actual Firebase calls
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => new Promise(() => {}), // never resolves by default
  getFunctions: () => ({}),
}));

// Mock the firebase module
vi.mock('../../firebase', () => ({
  functions: {},
  db: {},
  default: {},
}));

// Mock recharts to avoid rendering issues in jsdom
vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  CartesianGrid: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeTimestamp(seconds: number): FirestoreTimestamp {
  return { seconds, nanoseconds: 0, toDate: () => new Date(seconds * 1000) };
}

function makePosting(overrides: Partial<PostingDocument> & { id: string; ingestedAt: FirestoreTimestamp }): PostingDocument {
  return {
    source: 'adzuna',
    rawContent: 'raw content',
    status: 'extracted',
    ...overrides,
  };
}

// ─── Test 1: Sort without resume produces chronological order ───────────────
describe('PostingList - sort without resume (Requirement 5.3)', () => {
  it('renders postings in chronological order (ingestedAt DESC) when no resume submitted', () => {
    const postings: PostingDocument[] = [
      makePosting({
        id: 'oldest',
        ingestedAt: makeTimestamp(1000),
        structured: { roleTitle: 'Oldest Role', company: 'A', location: 'NYC', techStack: [], deadline: null, workMode: 'remote', summary: 'oldest' },
      }),
      makePosting({
        id: 'newest',
        ingestedAt: makeTimestamp(3000),
        structured: { roleTitle: 'Newest Role', company: 'B', location: 'LA', techStack: [], deadline: null, workMode: 'hybrid', summary: 'newest' },
      }),
      makePosting({
        id: 'middle',
        ingestedAt: makeTimestamp(2000),
        structured: { roleTitle: 'Middle Role', company: 'C', location: 'SF', techStack: [], deadline: null, workMode: 'onsite', summary: 'middle' },
      }),
    ];

    render(<PostingList postings={postings} resumeSubmitted={false} />);

    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(3);
    // Newest first (ingestedAt DESC)
    expect(articles[0]).toHaveTextContent('Newest Role');
    expect(articles[1]).toHaveTextContent('Middle Role');
    expect(articles[2]).toHaveTextContent('Oldest Role');
  });
});

// ─── Test 2: Empty filter results show "no results" message ─────────────────
describe('FilterPanel - empty filter results (Requirement 6.5)', () => {
  it('shows "No postings match the current filters" when resultCount is 0', () => {
    render(
      <FilterPanel
        filters={{ location: 'Nonexistent', techStack: [], workMode: [] }}
        onChange={() => {}}
        availableTechTags={['React', 'Node.js']}
        resultCount={0}
      />
    );

    expect(screen.getByText(/no postings match the current filters/i)).toBeInTheDocument();
  });

  it('does NOT show "no results" message when resultCount > 0', () => {
    render(
      <FilterPanel
        filters={{ location: '', techStack: [], workMode: [] }}
        onChange={() => {}}
        availableTechTags={['React']}
        resultCount={5}
      />
    );

    expect(screen.queryByText(/no postings match the current filters/i)).not.toBeInTheDocument();
  });
});

// ─── Test 3: Trends chart empty state shows "no data" message ───────────────
describe('TrendsChart - empty state (Requirement 7.5)', () => {
  it('shows "Trend data is not yet available" when no postings have tech stack data', () => {
    const postings: PostingDocument[] = [
      makePosting({
        id: 'no-tech-1',
        ingestedAt: makeTimestamp(1000),
        // No structured field at all
      }),
      makePosting({
        id: 'no-tech-2',
        ingestedAt: makeTimestamp(2000),
        structured: { roleTitle: 'Role', company: 'Co', location: 'NYC', techStack: [], deadline: null, workMode: 'remote', summary: 's' },
      }),
    ];

    render(<TrendsChart postings={postings} />);

    expect(screen.getByText('Trend data is not yet available.')).toBeInTheDocument();
  });

  it('does NOT show empty state when postings have tech stack data', () => {
    const postings: PostingDocument[] = [
      makePosting({
        id: 'with-tech',
        ingestedAt: makeTimestamp(1000),
        structured: { roleTitle: 'Role', company: 'Co', location: 'NYC', techStack: ['React', 'TypeScript'], deadline: null, workMode: 'remote', summary: 's' },
      }),
    ];

    render(<TrendsChart postings={postings} />);

    expect(screen.queryByText('Trend data is not yet available.')).not.toBeInTheDocument();
  });
});

// ─── Test 4: 60s timeout triggers error UI ──────────────────────────────────
describe('ResumeInput - 60s timeout (Requirement 8.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows timeout error message after 60 seconds', async () => {
    // Mock httpsCallable to return a function that returns a never-resolving promise
    const neverResolves = () => new Promise(() => {});
    vi.mocked(await import('firebase/functions')).httpsCallable = vi.fn(() => neverResolves as any);

    render(<ResumeInput onSubmit={() => {}} />);

    // Enter valid resume text (>50 non-whitespace characters)
    const textarea = screen.getByPlaceholderText(/paste your resume content here/i);
    const validResume = 'A'.repeat(60); // 60 non-whitespace chars
    fireEvent.change(textarea, { target: { value: validResume } });

    // Submit the form
    const submitButton = screen.getByRole('button', { name: /score my resume/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify loading state is shown
    expect(screen.getByText(/scoring your resume against postings/i)).toBeInTheDocument();

    // Advance time by 60 seconds
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    // Verify timeout error is displayed
    expect(screen.getByText(/scoring timed out\. please try again\./i)).toBeInTheDocument();
  });
});

// ─── Test 5: Loading indicator displays during scoring ──────────────────────
describe('ResumeInput - loading indicator (Requirement 8.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading indicator during scoring', async () => {
    // Mock httpsCallable to return a function that returns a never-resolving promise
    const neverResolves = () => new Promise(() => {});
    vi.mocked(await import('firebase/functions')).httpsCallable = vi.fn(() => neverResolves as any);

    render(<ResumeInput onSubmit={() => {}} />);

    // Enter valid resume text
    const textarea = screen.getByPlaceholderText(/paste your resume content here/i);
    const validResume = 'B'.repeat(60);
    fireEvent.change(textarea, { target: { value: validResume } });

    // Submit
    const submitButton = screen.getByRole('button', { name: /score my resume/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify loading state
    expect(screen.getByText(/scoring your resume against postings/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /scoring/i })).toBeDisabled();
  });
});
