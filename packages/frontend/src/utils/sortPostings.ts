import type { PostingDocument } from '@interniq/shared/types';

/**
 * Sorts postings based on whether a resume has been submitted.
 *
 * When resumeSubmitted is true:
 *   - Scored postings appear first, sorted by matchScore DESC
 *     (ties broken by ingestedAt DESC)
 *   - Unscored postings follow, sorted by ingestedAt DESC
 *
 * When resumeSubmitted is false:
 *   - All postings sorted by ingestedAt DESC (chronological)
 */
export function sortPostings(
  postings: PostingDocument[],
  resumeSubmitted: boolean
): PostingDocument[] {
  const sorted = [...postings];

  if (!resumeSubmitted) {
    // Chronological: newest first
    sorted.sort((a, b) => compareTimestamps(b.ingestedAt, a.ingestedAt));
    return sorted;
  }

  // Split into scored and unscored
  const scored: PostingDocument[] = [];
  const unscored: PostingDocument[] = [];

  for (const posting of sorted) {
    if (posting.scoring?.matchScore != null) {
      scored.push(posting);
    } else {
      unscored.push(posting);
    }
  }

  // Sort scored: matchScore DESC, then ingestedAt DESC for ties
  scored.sort((a, b) => {
    const scoreA = a.scoring!.matchScore;
    const scoreB = b.scoring!.matchScore;
    if (scoreB !== scoreA) {
      return scoreB - scoreA;
    }
    return compareTimestamps(b.ingestedAt, a.ingestedAt);
  });

  // Sort unscored: ingestedAt DESC
  unscored.sort((a, b) => compareTimestamps(b.ingestedAt, a.ingestedAt));

  return [...scored, ...unscored];
}

/**
 * Compares two FirestoreTimestamp values.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
function compareTimestamps(
  a: PostingDocument['ingestedAt'],
  b: PostingDocument['ingestedAt']
): number {
  if (a.seconds !== b.seconds) {
    return a.seconds - b.seconds;
  }
  return a.nanoseconds - b.nanoseconds;
}
