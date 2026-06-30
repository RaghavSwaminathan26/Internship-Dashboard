# Implementation Plan: InternIQ Dashboard

## Overview

This plan implements InternIQ as a full-stack TypeScript application using React (frontend), Firebase Cloud Functions (backend), Firestore (database), and OpenAI API (LLM integration). The implementation follows the pipeline architecture: project setup → ingestion → extraction → scoring → dashboard UI → integration wiring.

## Tasks

- [ ] 1. Set up project structure, shared types, and tooling
  - [ ] 1.1 Initialize monorepo with frontend and functions packages
    - Create root `package.json` with workspaces for `packages/frontend` and `packages/functions`
    - Initialize `packages/frontend` with Vite + React + TypeScript template
    - Initialize `packages/functions` with Firebase Functions TypeScript template
    - Install shared dev dependencies: `typescript`, `vitest`, `fast-check`, `eslint`
    - Configure `tsconfig.json` for both packages with strict mode enabled
    - _Requirements: All (project foundation)_

  - [ ] 1.2 Define shared TypeScript interfaces and constants
    - Create `packages/shared/types.ts` with `PostingDocument`, `SessionDocument`, `StructuredFields`, `PostingScore`, `ResumeInput`, `FilterState`, `ParsedRow` interfaces
    - Create `packages/shared/constants.ts` with `FIELD_CONSTRAINTS`, retry configuration, and status enums
    - Export all types for use in both frontend and functions packages
    - _Requirements: 3.2, 4.4, 4.5, 5.2, 6.1_

  - [ ] 1.3 Configure Firebase project and Firestore rules
    - Create `firebase.json` with functions and firestore configuration
    - Create `firestore.rules` with read/write rules for `postings` and `sessions` collections
    - Create `firestore.indexes.json` with composite indexes for ranked listing, extraction queue, and filtered queries
    - _Requirements: 1.2, 2.2, 5.1_

- [ ] 2. Implement Ingestion Service
  - [ ] 2.1 Implement Adzuna API fetcher with pagination and retry logic
    - Create `packages/functions/src/ingestion/adzunaFetcher.ts`
    - Implement `fetchAdzunaPostings()` with pagination up to 500 postings max
    - Implement exponential backoff retry (1s base, 3 max retries)
    - Filter to technology/software categories
    - Log errors with timestamps on each retry attempt
    - _Requirements: 1.1, 1.4, 1.5_

  - [ ] 2.2 Implement SimplifyJobs markdown parser
    - Create `packages/functions/src/ingestion/simplifyParser.ts`
    - Implement `parseMarkdownTable()` to extract rows from the markdown internship table
    - Implement `parseMarkdownRow()` to parse individual rows into `ParsedRow` objects
    - Implement `serializeToMarkdownRow()` to convert `ParsedRow` back to markdown format
    - Handle invalid rows gracefully: skip and log errors, continue parsing
    - _Requirements: 2.1, 2.5, 2.7_

  - [ ]* 2.3 Write property test: Markdown Table Parse Round-Trip
    - **Property 1: Markdown Table Parse Round-Trip**
    - Generate random `ParsedRow` objects with arbitrary non-empty strings for company, role, location, applicationLink, datePosted
    - Assert: serialize → parse → result is equivalent to original
    - **Validates: Requirements 2.7**

  - [ ]* 2.4 Write property test: Parser Resilience with Invalid Rows
    - **Property 2: Parser Resilience with Invalid Rows**
    - Generate markdown tables with a mix of valid and invalid/malformed rows
    - Assert: parsed result count equals valid input row count, order preserved
    - **Validates: Requirements 2.5**

  - [ ] 2.5 Implement SimplifyJobs fetcher with retry logic
    - Create `packages/functions/src/ingestion/simplifyFetcher.ts`
    - Implement `fetchSimplifyPostings()` to fetch raw markdown from GitHub
    - Implement exponential backoff retry (1s base, 3 max retries)
    - Validate markdown contains recognizable table structure before parsing
    - _Requirements: 2.1, 2.4, 2.6_

  - [ ] 2.6 Implement deduplication and Firestore write logic
    - Create `packages/functions/src/ingestion/ingestionService.ts`
    - Implement main ingestion orchestrator that calls both fetchers
    - Check existing document IDs before writing (skip duplicates)
    - Store raw postings with status `'raw'`, source, rawContent, and ingestedAt
    - Use Adzuna ID for Adzuna postings, derive `${company}-${role}` hash for SimplifyJobs
    - _Requirements: 1.2, 1.3, 2.2, 2.3_

  - [ ]* 2.7 Write unit tests for ingestion service
    - Test Adzuna pagination stops at 500 postings
    - Test deduplication skips existing posting IDs
    - Test retry exhaustion logs final failure
    - Test invalid markdown rows are skipped with logging
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.3, 2.5_

