/**
 * Extraction Service — Firestore onCreate trigger.
 * Sends raw posting content to Groq with JSON schema instructions,
 * validates the response, and writes structured fields back to the posting document.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import * as admin from 'firebase-admin';
import Groq from 'groq-sdk';
import { RETRY_CONFIG } from '@interniq/shared/constants';
import { StructuredFields } from '@interniq/shared/types';
import { validateAndTruncateFields, validateDeadline } from './fieldValidation';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const retryConfig = RETRY_CONFIG.extraction;

/**
 * System prompt that instructs the model to return valid JSON
 * matching the extraction schema.
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a data extraction assistant. Extract structured fields from internship posting text.
If a field is not present in the text, use reasonable defaults: empty string for text fields, empty array for techStack, null for deadline, and "onsite" for workMode.

You MUST respond with ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "roleTitle": "string - The job/role title",
  "company": "string - The company name",
  "location": "string - The job location",
  "techStack": ["string array - List of required technologies and skills"],
  "deadline": "string (YYYY-MM-DD) or null - Application deadline in ISO 8601 date format, or null if not specified",
  "workMode": "remote" | "hybrid" | "onsite",
  "summary": "string - A one-sentence summary of the posting"
}

All fields are required. workMode must be one of: "remote", "hybrid", "onsite".`;

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
 * Calls Groq chat completions with JSON schema instructions.
 * Returns the parsed structured fields object.
 * Throws on API error, timeout, or invalid response.
 */
async function callGroqExtraction(rawContent: string): Promise<unknown> {
  const response = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [
      {
        role: 'system',
        content: EXTRACTION_SYSTEM_PROMPT,
      },
      {
        role: 'user',
        content: rawContent,
      },
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Groq returned empty response content');
  }

  // Parse JSON — will throw if invalid
  const parsed: unknown = JSON.parse(content);
  return parsed;
}

/**
 * Firestore onCreate trigger for the `postings` collection.
 * Extracts structured fields from raw posting content using Groq.
 */
export const onPostingCreated = onDocumentCreated(
  'postings/{postingId}',
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
      logger.warn('onPostingCreated triggered with no data.');
      return;
    }

    const postingId = event.params.postingId;
    const data = snapshot.data();
    const rawContent = data?.rawContent as string | undefined;

    if (!rawContent) {
      logger.warn(`Posting ${postingId} has no rawContent, skipping extraction.`);
      return;
    }

    const db = admin.firestore();
    const postingRef = db.collection('postings').doc(postingId);

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        // Call Groq for extraction
        const rawResponse = await callGroqExtraction(rawContent);

        // Validate and truncate fields (Requirement 3.3)
        const structuredFields: StructuredFields = validateAndTruncateFields(rawResponse);

        // Check if deadline is valid (Requirement 3.5)
        const deadlineValid = structuredFields.deadline === null ||
          validateDeadline(structuredFields.deadline) !== null;

        if (!deadlineValid) {
          // Invalid deadline — set to null and mark needs_manual_review
          structuredFields.deadline = null;
          await postingRef.update({
            structured: structuredFields,
            status: 'needs_manual_review',
          });
          logger.info(
            `Posting ${postingId}: extracted with invalid deadline, marked needs_manual_review.`
          );
          return;
        }

        // Successful extraction — write structured fields and update status
        await postingRef.update({
          structured: structuredFields,
          status: 'extracted',
        });
        logger.info(`Posting ${postingId}: extraction successful on attempt ${attempt}.`);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.error(
          `Posting ${postingId}: extraction attempt ${attempt}/${retryConfig.maxRetries} failed: ${lastError.message}`
        );

        // If we haven't exhausted retries, wait with exponential backoff
        if (attempt < retryConfig.maxRetries) {
          const delay = getBackoffDelay(attempt);
          await sleep(delay);
        }
      }
    }

    // All retries exhausted (Requirement 3.6)
    logger.error(
      `Posting ${postingId}: all ${retryConfig.maxRetries} extraction retries exhausted. Last error: ${lastError?.message}`
    );
    await postingRef.update({
      status: 'extraction_failed',
      needs_manual_review: true,
    });
  }
);
