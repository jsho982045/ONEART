import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = createSupabaseServer();
  await supabase.auth.signOut();
  // 303 so the browser follows with a GET.
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
