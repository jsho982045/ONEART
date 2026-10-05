import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./env";

let client: SupabaseClient | undefined;

/** Browser-side Supabase client (singleton). Only call from effects and event handlers. */
export function getSupabaseBrowser(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured. Fill in .env.local (see README).");
  }
  client ??= createBrowserClient(supabaseUrl!, supabaseAnonKey!);
  return client;
}
