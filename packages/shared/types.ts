/**
 * Shared TypeScript interfaces for InternIQ Dashboard.
 * Used by both frontend and functions packages.
 */

// ─── Firestore Timestamp placeholder ────────────────────────────────────────
// Firebase Timestamp type - kept as an interface to avoid a hard dependency on firebase-admin
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate(): Date;
}

// ─── Posting Source ─────────────────────────────────────────────────────────
export type PostingSource = 'adzuna' | 'simplifyjobs';

// ─── Processing Status ──────────────────────────────────────────────────────
export type PostingStatus =
  | 'raw'
  | 'extracted'
  | 'extraction_failed'
  | 'scored'
  | 'scoring_failed'
  | 'needs_manual_review';

// ─── Work Mode ──────────────────────────────────────────────────────────────
export type WorkMode = 'remote' | 'hybrid' | 'onsite';

// ─── Structured Fields (populated after extraction) ─────────────────────────
export interface StructuredFields {
  roleTitle: string;         // max 200 chars
  company: string;           // max 200 chars
  location: string;          // max 200 chars
  techStack: string[];       // max 30 items, each max 50 chars
  deadline: string | null;   // ISO 8601 date or null
  workMode: WorkMode;
  summary: string;           // max 200 chars
}

// ─── Posting Score (populated after scoring) ────────────────────────────────
export interface PostingScore {
  matchScore: number;        // integer 1-10
  gapAnalysis: {
    matches: string;         // max 200 chars
    missing: string;         // max 200 chars
  };
  scoredAt: FirestoreTimestamp;
  resumeHash: string;        // SHA-256 hash of resume used for scoring
}


// ─── Posting Document (Firestore `postings` collection) ─────────────────────
export interface PostingDocument {
  id: string;                         // Adzuna ID or `${company}-${role}` hash
  source: PostingSource;
  rawContent: string;
  ingestedAt: FirestoreTimestamp;
  status: PostingStatus;
  structured?: StructuredFields;
  scoring?: PostingScore;
}

// ─── Session Document (Firestore `sessions` collection) ─────────────────────
export interface SessionDocument {
  id: string;                         // auto-generated
  resumeText: string;                 // max 10,000 chars
  resumeHash: string;                 // SHA-256 of trimmed text
  submittedAt: FirestoreTimestamp;
}

// ─── Resume Input ───────────────────────────────────────────────────────────
export interface ResumeInput {
  text: string;              // max 10,000 chars, min 50 non-whitespace chars
  submittedAt: FirestoreTimestamp;
}

// ─── Filter State (Dashboard UI) ───────────────────────────────────────────
export interface FilterState {
  location: string;          // max 100 chars
  techStack: string[];       // selected tech tags
  workMode: WorkMode[];      // selected work mode filters
}

// ─── Parsed Row (SimplifyJobs markdown table) ───────────────────────────────
export interface ParsedRow {
  company: string;
  role: string;
  location: string;
  applicationLink: string;
  datePosted: string;
}

// ─── Validation Result ──────────────────────────────────────────────────────
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ─── Gap Analysis ───────────────────────────────────────────────────────────
export interface GapAnalysis {
  matches: string;           // max 200 chars
  missing: string;           // max 200 chars
}

// ─── Skill Frequency (Trends chart) ────────────────────────────────────────
export interface SkillFrequency {
  skill: string;
  count: number;
}
