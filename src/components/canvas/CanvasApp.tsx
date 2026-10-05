"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveCount } from "@/components/LiveCount";
import { SetupNotice } from "@/components/SetupNotice";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { CanvasMeta, MyState, SplatRow } from "@/lib/types";
import { CanvasStage, type CanvasStageHandle } from "./CanvasStage";

type Status = "loading" | "closed" | "anon" | "onboarding" | "unverified" | "ready" | "placed";

function friendlyError(message: string | undefined): string {
  const m = message ?? "";
  if (m.includes("already_placed")) return "You've already placed your mark.";
  if (m.includes("email_not_verified")) return "Verify your email address first, then try again.";
  if (m.includes("not_onboarded")) return "Finish setting up your account first.";
  if (m.includes("canvas_closed")) return "This canvas is closed.";
  if (m.includes("not_authenticated")) return "Log in to place your mark.";
  if (m.includes("out_of_bounds")) return "That spot is outside the canvas. Pick somewhere on the sheet.";
  return "Something went wrong. Try again.";
}

export function CanvasApp() {
  const params = useSearchParams();
  const deepLinkUser = params.get("u");

  const stage = useRef<CanvasStageHandle>(null);
  const [loaded, setLoaded] = useState(false);
  const [me, setMe] = useState<MyState>(null);
  const [meta, setMeta] = useState<CanvasMeta | null>(null);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [placing, setPlacing] = useState(false);
  const [reveal, setReveal] = useState<SplatRow | null>(null);
  const [focus, setFocus] = useState<SplatRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3500);
  }, []);

  const refreshMe = useCallback(async () => {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase.rpc("my_state");
    setMe((data as MyState) ?? null);
  }, []);

  // Initial load: who am I, and is the canvas open?
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    const supabase = getSupabaseBrowser();
    (async () => {
      const [{ data: metaRow }, { data: state }] = await Promise.all([
        supabase.from("canvas_meta").select("total_clicks,status,closes_at,max_splats").eq("id", 1).single(),
        supabase.rpc("my_state"),
      ]);
      if (!active) return;
      setMeta((metaRow as CanvasMeta | null) ?? null);
      setMe((state as MyState) ?? null);
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Picking up where verification left off: refetch when the tab regains focus.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshMe();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshMe]);

  // Deep link: /canvas?u=username flies to that person's mark.
  useEffect(() => {
    if (!isSupabaseConfigured || !deepLinkUser) return;
    let active = true;
    getSupabaseBrowser()
      .rpc("splat_by_username", { p_username: deepLinkUser })
      .then(({ data }) => {
        if (!active) return;
        if (data) setFocus(data as SplatRow);
        else flash(`@${deepLinkUser} hasn't placed a mark yet.`);
      });
    return () => {
      active = false;
    };
  }, [deepLinkUser, flash]);

  const canvasClosed = meta !== null && meta.status !== "active";
  const status: Status = !loaded
    ? "loading"
    : !me
      ? canvasClosed
        ? "closed"
        : "anon"
      : me.has_clicked
        ? "placed"
        : canvasClosed
          ? "closed"
          : !me.onboarded
            ? "onboarding"
            : !me.email_verified
              ? "unverified"
              : "ready";

  const ownSplat = me?.splat ?? null;

  const placeMark = async () => {
    if (!pending || placing) return;
    setPlacing(true);
    setError(null);
    const supabase = getSupabaseBrowser();
    const { data, error: rpcError } = await supabase.rpc("place_splat", { p_x: pending.x, p_y: pending.y });
    setPlacing(false);
    if (rpcError || !data) {
      setError(friendlyError(rpcError?.message));
      if (rpcError?.message.includes("already_placed")) void refreshMe();
      return;
    }
    const row = data as SplatRow;
    setReveal(row);
    setPending(null);
    setMe((prev) => (prev ? { ...prev, has_clicked: true, splat: row } : prev));
  };

  const findMine = () => {
    if (ownSplat) stage.current?.focusSplat(ownSplat);
  };

  const share = async () => {
    if (!me) return;
    const url = `${window.location.origin}/canvas?u=${encodeURIComponent(me.username)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "My mark on oneart", text: "I placed my one click on oneart.", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      flash("Link copied. It opens straight to your mark.");
    } catch {
      // User dismissed the share sheet, or clipboard is blocked: nothing to do.
    }
  };

  const resendVerification = async () => {
    const supabase = getSupabaseBrowser();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email;
    if (!email) return;
    const { error: resendError } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/canvas` },
    });
    flash(resendError ? "Couldn't resend just now. Try again in a minute." : `Verification email sent to ${email}.`);
  };

  if (!isSupabaseConfigured) return <SetupNotice />;

  const placementEnabled = status === "ready" && !placing && !reveal;

  return (
    <div className="fixed inset-0 overflow-hidden bg-wall">
      <CanvasStage
        ref={stage}
        mode="full"
        className="absolute inset-0"
        placementEnabled={placementEnabled}
        pending={pending}
        onPick={(x, y) => {
          setPending({ x, y });
          setError(null);
        }}
        ownSplatId={ownSplat?.id ?? null}
        reveal={reveal}
        focus={focus}
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between p-4 sm:p-6">
        <Link
          href="/"
          className="pointer-events-auto rounded-[4px] bg-wall/90 px-3 py-2 text-[20px] font-bold leading-none tracking-[-0.04em] backdrop-blur"
        >
          oneart
        </Link>
        <div className="pointer-events-auto flex items-center gap-4 rounded-[4px] bg-wall/90 px-3 py-2 text-[15px] backdrop-blur">
          <span>
            <LiveCount /> <span className="text-graphite">marks</span>
          </span>
          {me ? (
            <span className="font-semibold">@{me.username}</span>
          ) : (
            loaded && (
              <Link href="/login?next=/canvas" className="text-link font-semibold">
                Log in
              </Link>
            )
          )}
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col overflow-hidden rounded-[4px] border border-rule bg-wall/95 backdrop-blur sm:right-6">
        <button type="button" aria-label="Zoom in" className="h-11 w-11 text-xl hover:bg-gesso" onClick={() => stage.current?.zoomBy(1.6)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" className="h-11 w-11 border-t border-rule text-xl hover:bg-gesso" onClick={() => stage.current?.zoomBy(1 / 1.6)}>
          −
        </button>
        <button type="button" aria-label="Show the whole canvas" className="h-11 w-11 border-t border-rule text-[13px] font-semibold hover:bg-gesso" onClick={() => stage.current?.fit()}>
          Fit
        </button>
      </div>

      {/* Bottom panel */}
      <div className="absolute inset-x-0 bottom-0 z-20 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-6">
        <div className="mx-auto max-w-[34rem] rounded-[4px] border border-rule bg-wall p-5 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.35)]">
          {status === "loading" && <p className="text-graphite">Loading the canvas…</p>}

          {status === "closed" && (
            <>
              <p className="font-semibold">This canvas is closed.</p>
              <p className="mt-1 text-graphite">No more marks can be placed. You can still look around.</p>
            </>
          )}

          {status === "anon" && (
            <>
              <p className="font-semibold">Everyone gets one click.</p>
              <p className="mt-1 text-graphite">Sign up to place yours. You can look around without an account.</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/signup" className="btn btn-primary">
                  Sign up
                </Link>
                <Link href="/login?next=/canvas" className="btn btn-quiet">
                  Log in
                </Link>
              </div>
            </>
          )}

          {status === "onboarding" && (
            <>
              <p className="font-semibold">One more step before you can place your mark.</p>
              <p className="mt-1 text-graphite">Choose a username and confirm the terms.</p>
              <div className="mt-4">
                <Link href="/welcome" className="btn btn-primary">
                  Finish setting up
                </Link>
              </div>
            </>
          )}

          {status === "unverified" && (
            <>
              <p className="font-semibold">Verify your email to place your mark.</p>
              <p className="mt-1 text-graphite">
                We sent you a link. Open it, then come back to this tab. You can still look around.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" onClick={() => void refreshMe()}>
                  I&apos;ve verified
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => void resendVerification()}>
                  Resend email
                </button>
              </div>
            </>
          )}

          {status === "ready" && !pending && !reveal && (
            <>
              <p className="font-semibold">Choose your spot.</p>
              <p className="mt-1 text-graphite">
                Tap or click anywhere on the canvas. Your mark&apos;s color, shape and size are left to chance. You get
                one.
              </p>
            </>
          )}

          {status === "ready" && pending && (
            <>
              <p className="font-semibold">This is your one click.</p>
              <p className="mt-1 text-graphite">
                Once placed, your mark can&apos;t be moved or removed. You won&apos;t see how it looks until you
                confirm.
              </p>
              {error && (
                <p role="alert" className="mt-3 font-medium text-alert">
                  {error}
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" disabled={placing} onClick={() => void placeMark()}>
                  {placing ? "Placing…" : "Place my mark here"}
                </button>
                <button type="button" className="btn btn-quiet" disabled={placing} onClick={() => setPending(null)}>
                  Choose a different spot
                </button>
              </div>
            </>
          )}

          {status === "placed" && (
            <>
              <p className="font-semibold">{reveal ? "That's yours. It's permanent." : "Your mark is on the canvas."}</p>
              <p className="mt-1 text-graphite">
                You&apos;re view-only from here. We&apos;ll email you when the finished piece is ready.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" className="btn btn-primary" onClick={() => void share()}>
                  Share my mark
                </button>
                <button type="button" className="btn btn-quiet" onClick={findMine}>
                  Find my mark
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transient messages */}
      <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-20 z-30 flex justify-center px-4">
        {notice && (
          <p className="rounded-[4px] bg-ink px-4 py-2.5 text-[15px] font-medium text-wall shadow-lg">{notice}</p>
        )}
      </div>
    </div>
  );
}
