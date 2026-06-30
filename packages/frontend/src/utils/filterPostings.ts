import type { PostingDocument, FilterState } from '@interniq/shared/types';

/**
 * Filters postings using AND logic across all active filter dimensions.
 *
 * - Location: case-insensitive substring match on posting's location field.
 *   Postings with no location are excluded when a location filter is active.
 * - Tech stack: posting must contain at least one of the selected tech tags (case-insensitive).
 * - Work mode: posting's workMode must match any of the checked options.
 *
 * Empty/unset filters are considered inactive and do not restrict results.
 */
export function filterPostings(
  postings: PostingDocument[],
  filters: FilterState
): PostingDocument[] {
  const locationFilter = filters.location.trim();
  const locationActive = locationFilter.length > 0;
  const locationLower = locationFilter.toLowerCase();

  const techStackActive = filters.techStack.length > 0;
  const techStackLower = filters.techStack.map((t) => t.toLowerCase());

  const workModeActive = filters.workMode.length > 0;

  return postings.filter((posting) => {
    // Location filter
    if (locationActive) {
      const postingLocation = posting.structured?.location;
      if (!postingLocation) {
        // Exclude postings with no location when location filter is active
        return false;
      }
      if (!postingLocation.toLowerCase().includes(locationLower)) {
        return false;
      }
    }

    // Tech stack filter (any match)
    if (techStackActive) {
      const postingTechStack = posting.structured?.techStack;
      if (!postingTechStack || postingTechStack.length === 0) {
        return false;
      }
      const postingTechLower = postingTechStack.map((t) => t.toLowerCase());
      const hasMatch = techStackLower.some((filterTag) =>
        postingTechLower.includes(filterTag)
      );
      if (!hasMatch) {
        return false;
      }
    }

    // Work mode filter (any match)
    if (workModeActive) {
      const postingWorkMode = posting.structured?.workMode;
      if (!postingWorkMode) {
        return false;
      }
      if (!filters.workMode.includes(postingWorkMode)) {
        return false;
      }
    }

    return true;
  });
}
