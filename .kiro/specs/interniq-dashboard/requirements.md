# Requirements Document

## Introduction

InternIQ is an internship intelligence dashboard that helps CS students find and evaluate tech internship postings. The system aggregates job data from external sources, extracts structured information using an LLM, scores each posting against the user's resume, and presents results in an interactive dashboard with filtering and trend visualization.

## Glossary

- **Ingestion_Service**: The backend component responsible for fetching and parsing internship postings from external data sources (Adzuna API, SimplifyJobs GitHub repo) and storing them in the database.
- **Extraction_Service**: The backend component that calls the OpenAI API to extract structured fields from raw internship postings.
- **Scoring_Service**: The backend component that compares a user's resume against internship postings using the OpenAI API to produce match scores and gap analysis.
- **Dashboard_UI**: The React frontend application that displays ranked postings, filters, and trend visualizations.
- **Posting**: A single internship job listing containing raw and structured data.
- **Structured_Fields**: The set of extracted fields for a posting: role title, company, location, tech stack required, application deadline, remote/hybrid/onsite classification, and a one-sentence summary.
- **Match_Score**: A numeric score from 1 to 10 indicating how well a posting aligns with the user's resume.
- **Gap_Analysis**: A two-bullet summary for each posting identifying what matches the user's resume and what skills or qualifications are missing.
- **Firestore**: Firebase Firestore, the NoSQL document database used to store raw and structured posting data.
- **Adzuna_API**: A third-party jobs API used as one source for internship postings.
- **SimplifyJobs_Repo**: The SimplifyJobs Summer 2026 internships GitHub repository containing a markdown table of internship postings.
- **Trends_Chart**: A visualization showing the frequency of tech skills across all ingested postings.

## Requirements

### Requirement 1: Ingest Postings from Adzuna API

**User Story:** As a CS student, I want the system to fetch internship postings from the Adzuna jobs API, so that I have access to a broad set of real-time tech internship opportunities.

#### Acceptance Criteria

1. WHEN the Ingestion_Service is triggered, THE Ingestion_Service SHALL fetch internship postings from the Adzuna_API filtered to technology and software categories, paginating through results until all available postings are retrieved or a maximum of 500 postings per ingestion run is reached.
2. WHEN the Adzuna_API returns posting data, THE Ingestion_Service SHALL store each raw posting as a document in Firestore using the Adzuna_API's posting identifier as the unique document identifier.
3. IF a posting with the same unique identifier already exists in Firestore, THEN THE Ingestion_Service SHALL skip the duplicate posting without creating a new document.
4. IF the Adzuna_API returns an error or is unreachable, THEN THE Ingestion_Service SHALL log the error with a timestamp and retry up to 3 times with exponential backoff starting at a 1-second base interval.
5. IF all 3 retry attempts fail, THEN THE Ingestion_Service SHALL log the final failure with a timestamp and report the ingestion run as failed without storing partial results.

### Requirement 2: Ingest Postings from SimplifyJobs GitHub Repository

**User Story:** As a CS student, I want the system to parse internship postings from the SimplifyJobs Summer 2026 GitHub repo, so that I have access to curated internship data from a trusted community source.

#### Acceptance Criteria

1. WHEN the Ingestion_Service is triggered, THE Ingestion_Service SHALL fetch the markdown file from the SimplifyJobs_Repo and parse each row of the internship table into a posting record.
2. WHEN the markdown table is parsed, THE Ingestion_Service SHALL store each raw posting as a document in Firestore with a unique identifier derived from company name and role title.
3. IF a posting with the same unique identifier already exists in Firestore, THEN THE Ingestion_Service SHALL skip the duplicate posting without creating a new document.
4. IF the SimplifyJobs_Repo is unreachable or the markdown content does not contain a recognizable table structure (defined as at least one header row followed by a separator row and at least one data row), THEN THE Ingestion_Service SHALL log the error with a timestamp and retry up to 3 times with exponential backoff starting at a 1-second base interval.
5. IF any individual markdown table row cannot be parsed into a valid posting record, THEN THE Ingestion_Service SHALL skip that row, log the error with the row content, and continue parsing remaining rows.
6. IF all 3 retry attempts fail, THEN THE Ingestion_Service SHALL log the final failure with a timestamp and report the ingestion run as failed.
7. FOR ALL valid markdown table rows, parsing then serializing back to a table row then parsing again SHALL produce an equivalent posting record (round-trip property).

