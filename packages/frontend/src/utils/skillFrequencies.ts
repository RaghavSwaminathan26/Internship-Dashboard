import type { PostingDocument, SkillFrequency } from '@interniq/shared/types';

/**
 * Computes skill frequencies across all postings' tech stack arrays.
 *
 * Counts each tech skill (case-insensitive) across all postings,
 * preserving the casing of the first occurrence seen.
 * Returns the top 10 skills sorted by frequency in descending order.
 * If fewer than 10 distinct skills exist, returns all available.
 */
export function computeSkillFrequencies(
  postings: PostingDocument[]
): SkillFrequency[] {
  // Map from lowercase skill -> { skill (first-seen casing), count }
  const frequencyMap = new Map<string, SkillFrequency>();

  for (const posting of postings) {
    const techStack = posting.structured?.techStack;
    if (!techStack) {
      continue;
    }

    for (const skill of techStack) {
      const key = skill.toLowerCase();
      const existing = frequencyMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        frequencyMap.set(key, { skill, count: 1 });
      }
    }
  }

  // Sort by frequency DESC, return top 10
  const sorted = [...frequencyMap.values()].sort((a, b) => b.count - a.count);

  return sorted.slice(0, 10);
}
