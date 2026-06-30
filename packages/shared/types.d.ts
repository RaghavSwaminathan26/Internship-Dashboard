/**
 * Shared TypeScript interfaces for InternIQ Dashboard.
 * Used by both frontend and functions packages.
 */
export interface FirestoreTimestamp {
    seconds: number;
    nanoseconds: number;
    toDate(): Date;
}
export type PostingSource = 'adzuna' | 'simplifyjobs';
export type PostingStatus = 'raw' | 'extracted' | 'extraction_failed' | 'scored' | 'scoring_failed' | 'needs_manual_review';
export type WorkMode = 'remote' | 'hybrid' | 'onsite';
export interface StructuredFields {
    roleTitle: string;
    company: string;
    location: string;
    techStack: string[];
    deadline: string | null;
    workMode: WorkMode;
    summary: string;
}
export interface PostingScore {
    matchScore: number;
    gapAnalysis: {
        matches: string;
        missing: string;
    };
    scoredAt: FirestoreTimestamp;
    resumeHash: string;
}
export interface PostingDocument {
    id: string;
    source: PostingSource;
    rawContent: string;
    ingestedAt: FirestoreTimestamp;
    status: PostingStatus;
    structured?: StructuredFields;
    scoring?: PostingScore;
}
export interface SessionDocument {
    id: string;
    resumeText: string;
    resumeHash: string;
    submittedAt: FirestoreTimestamp;
}
export interface ResumeInput {
    text: string;
    submittedAt: FirestoreTimestamp;
}
export interface FilterState {
    location: string;
    techStack: string[];
    workMode: WorkMode[];
}
export interface ParsedRow {
    company: string;
    role: string;
    location: string;
    applicationLink: string;
    datePosted: string;
}
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
export interface GapAnalysis {
    matches: string;
    missing: string;
}
export interface SkillFrequency {
    skill: string;
    count: number;
}
//# sourceMappingURL=types.d.ts.map