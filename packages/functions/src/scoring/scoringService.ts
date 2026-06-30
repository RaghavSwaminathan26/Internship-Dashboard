/**
 * Scoring Service — HTTP callable function.
 * Accepts resume text, stores it with SHA-256 hash, detects resume changes,
 * scores postings against the resume using OpenAI, and writes results to Firestore.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { RETRY_CONFIG } from '@interniq/shared/constants';
import { StructuredFields } from '@interniq/shared/types';
import { validateResumeInput } from './resumeValidation';
import { validateScoringResponse } from './scoreValidation';

const openai = new OpenAI();

const retryConfig = RETRY_CONFIG.scoring;

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Sleeps for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Computes exponential backoff delay: baseInterval * 2^(attempt - 1),
 * capped at maxDelay.
 */
function getBackoffDelay(attempt: number): number {
  const delay = retryConfig.baseIntervalMs * Math.pow(2, attempt - 1);
  return Math.min(delay, retryConfig.maxDelayMs);
}

/**
 * Computes SHA-256 hash of the given text.
 */
function computeResumeHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

// ─── OpenAI Scoring Schema ──────────────────────────────────────────────────

const SCORING_SCHEMA = {
  name: 'posting_scoring',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      matchScore: {
        type: 'number' as const,
        description: 'Integer score from 1 to 10 indicating how well the candidate matches the posting',
      },
      gapAnalysis: {
        type: 'object' as const,
        properties: {
          matches: {
            type: 'string' as const,
            description: 'What in the resume matches this posting (max 200 chars)',
          },
          missing: {
            type: 'string' as const,
            description: 'What skills or qualifications are missing (max 200 chars)',
          },
        },
        required: ['matches', 'missing'],
        additionalProperties: false,
      },
    },
    required: ['matchScore', 'gapAnalysis'],
    additionalProperties: false,
  },
} as const;

// ─── OpenAI Call ────────────────────────────────────────────────────────────

/**
 * Calls OpenAI to score a posting against a resume.
 * Returns the raw parsed response object.
 */
async function callOpenAIScoring(
  resumeText: string,
  structured: StructuredFields
): Promise<unknown> {
  const postingContext = [
    `Role: ${structured.roleTitle}`,
    `Company: ${structured.company}`,
    `Location: ${structured.location}`,
    `Work Mode: ${structured.workMode}`,
    `Tech Stack: ${structured.techStack.join(', ')}`,
    `Summary: ${structured.summary}`,
    structured.deadline ? `Deadline: ${structured.deadline}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'You are a resume-to-job matching assistant. Given a resume and a job posting, ' +
          'evaluate how well the candidate matches the role. Provide a matchScore (integer 1-10) ' +
          'and a gapAnalysis with two fields: "matches" (what skills/experience align, max 200 chars) ' +
          'and "missing" (what is lacking, max 200 chars).',
      },
      {
        role: 'user',
        content: `RESUME:\n${resumeText}\n\nJOB POSTING:\n${postingContext}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: SCORING_SCHEMA,
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI returned empty response content');
  }

  const parsed: unknown = JSON.parse(content);
  return parsed;
}

// ─── Score a Single Posting ─────────────────────────────────────────────────

/**
 * Scores a single posting against the resume with retry logic.
 * On success, writes matchScore, gapAnalysis, scoredAt, resumeHash to posting.
 * On failure after retries, marks posting as 'scoring_failed'.
 */
async function scorePosting(
  postingId: string,
  structured: StructuredFields,
  resumeText: string,
  resumeHash: string
): Promise<void> {
  const db = admin.firestore();
  const postingRef = db.collection('postings').doc(postingId);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const rawResponse = await callOpenAIScoring(resumeText, structured);

      const validation = validateScoringResponse(rawResponse);

      if (!validation.valid || !validation.score || !validation.gapAnalysis) {
        // Malformed response — treat as failure (Requirement 4.9)
        logger.error(
          `Posting ${postingId}: scoring response validation failed on attempt ${attempt}. ` +
            `Raw response: ${JSON.stringify(rawResponse)}`
        );
        throw new Error('Scoring response validation failed');
      }

      // Write scoring data to posting document
      await postingRef.update({
        scoring: {
          matchScore: validation.score,
          gapAnalysis: validation.gapAnalysis,
          scoredAt: admin.firestore.FieldValue.serverTimestamp(),
          resumeHash,
        },
        status: 'scored',
      });

      logger.info(`Posting ${postingId}: scoring successful on attempt ${attempt}.`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error(
        `Posting ${postingId}: scoring attempt ${attempt}/${retryConfig.maxRetries} failed: ${lastError.message}`
      );

      if (attempt < retryConfig.maxRetries) {
        const delay = getBackoffDelay(attempt);
        await sleep(delay);
      }
    }
  }

  // All retries exhausted (Requirement 4.8)
  logger.error(
    `Posting ${postingId}: all ${retryConfig.maxRetries} scoring retries exhausted. Last error: ${lastError?.message}`
  );
  await postingRef.update({
    status: 'scoring_failed',
  });
}

// ─── HTTP Callable: Submit Resume ───────────────────────────────────────────

