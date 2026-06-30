/**
 * Shared constants for InternIQ Dashboard.
 * Field constraints, retry configurations, and status enums.
 */
export declare const FIELD_CONSTRAINTS: {
    readonly roleTitle: {
        readonly maxLength: 200;
    };
    readonly company: {
        readonly maxLength: 200;
    };
    readonly location: {
        readonly maxLength: 200;
    };
    readonly techStack: {
        readonly maxItems: 30;
        readonly itemMaxLength: 50;
    };
    readonly deadline: {
        readonly format: "iso8601-date-or-null";
    };
    readonly workMode: {
        readonly enum: readonly ["remote", "hybrid", "onsite"];
    };
    readonly summary: {
        readonly maxLength: 200;
    };
};
export declare const RESUME_CONSTRAINTS: {
    readonly maxLength: 10000;
    readonly minNonWhitespaceChars: 50;
};
export declare const GAP_ANALYSIS_CONSTRAINTS: {
    readonly maxBulletLength: 200;
    readonly requiredBullets: 2;
};
export declare const SCORE_CONSTRAINTS: {
    readonly min: 1;
    readonly max: 10;
};
export declare const FILTER_CONSTRAINTS: {
    readonly locationMaxLength: 100;
};
export declare const INGESTION_CONSTRAINTS: {
    readonly maxPostingsPerRun: 500;
};
export interface RetryConfig {
    maxRetries: number;
    baseIntervalMs: number;
    maxDelayMs: number;
}
export declare const RETRY_CONFIG: {
    readonly ingestionAdzuna: {
        maxRetries: number;
        baseIntervalMs: number;
        maxDelayMs: number;
    };
    readonly ingestionSimplify: {
        maxRetries: number;
        baseIntervalMs: number;
        maxDelayMs: number;
    };
    readonly extraction: {
        maxRetries: number;
        baseIntervalMs: number;
        maxDelayMs: number;
    };
    readonly scoring: {
        maxRetries: number;
        baseIntervalMs: number;
        maxDelayMs: number;
    };
};
export declare const POSTING_STATUS: {
    readonly RAW: "raw";
    readonly EXTRACTED: "extracted";
    readonly EXTRACTION_FAILED: "extraction_failed";
    readonly SCORED: "scored";
    readonly SCORING_FAILED: "scoring_failed";
    readonly NEEDS_MANUAL_REVIEW: "needs_manual_review";
};
export type PostingStatusValue = (typeof POSTING_STATUS)[keyof typeof POSTING_STATUS];
export declare const POSTING_SOURCES: {
    readonly ADZUNA: "adzuna";
    readonly SIMPLIFYJOBS: "simplifyjobs";
};
export type PostingSourceValue = (typeof POSTING_SOURCES)[keyof typeof POSTING_SOURCES];
export declare const WORK_MODES: {
    readonly REMOTE: "remote";
    readonly HYBRID: "hybrid";
    readonly ONSITE: "onsite";
};
export type WorkModeValue = (typeof WORK_MODES)[keyof typeof WORK_MODES];
export declare const SCORING_TIMEOUT_MS = 60000;
export declare const TRENDS_TOP_N = 10;
//# sourceMappingURL=constants.d.ts.map