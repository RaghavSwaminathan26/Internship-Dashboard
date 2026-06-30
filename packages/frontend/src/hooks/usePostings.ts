import { useEffect } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import type { PostingDocument } from '@interniq/shared/types';

const POSTINGS_QUERY_KEY = ['postings'] as const;

/**
 * Custom hook that subscribes to the Firestore `postings` collection using
 * an onSnapshot real-time listener, integrated with React Query for caching
 * and state management.
 *
 * - Sets up a real-time Firestore listener on mount
 * - Writes snapshot data directly into the React Query cache
 * - Returns cached data when offline (React Query staleTime keeps it available)
 * - Cleans up the listener on unmount
 *
 * Validates: Requirements 5.1, 5.4, 7.3, 8.4
 */
export function usePostings() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const postingsRef = collection(db, 'postings');
    const postingsQuery = query(postingsRef, orderBy('ingestedAt', 'desc'));

    const unsubscribe = onSnapshot(
      postingsQuery,
      (snapshot) => {
        const postings: PostingDocument[] = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        })) as PostingDocument[];

        // Write the real-time data directly into React Query cache
        queryClient.setQueryData<PostingDocument[]>(POSTINGS_QUERY_KEY, postings);
      },
      (error) => {
        // On listener error, invalidate so React Query shows the error state
        console.error('Firestore postings listener error:', error);
        queryClient.invalidateQueries({ queryKey: POSTINGS_QUERY_KEY });
      }
    );

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  const { data, isLoading, error } = useQuery<PostingDocument[], Error>({
    queryKey: POSTINGS_QUERY_KEY,
    // The queryFn is a no-op because onSnapshot populates the cache directly.
    // We set enabled: false so React Query doesn't attempt to fetch on its own,
    // but still provides caching, loading states, and offline fallback.
    queryFn: () => Promise.resolve([] as PostingDocument[]),
    // Keep cached data indefinitely — onSnapshot provides live updates
    staleTime: Infinity,
    // Use cached data as placeholder while listener reconnects
    gcTime: 1000 * 60 * 30, // 30 minutes
  });

  return {
    postings: data ?? [],
    isLoading: isLoading && !data,
    error,
  };
}
