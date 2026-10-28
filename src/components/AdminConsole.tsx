"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getBackend } from "@/lib/backend";
import type { AdminReport, CanvasInfo, Me } from "@/lib/backend/types";
import { friendlyError } from "@/lib/backend/types";

const REASON: Record<string, string> = {
  hate: "Hate",
  sexual: "Sexual",
  violence: "Violence",
  spam: "Spam",
  personal_info: "Personal info",
  other: "Other",
};

/**
 * Moderators' desk. Every action is checked again in the database (admin_* functions), so this page is
 * only a convenience: a non-admin who opens it sees nothing and can do nothing.
 */
export function AdminConsole() {
  const backend = useMemo(() => getBackend(), []);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [canvases, setCanvases] = useState<CanvasInfo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([backend.admin.openReports(), backend.admin.listCanvases()]);
      setReports(r);
      setCanvases(c);
    } catch (err) {
      setMsg(friendlyError(String(err)));
    }
  }, [backend]);

  useEffect(() => {
    void backend.getMe().then((m) => {
      setMe(m);
      if (m?.isAdmin) void refresh();
    });
  }, [backend, refresh]);

  useEffect(() => {
    if (!me?.isAdmin) return;
    const t = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(t);
  }, [me, refresh]);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      setMsg(done);
      await refresh();
    } catch (err) {
      setMsg(friendlyError(String(err)));
    } finally {
      setBusy(false);
    }
  };

  if (me === undefined) return <Shell>Loading…</Shell>;
  if (!me?.isAdmin)
    return (
      <Shell>
        <p className="text-[#5a4a3a]">This page is for moderators.</p>
        <Link href="/canvas" className="porcelain-btn mt-4 h-11 px-5 font-semibold">
          Back to the canvas
        </Link>
      </Shell>
    );

  return (
    <Shell>
      {msg && (
        <p className="mb-4 rounded-xl bg-[#efe6d6] px-4 py-2.5 text-[14.5px]" role="status">
          {msg}
        </p>
      )}

      <section>
        <h2 className="text-[20px] font-display font-normal tracking-[-0.005em]">Reports</h2>
        {reports.length === 0 ? (
          <p className="mt-2 text-[15px] text-[#7a6c5c]">Nothing to review. The canvas is behaving.</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {reports.map((r) => {
              const cx = Math.round((r.min_x + r.max_x) / 2);
              const cy = Math.round((r.min_y + r.max_y) / 2);
              return (
                <li key={r.stroke_id} className="paper rounded-2xl p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[16px] font-semibold">
                      {r.username ?? "Deleted account"} <span className="font-normal text-[#7a6c5c]">· {r.tool}</span>
                    </p>
                    <p className="text-[13.5px] text-[#7a6c5c]">
                      {r.reports} report{r.reports === 1 ? "" : "s"} · {r.reasons.map((x) => REASON[x] ?? x).join(", ")}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href={`/canvas?at=${cx},${cy}`} target="_blank" className="porcelain-btn h-10 px-3.5 text-[14px] font-semibold">
                      Look at it
                    </Link>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => backend.admin.setHidden(r.stroke_id, !r.hidden), r.hidden ? "Restored." : "Hidden.")}
                      className="porcelain-btn h-10 px-3.5 text-[14px] font-semibold text-[#8e2a1a]"
                    >
                      {r.hidden ? "Restore" : "Hide stroke"}
                    </button>
                    {r.artist_no != null && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Ban ${r.username ?? "this artist"} and hide everything they painted?`)) {
                            void act(async () => backend.admin.banArtist(r.artist_no!), "Banned. Their work is hidden.");
                          }
                        }}
                        className="porcelain-btn h-10 px-3.5 text-[14px] font-semibold text-[#8e2a1a]"
                      >
                        Ban artist
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(() => backend.admin.dismiss(r.stroke_id), "Dismissed.")}
                      className="h-10 px-2 text-[14px] text-[#7a6c5c] underline decoration-[#cdbfac] underline-offset-4"
                    >
                      It&apos;s fine
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-[20px] font-display font-normal tracking-[-0.005em]">Canvases</h2>
        <p className="mt-1 text-[14px] text-[#7a6c5c]">Times are in your timezone. The newest open canvas is the one people see.</p>
        <div className="mt-3 space-y-3">
          {canvases.map((c) => (
            <CanvasForm key={c.id} canvas={c} busy={busy} onSave={(v) => act(() => backend.admin.saveCanvas(v), "Saved.")} />
          ))}
          <CanvasForm busy={busy} onSave={(v) => act(() => backend.admin.saveCanvas(v), "Scheduled.")} />
        </div>
      </section>
    </Shell>
  );
}

function toLocalInput(iso: string) {
  const d = new Date(iso);
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

function CanvasForm({
  canvas,
  busy,
  onSave,
}: {
  canvas?: CanvasInfo;
  busy: boolean;
  onSave: (c: Omit<CanvasInfo, "id" | "width" | "height"> & { id: string | null }) => void;
}) {
  const start = canvas?.opensAt ?? new Date(Date.now() + 86400e3).toISOString();
  const [v, setV] = useState({
    slug: canvas?.slug ?? "",
    title: canvas?.title ?? "",
    opens: toLocalInput(start),
    closes: toLocalInput(canvas?.closesAt ?? new Date(Date.parse(start) + 30 * 86400e3).toISOString()),
    ink: String(canvas?.inkCapacity ?? 800000),
    refill: String(Math.round((canvas?.inkRefillSeconds ?? 7200) / 60)),
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <form
      className="paper grid gap-3 rounded-2xl p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          id: canvas?.id ?? null,
          slug: v.slug,
          title: v.title,
          opensAt: new Date(v.opens).toISOString(),
          closesAt: new Date(v.closes).toISOString(),
          inkCapacity: Number(v.ink),
          inkRefillSeconds: Number(v.refill) * 60,
        });
      }}
    >
      <p className="text-[15px] font-semibold sm:col-span-2">{canvas ? canvas.title : "Schedule a new canvas"}</p>
      <Field label="Title" value={v.title} onChange={set("title")} required />
      <Field label="Short name (for links)" value={v.slug} onChange={set("slug")} pattern="[a-z0-9-]{1,40}" required />
      <Field label="Opens" type="datetime-local" value={v.opens} onChange={set("opens")} required />
      <Field label="Closes" type="datetime-local" value={v.closes} onChange={set("closes")} required />
      <Field label="Paint well size" type="number" value={v.ink} onChange={set("ink")} min={1000} required />
      <Field label="Refill time (minutes)" type="number" value={v.refill} onChange={set("refill")} min={1} required />
      <button type="submit" disabled={busy} className="porcelain-btn h-11 btn-ink font-semibold sm:col-span-2">
        {canvas ? "Save changes" : "Schedule"}
      </button>
    </form>
  );
}

function Field({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block text-[14px] font-semibold text-[#231c16]">
      {label}
      <input {...rest} className="field-input mt-1 bg-[#fffdf8]" />
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-[100dvh] bg-[#ebe6dd] px-4 pb-16 pt-[calc(20px+env(safe-area-inset-top))] text-[#231c16]">
      <div className="mx-auto max-w-[760px]">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="porcelain-chip h-10 px-3.5 text-[21px] font-display italic !font-normal normal-case tracking-[-0.01em]">
            oneart
          </Link>
          <span className="text-[14px] font-semibold text-[#7a6c5c]">Moderation</span>
        </header>
        {children}
      </div>
    </main>
  );
}
