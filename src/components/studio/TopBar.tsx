"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type Props = {
  title: string;
  opensAt: string;
  closesAt: string;
  painting: number;
  username: string | null;
  localMode: boolean;
  isAdmin: boolean;
  soundOn: boolean;
  onSound: (on: boolean) => void;
  onMyWork: () => void;
  onHelp: () => void;
  onResetLocal: () => void;
  onSignIn: () => void;
};

export function useCountdown(opensAt: string, closesAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const open = Date.parse(opensAt);
  const close = Date.parse(closesAt);
  if (now < open) return { state: "soon" as const, text: `Opens in ${span(open - now)}` };
  if (now >= close) return { state: "closed" as const, text: "Finished" };
  const left = close - now;
  return { state: left < 48 * 3600_000 ? ("ending" as const) : ("open" as const), text: `${span(left)} left` };
}

function span(ms: number) {
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d >= 2) return `${d} days`;
  if (d === 1) return `1 day ${h} h`;
  if (h >= 1) return `${h} h ${m % 60} min`;
  return `${Math.max(1, m)} min`;
}

export function TopBar(p: Props) {
  const cd = useCountdown(p.opensAt, p.closesAt);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [menu]);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between gap-2 px-3 pt-[calc(10px+env(safe-area-inset-top))] sm:px-5 sm:pt-4">
      <Link href="/" className="pointer-events-auto porcelain-chip h-10 px-3.5 text-[21px] font-display italic !font-normal normal-case tracking-[-0.01em] text-[#1f1913]">
        oneart
      </Link>

      <div className="pointer-events-auto flex items-center gap-1.5">
        <span
          className={`porcelain-chip h-10 px-3 text-[13.5px] font-semibold tabular-nums ${cd.state === "ending" ? "text-[#a2381c]" : "text-[#3b3128]"}`}
          title={`${p.title} closes ${new Date(p.closesAt).toLocaleString()}`}
        >
          {cd.text}
        </span>
        <span className="porcelain-chip h-10 gap-1.5 px-3 text-[13.5px] font-semibold text-[#3b3128]" title="People here right now">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4f8a4a] opacity-50" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4f8a4a]" />
          </span>
          {p.painting} here
        </span>

        <div className="relative" ref={menuRef}>
          {p.username ? (
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              aria-expanded={menu}
              aria-label="Your account"
              className="porcelain-chip h-10 w-10 justify-center text-[15px] font-bold uppercase text-[#3b3128]"
            >
              {p.username.slice(0, 1)}
            </button>
          ) : (
            <button type="button" onClick={p.onSignIn} className="porcelain-chip h-10 btn-ink px-4 text-[14px] font-semibold">
              Sign in
            </button>
          )}
          {menu && (
            <div className="paper absolute right-0 top-12 w-60 rounded-2xl p-1.5 text-[15px] animate-[fadeLift_.18s_ease-out]" role="menu">
              {p.username && <p className="px-3 pb-1.5 pt-2 text-[13px] text-[#7a6c5c]">Signed in as {p.username}</p>}
              <MenuItem onClick={() => (setMenu(false), p.onMyWork())}>Show my work</MenuItem>
              <MenuItem onClick={() => p.onSound(!p.soundOn)}>Sound: {p.soundOn ? "on" : "off"}</MenuItem>
              <MenuItem onClick={() => (setMenu(false), p.onHelp())}>How it works</MenuItem>
              {p.isAdmin && !p.localMode && (
                <Link href="/admin" role="menuitem" className="block rounded-xl px-3 py-2.5 hover:bg-[rgba(60,45,30,.07)]">
                  Moderation
                </Link>
              )}
              {p.localMode ? (
                <MenuItem onClick={() => (setMenu(false), p.onResetLocal())}>Wipe local test canvas</MenuItem>
              ) : (
                <form action="/auth/signout" method="post">
                  <button type="submit" role="menuitem" className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-[rgba(60,45,30,.07)]">
                    Log out
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="w-full rounded-xl px-3 py-2.5 text-left hover:bg-[rgba(60,45,30,.07)]">
      {children}
    </button>
  );
}
