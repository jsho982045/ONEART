import type { Metadata } from "next";
import Link from "next/link";
import { ProtectedPreview } from "@/components/ProtectedPreview";
import { SetupNotice } from "@/components/SetupNotice";
import { TILE_BUCKET } from "@/lib/paint/tiles";
import { formatPrice, previewPath } from "@/lib/finished";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "The finished piece" };
export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  notready: "The finished piece isn't ready yet. Check back soon.",
  participants: "Copies are for the people who painted on this canvas.",
  unavailable: "Buying isn't switched on yet. Check back soon.",
  checkout: "Checkout didn't start. Please try again.",
  download: "The download didn't start. Please try again.",
};

type Canvas = {
  id: string;
  slug: string;
  title: string;
  closes_at: string;
  final_ready_at: string | null;
  final_width: number | null;
  final_height: number | null;
  price_cents: number;
  currency: string;
};

export default async function PiecePage({ searchParams }: { searchParams: { c?: string; bought?: string; error?: string } }) {
  if (!isSupabaseConfigured) return <SetupNotice />;
  const supabase = createSupabaseServer();

  let q = supabase.from("canvases").select("id,slug,title,closes_at,final_ready_at,final_width,final_height,price_cents,currency");
  q = searchParams.c ? q.eq("slug", searchParams.c) : q.lte("closes_at", new Date().toISOString()).order("closes_at", { ascending: false });
  const { data: rows } = await q.limit(1);
  const canvas = rows?.[0] as Canvas | undefined;

  const { data: auth } = await supabase.auth.getUser();
  let painted = false;
  let owned = false;
  if (canvas && auth.user) {
    const [p, o] = await Promise.all([
      supabase.rpc("has_painted", { p_canvas: canvas.id }),
      supabase.rpc("owns_copy", { p_canvas: canvas.id }),
    ]);
    painted = Boolean(p.data);
    owned = Boolean(o.data);
  }

  const preview = canvas?.final_ready_at
    ? supabase.storage.from(TILE_BUCKET).getPublicUrl(previewPath(canvas.id)).data.publicUrl + `?v=${Date.parse(canvas.final_ready_at)}`
    : null;
  const price = canvas ? formatPrice(canvas.price_cents, canvas.currency) : "";
  const error = searchParams.error ? ERRORS[searchParams.error] : null;

  return (
    <main className="studio min-h-[100dvh] bg-[#e3ded5] px-4 pb-16 pt-[calc(16px+env(safe-area-inset-top))] text-[#231c16] sm:px-8">
      <header className="mx-auto flex max-w-[1100px] items-center justify-between">
        <Link href="/" className="porcelain-chip h-10 px-3.5 text-[21px] font-display italic !font-normal normal-case tracking-[-0.01em]">
          oneart
        </Link>
        <Link href="/canvas" className="porcelain-chip h-10 px-4 text-[14px] font-semibold">
          Explore the canvas
        </Link>
      </header>

      <div className="mx-auto mt-6 grid max-w-[1100px] gap-8 lg:grid-cols-[1fr_360px] lg:items-start">
        <div>
          {preview ? (
            <ProtectedPreview src={preview} alt={canvas?.title ?? "The finished canvas"} />
          ) : (
            <div className="paper grid aspect-[3/2] place-items-center rounded-2xl p-8 text-center">
              <p className="hand-label text-[30px] leading-tight">
                {canvas ? "The finished piece is being prepared." : "No canvas has finished yet."}
              </p>
            </div>
          )}
        </div>

        <aside className="paper rounded-[24px] p-6 sm:p-8">
          <p className="hand-label text-[24px] leading-none text-[#8a5a2b]">The finished piece</p>
          <h1 className="mt-2 text-[30px] font-display font-normal leading-[1.05] tracking-[-0.005em]">{canvas?.title ?? "oneart"}</h1>
          {canvas?.final_width && (
            <p className="mt-2 text-[14.5px] text-[#7a6c5c]">
              {canvas.final_width.toLocaleString()} × {canvas.final_height?.toLocaleString()} pixels · print quality
            </p>
          )}

          {searchParams.bought && owned && (
            <p className="mt-4 rounded-xl bg-[#e3efd9] px-4 py-3 text-[15px]" role="status">
              Thank you. It&apos;s yours: download it any time from this page.
            </p>
          )}
          {searchParams.bought && !owned && (
            <p className="mt-4 rounded-xl bg-[#efe6d6] px-4 py-3 text-[15px]" role="status">
              Payment received. Your copy will be ready in a moment: refresh this page.
            </p>
          )}
          {error && (
            <p className="mt-4 rounded-xl bg-[#f3dfd8] px-4 py-3 text-[15px]" role="alert">
              {error}
            </p>
          )}

          <div className="mt-6">
            {!canvas?.final_ready_at ? (
              <p className="text-[15.5px] leading-[1.5] text-[#5a4a3a]">
                When it&apos;s ready, everyone who painted on it can buy the full-resolution file.
              </p>
            ) : owned ? (
              <a href={`/api/download?c=${encodeURIComponent(canvas.slug)}`} className="porcelain-btn h-[52px] w-full btn-ink text-[17px] font-semibold">
                Download your copy
              </a>
            ) : !auth.user ? (
              <Link
                href={`/login?next=${encodeURIComponent(`/piece?c=${canvas.slug}`)}`}
                className="porcelain-btn h-[52px] w-full btn-ink text-[17px] font-semibold"
              >
                Log in to get your copy
              </Link>
            ) : painted ? (
              <form action="/api/checkout" method="post">
                <input type="hidden" name="canvas" value={canvas.slug} />
                <button type="submit" className="porcelain-btn h-[52px] w-full btn-ink text-[17px] font-semibold">
                  Get the full piece · {price}
                </button>
                <p className="mt-3 text-[13.5px] leading-[1.45] text-[#7a6c5c]">
                  A one-time payment. Full resolution, no watermark, yours to keep and print. Secure checkout by Stripe.
                </p>
              </form>
            ) : (
              <p className="text-[15.5px] leading-[1.5] text-[#5a4a3a]">
                Copies are for the people who painted on this canvas. The next canvas is your chance.
              </p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
