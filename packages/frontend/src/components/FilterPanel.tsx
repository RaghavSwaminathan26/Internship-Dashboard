import { type ChangeEvent, type ReactNode } from 'react';
import type { FilterState, WorkMode } from '@interniq/shared/types';

export interface FilterPanelProps {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  availableTechTags: string[];
  resultCount: number;
}

const WORK_MODES: { value: WorkMode; label: string }[] = [
  { value: 'remote', label: 'Remote' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'onsite', label: 'Onsite' },
];

/**
 * FilterPanel provides controls for filtering internship postings by
 * location (text input), tech stack (multi-select checkboxes), and
 * work mode (checkboxes). All filter changes fire immediately without
 * a submit button. Displays a "no results" message when resultCount is 0.
 */
export default function FilterPanel({
  filters,
  onChange,
  availableTechTags,
  resultCount,
}: FilterPanelProps): ReactNode {
  const handleLocationChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.slice(0, 100);
    onChange({ ...filters, location: value });
  };

  const handleTechStackChange = (tag: string, checked: boolean) => {
    const updatedTechStack = checked
      ? [...filters.techStack, tag]
      : filters.techStack.filter((t) => t !== tag);
    onChange({ ...filters, techStack: updatedTechStack });
  };

  const handleWorkModeChange = (mode: WorkMode, checked: boolean) => {
    const updatedWorkMode = checked
      ? [...filters.workMode, mode]
      : filters.workMode.filter((m) => m !== mode);
    onChange({ ...filters, workMode: updatedWorkMode });
  };

  return (
    <div className="filter-panel" role="region" aria-label="Filter postings">
      {/* Location filter */}
      <fieldset className="filter-group">
        <legend>Location</legend>
        <label htmlFor="filter-location" className="sr-only">
          Filter by location
        </label>
        <input
          id="filter-location"
          type="text"
          value={filters.location}
          onChange={handleLocationChange}
          maxLength={100}
          placeholder="Type a city or region..."
          aria-describedby="filter-location-hint"
        />
        <span id="filter-location-hint" className="hint-text">
          Case-insensitive substring match (max 100 characters)
        </span>
      </fieldset>

      {/* Tech stack filter */}
      <fieldset className="filter-group">
        <legend>Tech Stack</legend>
        {availableTechTags.length === 0 ? (
          <p className="empty-state">No tech tags available.</p>
        ) : (
          <div role="group" aria-label="Select tech stack tags">
            {availableTechTags.map((tag) => (
              <label key={tag} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.techStack.includes(tag)}
                  onChange={(e) => handleTechStackChange(tag, e.target.checked)}
                  aria-label={`Filter by ${tag}`}
                />
                <span>{tag}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {/* Work mode filter */}
      <fieldset className="filter-group">
        <legend>Work Mode</legend>
        <div role="group" aria-label="Select work mode">
          {WORK_MODES.map(({ value, label }) => (
            <label key={value} className="checkbox-label">
              <input
                type="checkbox"
                checked={filters.workMode.includes(value)}
                onChange={(e) => handleWorkModeChange(value, e.target.checked)}
                aria-label={`Filter by ${label}`}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* No results message */}
      {resultCount === 0 && (
        <p className="no-results-message" role="status" aria-live="polite">
          No postings match the current filters.
        </p>
      )}
    </div>
  );
}
