"use client";

import { useEffect, useId, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Total marks placed so far, updating live over Supabase Realtime. */
export function LiveCount({ initial = 0 }: { initial?: number }) {
  const [count, setCount] = useState(initial);
  const channelId = useId();

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseBrowser();
    let active = true;

    supabase
      .from("canvas_meta")
      .select("total_clicks")
      .eq("id", 1)
      .single()
      .then(({ data }) => {
        if (active && data) setCount(Number(data.total_clicks));
      });

    const channel = supabase
      .channel(`canvas-meta-${channelId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "canvas_meta" },
        (payload) => {
          const next = (payload.new as { total_clicks?: number | string }).total_clicks;
          if (next !== undefined) setCount(Number(next));
        },
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  return <span className="tabular-nums">{count.toLocaleString("en-US")}</span>;
}