### Requirement 3: Extract Structured Fields from Postings

**User Story:** As a CS student, I want structured information extracted from each posting, so that I can filter and compare internships on specific attributes like tech stack, location, and work mode.

#### Acceptance Criteria

1. WHEN a new raw posting is stored in Firestore, THE Extraction_Service SHALL send the posting content to the OpenAI API for structured field extraction within 30 seconds of storage.
2. WHEN the OpenAI API returns extracted data, THE Extraction_Service SHALL store the following Structured_Fields on the posting document: role title (string, max 200 characters), company (string, max 200 characters), location (string, max 200 characters), tech stack required (list of strings, max 30 items, each max 50 characters), application deadline (ISO 8601 date or null), remote/hybrid/onsite classification (one of "remote", "hybrid", or "onsite"), and one-sentence summary (string, max 200 characters).
3. WHEN the OpenAI API returns extracted data, THE Extraction_Service SHALL validate that each Structured_Field conforms to its expected type and constraints as defined in criterion 2; any string field exceeding its maximum length SHALL be truncated to the maximum.
4. IF the OpenAI API returns an error, times out, or returns a response that fails JSON parsing or is missing any of the required Structured_Fields, THEN THE Extraction_Service SHALL mark the posting status as "extraction_failed" and retry up to 3 times with exponential backoff starting at 2 seconds.
5. IF the extracted deadline field is not a valid ISO 8601 date or null, THEN THE Extraction_Service SHALL set the deadline to null and set the posting status to "needs_manual_review".
6. IF all 3 retry attempts for a failed extraction are exhausted, THEN THE Extraction_Service SHALL keep the posting status as "extraction_failed" and set the posting status to "needs_manual_review".

### Requirement 4: Score Postings Against User Resume

**User Story:** As a CS student, I want each posting scored against my resume, so that I can prioritize applications for the roles I am most qualified for.

#### Acceptance Criteria

1. WHEN a user submits plain-text resume content that is at most 10,000 characters in length, THE Scoring_Service SHALL accept and store the resume text associated with the user session.
2. WHEN a resume is submitted and postings with Structured_Fields exist, THE Scoring_Service SHALL score only postings that have not yet been scored against the current resume text.
3. WHEN the user submits resume text that is not character-for-character identical to the previously stored resume (after trimming leading and trailing whitespace), THE Scoring_Service SHALL invalidate all existing scores and re-score all postings against the new resume.
4. WHEN the OpenAI API returns scoring data, THE Scoring_Service SHALL store a Match_Score (integer from 1 to 10) for each posting.
5. WHEN the OpenAI API returns scoring data, THE Scoring_Service SHALL store a Gap_Analysis consisting of exactly two bullets (each no longer than 200 characters): one describing what matches and one describing what is missing for each posting.
6. THE Scoring_Service SHALL constrain the Match_Score to the integer range 1 to 10 inclusive; any value outside this range SHALL be clamped to the nearest boundary.
7. WHEN new postings are ingested after a resume has been submitted, THE Scoring_Service SHALL automatically score the new postings against the stored resume.
8. IF the OpenAI API returns an error during scoring, THEN THE Scoring_Service SHALL mark the posting as "scoring_failed" and retry up to 3 times with exponential backoff starting at 5 seconds before logging the error permanently.
9. IF the OpenAI API returns a successful response with a non-integer score or a Gap_Analysis that does not contain exactly two bullets, THEN THE Scoring_Service SHALL mark the posting as "scoring_failed" and log the malformed response for later retry.
10. IF the submitted resume text exceeds 10,000 characters, THEN THE Scoring_Service SHALL reject the submission and return a validation error indicating the maximum length has been exceeded.

### Requirement 5: Display Ranked Posting List

