"use client";

import { useEffect, useRef } from "react";
import { getSupabaseBrowserClient } from "./supabaseClient";

/**
 * Subscribes to real-time PostgreSQL table changes via Supabase WebSocket (MS-05 Phase 3).
 * Gracefully degrades when offline or when Supabase client credentials are unavailable.
 */
export function useRealtimeTable(table: string, onUpdate: () => void): void {
  const savedCallback = useRef(onUpdate);
  useEffect(() => {
    savedCallback.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    const channel = supabase
      .channel(`realtime-${table}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          savedCallback.current();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [table]);
}
