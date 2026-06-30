/**
 * Cloud Functions index — registers all Firebase triggers and HTTP endpoints.
 *
 * Functions:
 * - ingestPostings: HTTP trigger for manual invocation of the ingestion pipeline
 * - extractPosting: Firestore onCreate trigger on `postings` collection
 * - scoreResume: HTTP callable for resume submission and scoring
 * - autoScorePosting: Firestore onUpdate trigger for auto-scoring new extractions
 *
 * Requirements: 1.1, 3.1, 4.1
 */

import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { onPostingCreated } from './extraction/extractionService';
import { submitResume, onPostingExtracted } from './scoring/scoringService';
import { runIngestion } from './ingestion/ingestionService';

// Initialize Firebase Admin SDK (required for Firestore access)
if (!admin.apps.length) {
  admin.initializeApp();
}

// ─── Ingestion Service — HTTP trigger for manual invocation (Requirement 1.1) ───

/**
 * HTTP-triggered function for manually invoking the ingestion pipeline.
 * Reads Adzuna API credentials from environment variables.
 *
 * Environment variables required:
 * - ADZUNA_APP_ID: Adzuna API application ID
 * - ADZUNA_API_KEY: Adzuna API key
 * - OPENAI_API_KEY: OpenAI API key (used by extraction/scoring services)
 */
export const ingestPostings = onRequest(async (req, res) => {
  // Only allow POST requests for triggering ingestion
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  const appId = process.env.ADZUNA_APP_ID;
  const apiKey = process.env.ADZUNA_API_KEY;

  if (!appId || !apiKey) {
    logger.error('Missing required environment variables: ADZUNA_APP_ID, ADZUNA_API_KEY');
    res.status(500).json({
      error: 'Server configuration error: missing Adzuna API credentials.',
    });
    return;
  }

  try {
    logger.info('Ingestion triggered manually via HTTP endpoint.');

    const result = await runIngestion({
      adzuna: {
        appId,
        apiKey,
      },
    });

    logger.info('Ingestion completed.', result);
    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Ingestion failed:', message);
    res.status(500).json({
      success: false,
      error: message,
    });
  }
});

// ─── Extraction Service — Firestore onCreate trigger on `postings` (Requirement 3.1) ───

export const extractPosting = onPostingCreated;

// ─── Scoring Service — HTTP callable for resume submission (Requirement 4.1) ───

export const scoreResume = submitResume;

// ─── Scoring Service — auto-score new postings when extracted (Requirement 4.7) ───

export const autoScorePosting = onPostingExtracted;
