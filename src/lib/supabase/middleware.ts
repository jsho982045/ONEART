import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { publicEnv } from "@/lib/config/env";
import type { Database } from "@/types/database.types";

/**
 * Refreshes the Supabase auth session on every request and forwards the updated
 * auth cookies to both the outgoing response and the (rewritten) request.
 *
 * Must be called from the root `middleware.ts`. Without it, Server Components
 * can end up reading a stale/expired session.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser(). A simple mistake
  // here can make it very hard to debug random logouts.
  // getUser() revalidates the token against the Auth server.
  await supabase.auth.getUser();

  return supabaseResponse;
}