- [ ] 3. Checkpoint - Verify ingestion service
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement Extraction Service
  - [ ] 4.1 Implement structured field validation and truncation
    - Create `packages/functions/src/extraction/fieldValidation.ts`
    - Implement `validateAndTruncateFields()` to enforce max lengths, list sizes, and enum values
    - Implement `validateDeadline()` to check ISO 8601 format, return null for invalid
    - Reference `FIELD_CONSTRAINTS` constants for all limits
    - _Requirements: 3.2, 3.3, 3.5_

  - [ ]* 4.2 Write property test: Structured Field Validation and Truncation
    - **Property 3: Structured Field Validation and Truncation**
    - Generate objects with random-length strings and oversized tech stack lists
    - Assert: all output string fields ≤ max length, techStack ≤ 30 items with each ≤ 50 chars, workMode is valid enum
    - **Validates: Requirements 3.2, 3.3**

  - [ ]* 4.3 Write property test: Invalid Date Normalization
    - **Property 4: Invalid Date Normalization**
    - Generate a mix of valid ISO 8601 dates (YYYY-MM-DD) and arbitrary strings
    - Assert: invalid dates → null, valid dates → preserved unchanged
    - **Validates: Requirements 3.5**

  - [ ] 4.4 Implement extraction service with OpenAI Structured Outputs
    - Create `packages/functions/src/extraction/extractionService.ts`
    - Implement Firestore `onCreate` trigger on `postings` collection
    - Send raw posting content to OpenAI API with structured output schema (`strict: true`)
    - Validate response with `validateAndTruncateFields()`
    - Write structured fields back to posting document, update status to `'extracted'`
    - Implement retry logic (2s base, 3 max retries) for API errors
    - Mark as `extraction_failed` and `needs_manual_review` after exhausting retries
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 4.5 Write unit tests for extraction service
    - Test successful extraction updates posting document
    - Test truncation of oversized fields
    - Test invalid deadline sets null and marks needs_manual_review
    - Test retry exhaustion marks extraction_failed
    - _Requirements: 3.2, 3.4, 3.5, 3.6_

