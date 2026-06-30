import { useMemo } from 'react';
import type { PostingDocument } from '@interniq/shared/types';

/**
 * Derives a sorted list of unique tech tags from postings that have
 * extracted structured data. Used to populate the FilterPanel's tech
 * stack multi-select options.
 *
 * Returns tags sorted alphabetically (case-insensitive).
 */
export function useAvailableTechTags(postings: PostingDocument[]): string[] {
  return useMemo(() => {
    const tagSet = new Set<string>();

    for (const posting of postings) {
      if (posting.structured?.techStack) {
        for (const tag of posting.structured.techStack) {
          tagSet.add(tag);
        }
      }
    }

    return Array.from(tagSet).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  }, [postings]);
}
