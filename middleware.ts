import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on every request path except:
     * - _next/static, _next/image (build assets)
     * - favicon.ico and common static image extensions
     * The canvas is publicly viewable, so this only keeps the session cookie
     * fresh; it does not gate access.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
