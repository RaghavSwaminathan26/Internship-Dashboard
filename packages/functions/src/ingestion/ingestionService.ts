/**
 * Ingestion Service - Orchestrates fetching from all sources, deduplication,
 * and Firestore batch writes.
 *
 * Requirements: 1.2, 1.3, 2.2, 2.3
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { fetchAdzunaPostings, AdzunaConfig, RawAdzunaPosting } from './adzunaFetcher';
import { fetchSimplifyPostings, SimplifyFetcherConfig, RawSimplifyPosting } from './simplifyFetcher';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IngestionConfig {
  adzuna: AdzunaConfig;
  simplify?: SimplifyFetcherConfig;
}

export interface IngestionResult {
  totalFetched: number;
  duplicatesSkipped: number;
  newPostingsStored: number;
  errors: string[];
}

/** A raw posting from either source, normalized for storage */
interface NormalizedPosting {
  id: string;
  source: 'adzuna' | 'simplifyjobs';
  rawContent: string;
  status: 'raw';
  ingestedAt: Timestamp;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const POSTINGS_COLLECTION = 'postings';
const BATCH_SIZE = 500; // Firestore batch limit

// ─── Main Orchestrator ──────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline:
 * 1. Fetch postings from both sources (independently, one failure doesn't block the other)
 * 2. Deduplicate against existing Firestore documents
 * 3. Write new postings in batches
 * 4. Return a summary of results
 *
 * @param config - Configuration for both fetchers
 * @param db - Firestore instance (injectable for testing)
 * @returns Summary of the ingestion run
 */
export async function runIngestion(
  config: IngestionConfig,
  db: admin.firestore.Firestore = admin.firestore()
): Promise<IngestionResult> {
  const result: IngestionResult = {
    totalFetched: 0,
    duplicatesSkipped: 0,
    newPostingsStored: 0,
    errors: [],
  };

  // Step 1: Fetch from both sources independently
  const allPostings: NormalizedPosting[] = [];

  // Fetch Adzuna postings
  const adzunaPostings = await fetchFromAdzuna(config.adzuna);
  if (adzunaPostings.error) {
    result.errors.push(adzunaPostings.error);
    console.error(`[${new Date().toISOString()}] Adzuna ingestion failed: ${adzunaPostings.error}`);
  } else {
    allPostings.push(...adzunaPostings.postings);
  }

  // Fetch SimplifyJobs postings
  const simplifyPostings = await fetchFromSimplify(config.simplify);
  if (simplifyPostings.error) {
    result.errors.push(simplifyPostings.error);
    console.error(`[${new Date().toISOString()}] SimplifyJobs ingestion failed: ${simplifyPostings.error}`);
  } else {
    allPostings.push(...simplifyPostings.postings);
  }

  result.totalFetched = allPostings.length;

  if (allPostings.length === 0) {
    console.log(`[${new Date().toISOString()}] Ingestion complete: no postings fetched.`);
    return result;
  }

  // Step 2: Deduplicate against existing documents
  const existingIds = await getExistingPostingIds(
    db,
    allPostings.map((p) => p.id)
  );

  const newPostings = allPostings.filter((p) => !existingIds.has(p.id));
  result.duplicatesSkipped = allPostings.length - newPostings.length;

  // Step 3: Write new postings in batches
  if (newPostings.length > 0) {
    await writePostingsInBatches(db, newPostings);
    result.newPostingsStored = newPostings.length;
  }

  // Step 4: Log summary
  console.log(
    `[${new Date().toISOString()}] Ingestion complete: ` +
      `${result.totalFetched} fetched, ` +
      `${result.duplicatesSkipped} duplicates skipped, ` +
      `${result.newPostingsStored} new postings stored.` +
      (result.errors.length > 0 ? ` Errors: ${result.errors.length}` : '')
  );

  return result;
}

// ─── Source Fetchers (with error isolation) ─────────────────────────────────

interface FetchResult {
  postings: NormalizedPosting[];
  error?: string;
}

/**
 * Fetch from Adzuna, catching errors so one source failure doesn't block the other.
 */
async function fetchFromAdzuna(config: AdzunaConfig): Promise<FetchResult> {
  try {
    const rawPostings: RawAdzunaPosting[] = await fetchAdzunaPostings(config);
    const normalized: NormalizedPosting[] = rawPostings.map((p) => ({
      id: p.id,
      source: 'adzuna' as const,
      rawContent: p.rawContent,
      status: 'raw' as const,
      ingestedAt: Timestamp.now(),
    }));
    return { postings: normalized };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { postings: [], error: `Adzuna: ${message}` };
  }
}

/**
 * Fetch from SimplifyJobs, catching errors so one source failure doesn't block the other.
 */
async function fetchFromSimplify(config: SimplifyFetcherConfig = {}): Promise<FetchResult> {
  try {
    const rawPostings: RawSimplifyPosting[] = await fetchSimplifyPostings(config);
    const normalized: NormalizedPosting[] = rawPostings.map((p) => ({
      id: p.id,
      source: 'simplifyjobs' as const,
      rawContent: p.rawContent,
      status: 'raw' as const,
      ingestedAt: Timestamp.now(),
    }));
    return { postings: normalized };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { postings: [], error: `SimplifyJobs: ${message}` };
  }
}

// ─── Firestore Helpers ──────────────────────────────────────────────────────

/**
 * Check which posting IDs already exist in Firestore.
 * Uses batched getAll() for efficiency.
 *
 * @param db - Firestore instance
 * @param ids - Array of posting IDs to check
 * @returns Set of IDs that already exist
 */
async function getExistingPostingIds(
  db: admin.firestore.Firestore,
  ids: string[]
): Promise<Set<string>> {
  const existingIds = new Set<string>();

  if (ids.length === 0) {
    return existingIds;
  }

  // Firestore getAll supports up to 500 document references per call
  const chunks = chunkArray(ids, BATCH_SIZE);

  for (const chunk of chunks) {
    const docRefs = chunk.map((id) => db.collection(POSTINGS_COLLECTION).doc(id));
    const snapshots = await db.getAll(...docRefs);

    for (const snapshot of snapshots) {
      if (snapshot.exists) {
        existingIds.add(snapshot.id);
      }
    }
  }

  return existingIds;
}

/**
 * Write postings to Firestore using batch writes for efficiency.
 * Firestore batches are limited to 500 operations each.
 *
 * @param db - Firestore instance
 * @param postings - Array of normalized postings to write
 */
async function writePostingsInBatches(
  db: admin.firestore.Firestore,
  postings: NormalizedPosting[]
): Promise<void> {
  const chunks = chunkArray(postings, BATCH_SIZE);

  for (const chunk of chunks) {
    const batch = db.batch();

    for (const posting of chunk) {
      const docRef = db.collection(POSTINGS_COLLECTION).doc(posting.id);
      batch.set(docRef, {
        id: posting.id,
        source: posting.source,
        rawContent: posting.rawContent,
        status: posting.status,
        ingestedAt: posting.ingestedAt,
      });
    }

    await batch.commit();
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Split an array into chunks of the specified size.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