/**
 * HTTP callable function for resume submission.
 * Validates input, stores resume with hash, detects changes, and scores postings.
 */
export const submitResume = onCall(async (request) => {
  const { text } = request.data as { text?: string };

  if (typeof text !== 'string') {
    throw new HttpsError('invalid-argument', 'Resume text must be a string.');
  }

  // Validate resume input (Requirement 4.1, 4.10)
  const validation = validateResumeInput(text);
  if (!validation.valid) {
    throw new HttpsError('invalid-argument', validation.errors.join('; '));
  }

  const trimmedText = text.trim();
  const resumeHash = computeResumeHash(trimmedText);

  const db = admin.firestore();
  const sessionsRef = db.collection('sessions');

  // Check if resume hash has changed from the stored session (Requirement 4.3)
  const existingSessionsSnapshot = await sessionsRef
    .orderBy('submittedAt', 'desc')
    .limit(1)
    .get();

  let resumeChanged = true;

  if (!existingSessionsSnapshot.empty) {
    const existingSession = existingSessionsSnapshot.docs[0];
    const existingHash = existingSession?.data().resumeHash as string | undefined;

    if (existingHash === resumeHash) {
      resumeChanged = false;
    }
  }

  // Store new session document (Requirement 4.1)
  await sessionsRef.add({
    resumeText: trimmedText,
    resumeHash,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Get postings to score
  let postingsToScore: admin.firestore.QuerySnapshot;

  if (resumeChanged) {
    // Resume changed — invalidate existing scores and re-score all extracted postings (Requirement 4.3)
    logger.info('Resume changed. Invalidating all existing scores and re-scoring.');

    // Get all scored postings and reset their scoring data
    const scoredPostings = await db
      .collection('postings')
      .where('status', '==', 'scored')
      .get();

    const batch = db.batch();
    scoredPostings.docs.forEach((doc) => {
      batch.update(doc.ref, {
        scoring: admin.firestore.FieldValue.delete(),
        status: 'extracted',
      });
    });

    // Also reset scoring_failed postings
    const failedPostings = await db
      .collection('postings')
      .where('status', '==', 'scoring_failed')
      .get();

    failedPostings.docs.forEach((doc) => {
      batch.update(doc.ref, {
        scoring: admin.firestore.FieldValue.delete(),
        status: 'extracted',
      });
    });

    await batch.commit();

    // Score all extracted postings
    postingsToScore = await db
      .collection('postings')
      .where('status', '==', 'extracted')
      .get();
  } else {
    // Resume same — score only unscored postings with extracted status (Requirement 4.2)
    logger.info('Resume unchanged. Scoring only unscored postings.');
    postingsToScore = await db
      .collection('postings')
      .where('status', '==', 'extracted')
      .get();
  }

  // Score each posting
  let scoredCount = 0;
  let failedCount = 0;

  for (const doc of postingsToScore.docs) {
    const data = doc.data();
    const structured = data.structured as StructuredFields | undefined;

    if (!structured) {
      logger.warn(`Posting ${doc.id}: no structured data, skipping scoring.`);
      continue;
    }

    await scorePosting(doc.id, structured, trimmedText, resumeHash);

    // Check result
    const updatedDoc = await doc.ref.get();
    const updatedStatus = updatedDoc.data()?.status;
    if (updatedStatus === 'scored') {
      scoredCount++;
    } else {
      failedCount++;
    }
  }

  logger.info(
    `Scoring complete. Scored: ${scoredCount}, Failed: ${failedCount}, Total: ${postingsToScore.size}`
  );

  return {
    success: true,
    scoredCount,
    failedCount,
    totalPostings: postingsToScore.size,
  };
});

// ─── Firestore Trigger: Score New Postings Automatically ────────────────────

/**
 * When a posting is updated to 'extracted' status, automatically score it
 * if a resume session exists. (Requirement 4.7)
 */
export const onPostingExtracted = onDocumentUpdated(
  'postings/{postingId}',
  async (event) => {
    const beforeData = event.data?.before.data();
    const afterData = event.data?.after.data();

    if (!beforeData || !afterData) {
      return;
    }

    // Only trigger when status changes to 'extracted'
    if (beforeData.status === afterData.status || afterData.status !== 'extracted') {
      return;
    }

    const structured = afterData.structured as StructuredFields | undefined;
    if (!structured) {
      return;
    }

    // Check if a resume session exists
    const db = admin.firestore();
    const sessionsSnapshot = await db
      .collection('sessions')
      .orderBy('submittedAt', 'desc')
      .limit(1)
      .get();

    if (sessionsSnapshot.empty) {
      // No resume submitted yet — nothing to score against
      return;
    }

    const session = sessionsSnapshot.docs[0];
    const resumeText = session?.data().resumeText as string;
    const resumeHash = session?.data().resumeHash as string;

    if (!resumeText || !resumeHash) {
      return;
    }

    const postingId = event.params.postingId;
    logger.info(`Posting ${postingId}: auto-scoring against stored resume.`);

    await scorePosting(postingId, structured, resumeText, resumeHash);
  }
);
