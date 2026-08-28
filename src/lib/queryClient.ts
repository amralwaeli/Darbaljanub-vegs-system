import { QueryClient } from "@tanstack/react-query";

// Tuned for phones on flaky market networks — and for a database that is a
// long way away. Measured round-trip to this project (eu/me client -> Supabase
// in ap-northeast-2, Seoul) is 800ms-1.4s for a single-row select, so the
// budget here is round TRIPS, not bytes.
//
//  * retry 2, backoff capped at 3s. The old 3 retries capped at 15s meant a
//    query that was going to fail sat behind a skeleton for ~7s first, which
//    is indistinguishable from a frozen app on a phone.
//  * staleTime 60s. At 15s, simply switching tabs re-fetched everything and
//    paid the full latency again for data that had not changed.
//  * realtime invalidation (useRealtimeInvalidate) is what keeps screens
//    genuinely fresh; the poll-on-focus behaviour is a backstop, not the
//    mechanism, so it can afford to be lazy.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 3000),
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 2,
      retryDelay: 1500,
    },
  },
});
