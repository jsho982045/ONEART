import Link from "next/link";
import { CanvasStage } from "@/components/canvas/CanvasStage";
import { LiveCount } from "@/components/LiveCount";
import { SetupNotice } from "@/components/SetupNotice";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isSupabaseConfigured) {
    return (
      <>
        <SiteHeader />
        <SetupNotice />
      </>
    );
  }

  const supabase = createSupabaseServer();
  const [{ data: meta }, { data: state }] = await Promise.all([
    supabase.from("canvas_meta").select("total_clicks,status").eq("id", 1).single(),
    supabase.rpc("my_state"),
  ]);

  const total = Number(meta?.total_clicks ?? 0);
  const closed = meta?.status !== undefined && meta.status !== "active";
  const loggedIn = Boolean(state);
  const hasClicked = Boolean(state?.has_clicked);

  const cta = closed
    ? { href: "/canvas", label: "See the canvas" }
    : hasClicked
      ? { href: "/canvas", label: "Find my mark" }
      : loggedIn
        ? { href: "/canvas", label: "Place my mark" }
        : { href: "/signup", label: "Place my mark" };

  return (
    <main className="relative h-[100dvh] overflow-hidden">
      <CanvasStage mode="preview" className="absolute inset-0" />
      <SiteHeader overlay />

      <section
        aria-labelledby="headline"
        className="absolute inset-x-0 bottom-0 z-10 border-t border-rule bg-wall px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-6 sm:px-8 lg:inset-x-auto lg:bottom-8 lg:left-8 lg:w-[30rem] lg:border lg:p-8"
      >
        <h1
          id="headline"
          className="text-[clamp(2.1rem,5.2vw,3.4rem)] font-bold leading-[0.98] tracking-[-0.035em] text-balance"
        >
          One click each.
          <br />
          One canvas.
        </h1>
        <p className="mt-4 max-w-[34ch] text-[17px] leading-[1.5] text-graphite">
          Pick a spot anywhere on the canvas. The color, shape and size of your mark are left to chance, and you only
          get one.
        </p>
        <p className="mt-4 text-[17px] font-semibold">
          {total === 0 ? (
            closed ? (
              "No marks were placed."
            ) : (
              "Nobody has made a mark yet. Be the first."
            )
          ) : (
            <>
              <LiveCount initial={total} /> {total === 1 ? "person has" : "people have"} made their mark.
            </>
          )}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={cta.href} className="btn btn-primary">
            {cta.label}
          </Link>
          <Link href="/canvas" className="btn btn-quiet">
            Look around
          </Link>
        </div>

        <p className="mt-6 text-sm leading-relaxed text-graphite">
          A project by {SITE.owner}. When the canvas is finished it becomes one artwork that may be sold; contributors
          aren&apos;t paid.{" "}
          <Link href="/terms" className="text-link">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-link">
            privacy
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
