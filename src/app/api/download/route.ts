import { NextResponse, type NextRequest } from "next/server";
import { FINALS_BUCKET, finalPath } from "@/lib/finished";
import { serviceClient } from "@/lib/server/service";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Hands a buyer a one-minute download link for the full-resolution file. Nobody else ever gets one. */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const slug = searchParams.get("c") ?? "";
  const supabase = createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(`/piece?c=${slug}`)}`);

  const { data: canvas } = await supabase.from("canvases").select("id,slug,final_ready_at").eq("slug", slug).single();
  if (!canvas?.final_ready_at) return NextResponse.redirect(`${origin}/piece?c=${encodeURIComponent(slug)}&error=notready`);

  const { data: owned } = await supabase.rpc("owns_copy", { p_canvas: canvas.id });
  if (!owned) return NextResponse.redirect(`${origin}/piece?c=${encodeURIComponent(slug)}`);

  const { data, error } = await serviceClient()
    .storage.from(FINALS_BUCKET)
    .createSignedUrl(finalPath(canvas.id), 60, { download: `oneart-${canvas.slug}.jpg` });
  if (error || !data) return NextResponse.redirect(`${origin}/piece?c=${encodeURIComponent(slug)}&error=download`);
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
