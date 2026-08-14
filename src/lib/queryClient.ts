import { QueryClient } from "@tanstack/react-query";

// Tuned for phones on flaky market networks:
//  * queries retry 3x with backoff
//  * refetch on focus keeps screens fresh alongside realtime invalidation
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 15000),
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 2,
      retryDelay: 1500,
    },
  },
});
