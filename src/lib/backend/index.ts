import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { LocalBackend } from "./local";
import { SupabaseBackend } from "./supabase";
import type { Backend } from "./types";

/**
 * Local test mode runs when Supabase isn't configured, or when NEXT_PUBLIC_ONEART_BACKEND=local
 * (so you can test the drawing experience even with keys in .env.local).
 */
export const isLocalMode =
  process.env.NEXT_PUBLIC_ONEART_BACKEND === "local" || !isSupabaseConfigured;

let backend: Backend | null = null;

export function getBackend(): Backend {
  backend ??= isLocalMode ? new LocalBackend() : new SupabaseBackend(getSupabaseBrowser());
  return backend;
}
