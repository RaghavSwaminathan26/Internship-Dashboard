import * as functions from 'firebase-functions';
import { onPostingCreated } from './extraction/extractionService';
import { submitResume, onPostingExtracted } from './scoring/scoringService';

export const helloWorld = functions.https.onRequest((_request, response) => {
  response.send('InternIQ Functions ready.');
});

// Extraction Service — triggers on new posting creation (Gen2 Firestore trigger)
export const extractPosting = onPostingCreated;

// Scoring Service — HTTP callable for resume submission (Gen2)
export const scoreResume = submitResume;

// Scoring Service — auto-score new postings when extracted and resume exists (Gen2)
export const autoScorePosting = onPostingExtracted;
