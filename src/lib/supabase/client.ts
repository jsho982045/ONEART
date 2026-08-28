import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/config/env";
import type { Database } from "@/types/database.types";

/**
 * Supabase client for use in Client Components ("use client").
 *
 * Uses the publishable/anon key — safe for the browser; Row Level Security is
 * what actually enforces access. Never import this from a Server Component;
 * use `@/lib/supabase/server` there.
 */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
  );
}
