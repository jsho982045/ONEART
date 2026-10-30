import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/public-origin";
import { safeNext } from "@/lib/safe-next";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Landing point for email-confirmation links, password-reset links and Google sign-in.
 * Exchanges the one-time code for a session, then sends the person on their way.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) return NextResponse.redirect(`${origin}/login?error=link`);

  const supabase = createSupabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(`${origin}/login?error=link`);

  // Google sign-ins arrive without a chosen username or consent: finish that first.
  const { data: state } = await supabase.rpc("my_state");
  if (state && !state.onboarded && next !== "/reset-password") {
    return NextResponse.redirect(`${origin}/welcome?next=${encodeURIComponent(next)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
