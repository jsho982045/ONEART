import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/config/env";
import type { Database } from "@/types/database.types";

/**
 * Supabase client for Server Components, Route Handlers, and Server Actions.
 *
 * A fresh instance is created per request because it is bound to that request's
 * cookies. In a plain Server Component the `setAll` write is a no-op (cookies
 * are read-only there) — session refresh happens in middleware instead.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component, where cookies cannot be written.
            // Safe to ignore: `updateSession` in middleware keeps the session
            // cookie fresh on every request.
          }
        },
      },
    },
  );
}
