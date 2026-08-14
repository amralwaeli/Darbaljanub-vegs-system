import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

/**
 * Subscribe to postgres_changes on the given tables and invalidate the given
 * query keys on any event. RLS filters events server-side, so each role only
 * ever receives changes for rows it may SELECT.
 */
export function useRealtimeInvalidate(
  channelName: string,
  tables: string[],
  queryKeys: readonly (readonly unknown[])[],
) {
  const queryClient = useQueryClient();
  const tablesKey = tables.join(",");
  const keysKey = JSON.stringify(queryKeys);

  useEffect(() => {
    const channel = supabase.channel(channelName);
    for (const table of tablesKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          for (const key of JSON.parse(keysKey) as unknown[][]) {
            void queryClient.invalidateQueries({ queryKey: key });
          }
        },
      );
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelName, tablesKey, keysKey, queryClient]);
}
