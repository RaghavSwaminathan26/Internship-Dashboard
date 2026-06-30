import type { ReactNode } from 'react';
import type { PostingDocument } from '@interniq/shared/types';
import { sortPostings } from '../utils/sortPostings';
import PostingCard from './PostingCard';

interface PostingListProps {
  postings: PostingDocument[];
  resumeSubmitted: boolean;
}

/**
 * Displays a sorted list of internship postings.
 * Shows a notice when no resume has been submitted indicating scoring is unavailable.
 * Sorts postings by match score (desc) when scored, or chronologically otherwise.
 */
export default function PostingList({ postings, resumeSubmitted }: PostingListProps): ReactNode {
  const sorted = sortPostings(postings, resumeSubmitted);

  return (
    <section className="posting-list" aria-label="Internship postings list">
      {!resumeSubmitted && (
        <div className="posting-list__notice" role="status" aria-live="polite">
          <p>
            Scoring is unavailable until a resume is submitted. Submit your resume to see match
            scores and gap analysis for each posting.
          </p>
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="posting-list__empty">No postings available.</p>
      ) : (
        <div className="posting-list__items">
          {sorted.map((posting) => (
            <PostingCard key={posting.id} posting={posting} />
          ))}
        </div>
      )}
    </section>
  );
}
