import type { ReactNode } from 'react';
import type { PostingDocument } from '@interniq/shared/types';

interface PostingCardProps {
  posting: PostingDocument;
}

/**
 * Displays a single internship posting with role details, match score,
 * work mode badge, tech stack tags, and gap analysis.
 */
export default function PostingCard({ posting }: PostingCardProps): ReactNode {
  const { structured, scoring } = posting;

  const roleTitle = structured?.roleTitle ?? 'Untitled Role';
  const company = structured?.company ?? 'Unknown Company';
  const location = structured?.location ?? 'Location not specified';
  const workMode = structured?.workMode ?? 'onsite';
  const techStack = structured?.techStack?.slice(0, 8) ?? [];

  const isScored = scoring?.matchScore != null;

  return (
    <article className="posting-card" aria-label={`${roleTitle} at ${company}`}>
      <div className="posting-card__header">
        <h3 className="posting-card__title">{roleTitle}</h3>
        <span className="posting-card__company">{company}</span>
      </div>

      <div className="posting-card__meta">
        <span className="posting-card__location">{location}</span>
        <span
          className={`posting-card__work-mode posting-card__work-mode--${workMode}`}
          aria-label={`Work mode: ${workMode}`}
        >
          {workMode}
        </span>
        {isScored && (
          <span
            className="posting-card__score"
            aria-label={`Match score: ${scoring!.matchScore} out of 10`}
          >
            {scoring!.matchScore}/10
          </span>
        )}
      </div>

      {techStack.length > 0 && (
        <ul className="posting-card__tech-stack" aria-label="Tech stack">
          {techStack.map((tech) => (
            <li key={tech} className="posting-card__tech-tag">
              {tech}
            </li>
          ))}
        </ul>
      )}

      {isScored && scoring!.gapAnalysis && (
        <div className="posting-card__gap-analysis" aria-label="Gap analysis">
          <ul className="posting-card__gap-list">
            <li className="posting-card__gap-match">
              <span className="posting-card__gap-label">Matches:</span>{' '}
              {scoring!.gapAnalysis.matches}
            </li>
            <li className="posting-card__gap-missing">
              <span className="posting-card__gap-label">Missing:</span>{' '}
              {scoring!.gapAnalysis.missing}
            </li>
          </ul>
        </div>
      )}
    </article>
  );
}
