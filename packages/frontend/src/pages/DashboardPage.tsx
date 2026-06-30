import { type ReactNode, useState, useCallback } from 'react';
import type { FilterState } from '@interniq/shared/types';
import { usePostings } from '../hooks/usePostings';
import { useAvailableTechTags } from '../hooks/useAvailableTechTags';
import { filterPostings } from '../utils/filterPostings';
import PostingList from '../components/PostingList';
import TrendsChart from '../components/TrendsChart';
import FilterPanel from '../components/FilterPanel';
import ResumeInput from '../components/ResumeInput';

const DEFAULT_FILTERS: FilterState = {
  location: '',
  techStack: [],
  workMode: [],
};

/**
 * Main dashboard layout component.
 * Orchestrates real-time Firestore data, filtering, and child components.
 *
 * - Subscribes to postings via onSnapshot (real-time updates)
 * - Manages filter state and applies client-side filtering
 * - Tracks resume submission status
 * - Handles loading and offline/error states
 */
export default function DashboardPage(): ReactNode {
  const { postings, isLoading, error } = usePostings();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [resumeSubmitted, setResumeSubmitted] = useState(false);

  const availableTechTags = useAvailableTechTags(postings);
  const filteredPostings = filterPostings(postings, filters);

  const handleResumeSubmit = useCallback((text: string) => {
    if (text.trim().length > 0) {
      setResumeSubmitted(true);
    }
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <h1>InternIQ Dashboard</h1>
          <p>Tech internship intelligence — ranked by your resume fit</p>
        </header>
        <main className="dashboard-main">
          <p className="dashboard-loading" role="status" aria-live="polite">
            Loading postings…
          </p>
        </main>
      </div>
    );
  }

  // Error state (with cached data fallback)
  if (error && postings.length === 0) {
    return (
      <div className="dashboard-page">
        <header className="dashboard-header">
          <h1>InternIQ Dashboard</h1>
          <p>Tech internship intelligence — ranked by your resume fit</p>
        </header>
        <main className="dashboard-main">
          <p className="dashboard-error" role="alert">
            Unable to load postings. Please check your connection and try again.
          </p>
        </main>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1>InternIQ Dashboard</h1>
        <p>Tech internship intelligence — ranked by your resume fit</p>
      </header>

      {/* Offline banner — shown when there's an error but cached data is available */}
      {error && postings.length > 0 && (
        <div className="dashboard-offline-banner" role="status" aria-live="polite">
          You appear to be offline. Showing cached data.
        </div>
      )}

      <main className="dashboard-main">
        <aside className="dashboard-sidebar">
          <section className="filter-section" aria-label="Filters">
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              availableTechTags={availableTechTags}
              resultCount={filteredPostings.length}
            />
          </section>

          <section className="resume-section" aria-label="Resume Input">
            <ResumeInput onSubmit={handleResumeSubmit} />
          </section>
        </aside>

        <div className="dashboard-content">
          <section className="posting-list-section" aria-label="Posting List">
            <PostingList
              postings={filteredPostings}
              resumeSubmitted={resumeSubmitted}
            />
          </section>

          <section className="trends-section" aria-label="Tech Skills Trends">
            <TrendsChart postings={postings} />
          </section>
        </div>
      </main>
    </div>
  );
}