**User Story:** As a CS student, I want to see postings ranked by match score, so that I can quickly identify the best internship opportunities for my profile.

#### Acceptance Criteria

1. WHEN the Dashboard_UI loads with scored postings, THE Dashboard_UI SHALL display a list of postings sorted by Match_Score in descending order, using most recently ingested first as the secondary sort for postings with equal Match_Score.
2. THE Dashboard_UI SHALL display for each posting: role title, company, location, Match_Score, remote/hybrid/onsite badge, up to 8 tech stack tags, and Gap_Analysis bullets.
3. IF no resume has been submitted, THEN THE Dashboard_UI SHALL display postings in chronological order (most recently ingested first) and display a visible message stating that scoring is unavailable until a resume is submitted.
4. WHEN the Dashboard_UI loads with a mix of scored and unscored postings, THE Dashboard_UI SHALL display scored postings sorted by Match_Score first, followed by unscored postings sorted in chronological order (most recently ingested first).

### Requirement 6: Filter Postings

**User Story:** As a CS student, I want to filter postings by location, tech stack, and remote/hybrid/onsite mode, so that I can narrow results to opportunities that match my constraints.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL provide filter controls for location (text input with a maximum length of 100 characters), tech stack (multi-select from available tags), and work mode (checkboxes for remote, hybrid, onsite).
2. WHEN the user applies one or more filters, THE Dashboard_UI SHALL display only postings matching all active filter categories combined with AND logic, where: location matches case-insensitively if the posting's location field contains the filter text as a substring, tech stack matches if the posting contains at least one of the selected tags, and work mode matches if the posting's classification matches any of the checked options.
3. WHEN the user modifies any filter control, THE Dashboard_UI SHALL update the displayed postings within 1 second without requiring a separate submit action.
4. WHEN the user clears all filters, THE Dashboard_UI SHALL display the full list of postings in their default sorted order.
5. WHEN a filter combination results in zero matching postings, THE Dashboard_UI SHALL display a message indicating no postings match the current filters.
6. IF a posting has no location data, THEN THE Dashboard_UI SHALL exclude that posting from results when a location filter is active.

### Requirement 7: Display Tech Skills Trends Chart

**User Story:** As a CS student, I want to see which tech skills appear most frequently across postings, so that I can identify skills to prioritize in my learning.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL display a Trends_Chart showing the top 10 most frequently occurring tech skills across all ingested postings, sorted by frequency in descending order.
2. THE Dashboard_UI SHALL render the Trends_Chart using a bar chart visualization with the skill name on the x-axis and the frequency count on the y-axis.
3. WHEN new postings are ingested and extracted, THE Trends_Chart SHALL reflect the updated skill frequency counts.
4. WHEN fewer than 10 distinct tech skills exist across all postings, THE Trends_Chart SHALL display all available skills.
5. IF no postings with extracted tech stack data exist, THEN THE Dashboard_UI SHALL display a message in place of the Trends_Chart indicating that trend data is not yet available.

### Requirement 8: Resume Input

**User Story:** As a CS student, I want to paste my resume as plain text into the dashboard, so that the system can score postings against my qualifications.

#### Acceptance Criteria

1. THE Dashboard_UI SHALL provide a text area for the user to paste plain-text resume content with a maximum input length of 10,000 characters.
2. WHEN the user submits resume text, THE Dashboard_UI SHALL send the resume to the Scoring_Service and display a loading indicator until scoring completes or 60 seconds elapse, whichever comes first.
3. IF the submitted resume text is empty, contains only whitespace, or contains fewer than 50 non-whitespace characters, THEN THE Dashboard_UI SHALL display a validation error message indicating the resume must contain at least 50 non-whitespace characters and prevent submission.
4. WHEN scoring completes, THE Dashboard_UI SHALL update the posting list with Match_Scores and Gap_Analysis without requiring a page reload.
5. IF scoring does not complete within 60 seconds or the Scoring_Service returns an error, THEN THE Dashboard_UI SHALL dismiss the loading indicator and display an error message indicating that scoring failed and the user may retry.