- [ ] 5. Checkpoint - Verify extraction service
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement Scoring Service
  - [ ] 6.1 Implement resume validation
    - Create `packages/functions/src/scoring/resumeValidation.ts`
    - Implement `validateResumeInput()` to check max 10,000 chars and min 50 non-whitespace chars
    - Return structured `ValidationResult` with error messages
    - _Requirements: 4.1, 4.10, 8.3_

  - [ ]* 6.2 Write property test: Resume Input Validation
    - **Property 7: Resume Input Validation**
    - Generate strings with varying whitespace/non-whitespace ratios and lengths
    - Assert: rejected if >10,000 total chars OR <50 non-whitespace chars, accepted otherwise
    - **Validates: Requirements 4.10, 8.3**

  - [ ] 6.3 Implement score clamping and response validation
    - Create `packages/functions/src/scoring/scoreValidation.ts`
    - Implement `clampScore()` to constrain values to integer range [1, 10]
    - Implement `validateGapAnalysis()` to check exactly 2 bullets, each ≤ 200 chars
    - Implement `validateScoringResponse()` combining score and gap analysis validation
    - _Requirements: 4.4, 4.5, 4.6, 4.9_

  - [ ]* 6.4 Write property test: Score Clamping Invariant
    - **Property 5: Score Clamping Invariant**
    - Generate arbitrary numbers (integers, floats, negatives, large values)
    - Assert: result is integer in [1, 10], values already in range are unchanged
    - **Validates: Requirements 4.6**

  - [ ]* 6.5 Write property test: Scoring Response Validation
    - **Property 6: Scoring Response Validation**
    - Generate objects with varying score types and bullet counts/lengths
    - Assert: accepted iff score is integer in [1,10] AND gap analysis has exactly 2 bullets each ≤ 200 chars
    - **Validates: Requirements 4.5, 4.9**

  - [ ] 6.6 Implement scoring service with OpenAI integration
    - Create `packages/functions/src/scoring/scoringService.ts`
    - Implement HTTP callable function for resume submission
    - Store resume in `sessions` collection with SHA-256 hash
    - Detect resume changes via hash comparison, invalidate existing scores on change
    - Send resume + posting structured data to OpenAI, validate response
    - Write `matchScore` and `gapAnalysis` to posting document, update status to `'scored'`
    - Implement retry logic (5s base, 3 max retries) for API errors
    - Score new postings automatically when resume exists
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ]* 6.7 Write unit tests for scoring service
    - Test resume hash comparison detects changes
    - Test score invalidation on resume change
    - Test retry exhaustion marks scoring_failed
    - Test non-integer score marks scoring_failed
    - Test malformed gap analysis marks scoring_failed
    - _Requirements: 4.3, 4.8, 4.9_

- [ ] 7. Checkpoint - Verify scoring service
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Implement Dashboard UI - Core layout and posting list
  - [ ] 8.1 Set up React app with routing, React Query, and Firebase SDK
    - Configure Firebase SDK initialization in `packages/frontend/src/firebase.ts`
    - Set up React Query provider in app root
    - Install and configure Recharts for charting
    - Create main `DashboardPage` layout component
    - _Requirements: 5.1, 5.2 (foundation)_

  - [ ] 8.2 Implement posting sort and filter utility functions
    - Create `packages/frontend/src/utils/sortPostings.ts`
    - Implement `sortPostings()`: scored first by matchScore DESC (ties broken by ingestedAt DESC), then unscored by ingestedAt DESC
    - Create `packages/frontend/src/utils/filterPostings.ts`
    - Implement `filterPostings()` with AND logic: location substring (case-insensitive), tech stack (any match), work mode (any match); exclude postings with no location when location filter active
    - _Requirements: 5.1, 5.4, 6.2, 6.4, 6.6_

  - [ ]* 8.3 Write property test: Posting Sort Order Invariant
    - **Property 8: Posting Sort Order Invariant**
    - Generate posting lists with random scores and timestamps, some scored and some unscored
    - Assert: scored before unscored, scored ordered by matchScore DESC (ties by ingestedAt DESC), unscored by ingestedAt DESC
    - **Validates: Requirements 5.1, 5.4**

  - [ ]* 8.4 Write property test: Filter AND Logic Correctness
    - **Property 9: Filter AND Logic Correctness**
    - Generate random postings and random filter combinations
    - Assert: result contains exactly those postings satisfying ALL active filters; postings without location excluded when location filter active
    - **Validates: Requirements 6.2, 6.4, 6.6**

  - [ ] 8.5 Implement PostingList and PostingCard components
    - Create `packages/frontend/src/components/PostingList.tsx`
    - Create `packages/frontend/src/components/PostingCard.tsx`
    - Display: role title, company, location, Match_Score, work mode badge, up to 8 tech stack tags, Gap_Analysis bullets
    - Show message when no resume submitted indicating scoring unavailable
    - Subscribe to Firestore real-time updates via React Query + onSnapshot
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 8.6 Implement FilterPanel component
    - Create `packages/frontend/src/components/FilterPanel.tsx`
    - Location text input (max 100 chars)
    - Tech stack multi-select populated from available tags
    - Work mode checkboxes (remote, hybrid, onsite)
    - Trigger filter updates on change (no submit button), update within 1 second
    - Display "no results" message when filter yields zero matches
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [ ] 9. Implement Dashboard UI - Trends chart and resume input
  - [ ] 9.1 Implement skill frequency computation
    - Create `packages/frontend/src/utils/skillFrequencies.ts`
    - Implement `computeSkillFrequencies()`: count tech skills across all postings, return top 10 sorted by frequency DESC
    - Handle fewer than 10 skills by returning all available
    - _Requirements: 7.1, 7.4_

  - [ ]* 9.2 Write property test: Skill Frequency Top-N Computation
    - **Property 10: Skill Frequency Top-N Computation**
    - Generate posting lists with random tech stack arrays
    - Assert: at most 10 results, sorted by frequency DESC, each frequency equals actual count, no excluded skill has higher frequency than any included skill
    - **Validates: Requirements 7.1, 7.4**

  - [ ] 9.3 Implement TrendsChart component
    - Create `packages/frontend/src/components/TrendsChart.tsx`
    - Render bar chart using Recharts with skill name on x-axis, frequency on y-axis
    - Display "no data" message when no postings have extracted tech stack data
    - Update when new postings are ingested
    - _Requirements: 7.1, 7.2, 7.3, 7.5_

  - [ ] 9.4 Implement ResumeInput component
    - Create `packages/frontend/src/components/ResumeInput.tsx`
    - Text area with 10,000 character max length
    - Client-side validation: reject empty, whitespace-only, or < 50 non-whitespace chars
    - Display validation error messages
    - On submit: call scoring service callable function
    - Show loading indicator until scoring completes or 60s timeout
    - Display error message on timeout or service error with retry option
    - Update posting list with scores on completion without page reload
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 9.5 Write unit tests for dashboard components
    - Test sort without resume produces chronological order
    - Test empty filter results show "no results" message
    - Test trends chart empty state shows "no data" message
    - Test 60s timeout triggers error UI
    - Test loading indicator displays during scoring
    - _Requirements: 5.3, 6.5, 7.5, 8.2, 8.5_

