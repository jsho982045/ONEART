import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/supabase/env";

/**
 * Supabase with the service role key: bypasses row level security. Only for trusted server code that has
 * already checked who is asking (the Stripe webhook, signed download links). Never import from a client file.
 */
let client: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server");
  client ??= createClient(supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
