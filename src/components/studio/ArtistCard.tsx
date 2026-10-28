"use client";

import { useState } from "react";
import type { ReportReason } from "@/lib/backend/types";
import type { Stroke } from "@/lib/paint/stroke";
import { TOOLS } from "@/lib/paint/tools";

type Props = {
  stroke: Stroke;
  username: string | null;
  x: number;
  y: number;
  mine: boolean;
  canReport: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onSeeAll: () => void;
  onErase: () => void;
  onReport: (r: ReportReason) => Promise<void>;
  onHide: () => void;
};

const REASONS: { id: ReportReason; label: string }[] = [
  { id: "hate", label: "Hate or harassment" },
  { id: "sexual", label: "Sexual content" },
  { id: "violence", label: "Violence or threats" },
  { id: "personal_info", label: "Someone's personal info" },
  { id: "spam", label: "Spam or ads" },
  { id: "other", label: "Something else" },
];

export function ArtistCard(p: Props) {
  const [reporting, setReporting] = useState(false);
  const [sent, setSent] = useState(false);
  const when = timeAgo(p.stroke.createdAt);
  // Keep the card on screen, preferring just above the finger.
  const left = typeof window === "undefined" ? p.x : Math.max(12, Math.min(window.innerWidth - 292, p.x - 140));
  const top = typeof window === "undefined" ? p.y : p.y > 260 ? p.y - 16 : p.y + 24;
  const above = typeof window !== "undefined" && p.y > 260;

  return (
    <div
      className="paper fixed z-40 w-[280px] rounded-2xl p-4 animate-[fadeLift_.18s_ease-out]"
      style={{ left, top, transform: above ? "translateY(-100%)" : undefined }}
      role="dialog"
      aria-label="Who painted this"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="hand-label text-[28px] leading-none text-[#231c16]">{p.mine ? "You" : p.username ?? "A former artist"}</p>
          <p className="mt-1 text-[13.5px] text-[#7a6c5c]">
            {TOOLS[p.stroke.tool].name} · {when}
          </p>
        </div>
        <button type="button" onClick={p.onClose} aria-label="Close" className="-m-1 grid h-9 w-9 place-items-center rounded-full text-[20px] text-[#7a6c5c] hover:bg-[rgba(60,45,30,.07)]">
          ×
        </button>
      </div>

      {sent ? (
        <p className="mt-3 text-[14px] text-[#3b3128]">Thanks. A moderator will take a look soon.</p>
      ) : reporting ? (
        <div className="mt-3 space-y-1">
          <p className="mb-1 text-[14px] font-semibold">What&apos;s wrong with it?</p>
          {REASONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className="block w-full rounded-xl px-3 py-2 text-left text-[14.5px] hover:bg-[rgba(60,45,30,.07)]"
              onClick={async () => {
                await p.onReport(r.id);
                setSent(true);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.stroke.artist != null && (
            <button type="button" onClick={p.onSeeAll} className="porcelain-btn h-10 px-3.5 text-[14px] font-semibold">
              {p.mine ? "All my work" : "See all their work"}
            </button>
          )}
          {p.mine ? (
            <button type="button" onClick={p.onErase} className="porcelain-btn h-10 px-3.5 text-[14px] font-semibold text-[#8e2a1a]">
              Erase this
            </button>
          ) : (
            p.canReport && (
              <button type="button" onClick={() => setReporting(true)} className="h-10 px-2 text-[14px] text-[#7a6c5c] underline decoration-[#cdbfac] underline-offset-4">
                Report
              </button>
            )
          )}
          {p.isAdmin && !p.mine && (
            <button type="button" onClick={p.onHide} className="h-10 px-2 text-[14px] font-semibold text-[#8e2a1a]">
              Hide (mod)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