- [ ] 10. Integration wiring and final verification
  - [ ] 10.1 Wire all Cloud Functions with Firebase triggers and HTTP endpoints
    - Register ingestion function (HTTP trigger for manual invocation)
    - Register extraction function (Firestore onCreate trigger on `postings`)
    - Register scoring function (HTTP callable)
    - Configure environment variables for API keys (Adzuna, OpenAI)
    - Verify function deployment configuration in `firebase.json`
    - _Requirements: 1.1, 3.1, 4.1_

  - [ ] 10.2 Connect frontend to Firestore real-time listeners
    - Implement Firestore query hooks using React Query for posting list
    - Set up real-time onSnapshot listeners for live updates
    - Handle offline state with cached data fallback
    - Verify composite index queries work (ranked listing, filtered queries)
    - _Requirements: 5.1, 5.4, 7.3, 8.4_

  - [ ]* 10.3 Write integration tests
    - Test end-to-end ingestion: mock Adzuna API → Firestore write
    - Test end-to-end extraction: mock OpenAI → structured fields stored
    - Test end-to-end scoring: resume submit → score → UI update
    - Test Firestore real-time listener receives new postings
    - _Requirements: 1.1, 3.1, 4.1, 5.1_

- [ ] 11. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major service
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout for type safety across frontend and backend
- Firebase environment variables must be configured before deployment (Adzuna API keys, OpenAI API key)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "2.2", "2.5"] },
    { "id": 3, "tasks": ["2.3", "2.4", "2.6"] },
    { "id": 4, "tasks": ["2.7"] },
    { "id": 5, "tasks": ["4.1", "6.1", "8.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "6.2", "6.3", "8.2"] },
    { "id": 7, "tasks": ["4.4", "6.4", "6.5", "8.3", "8.4"] },
    { "id": 8, "tasks": ["4.5", "6.6", "8.5", "8.6", "9.1"] },
    { "id": 9, "tasks": ["6.7", "9.2", "9.3", "9.4"] },
    { "id": 10, "tasks": ["9.5", "10.1"] },
    { "id": 11, "tasks": ["10.2"] },
    { "id": 12, "tasks": ["10.3"] }
  ]
}
```
