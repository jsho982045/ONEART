"use client";

import Link from "next/link";
import type { BlockReason } from "@/lib/studio/engine";

const COPY: Record<BlockReason, { title: string; body: string }> = {
  signin: {
    title: "Paint on the world's canvas",
    body: "It's free. Make an account so every stroke you paint is signed with your name.",
  },
  verify: { title: "Check your inbox", body: "Tap the link we emailed you to confirm it's really you. Then come back and paint." },
  onboard: { title: "One more step", body: "Pick the name that will sign your work." },
  banned: { title: "This account can't paint here", body: "It broke the canvas rules. You can still look around." },
  closed: { title: "This canvas is finished", body: "Every stroke on it is final. The finished piece is being prepared." },
  notyet: { title: "Not open yet", body: "The canvas opens soon. Have a look around until then." },
  loading: { title: "One moment", body: "The canvas is still loading." },
};

export function BlockedSheet({ reason, next, onClose }: { reason: BlockReason; next: string; onClose: () => void }) {
  const c = COPY[reason];
  const n = encodeURIComponent(next);
  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-40 bg-[rgba(30,22,14,.25)]" onClick={onClose} />
      <div
        role="dialog"
        aria-labelledby="blocked-title"
        className="paper fixed inset-x-0 bottom-0 z-50 rounded-t-[28px] px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-6 animate-[sheetUp_.32s_cubic-bezier(.2,.9,.3,1)] sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[420px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[24px] sm:animate-none"
      >
        <h2 id="blocked-title" className="text-[24px] font-display font-normal tracking-[-0.005em] text-[#231c16]">
          {c.title}
        </h2>
        <p className="mt-2 text-[16px] leading-[1.5] text-[#5a4a3a]">{c.body}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          {reason === "signin" && (
            <>
              <Link href={`/signup?next=${n}`} className="porcelain-btn h-12 flex-1 btn-ink text-[16px] font-semibold">
                Create a free account
              </Link>
              <Link href={`/login?next=${n}`} className="porcelain-btn h-12 flex-1 text-[16px] font-semibold">
                Log in
              </Link>
            </>
          )}
          {reason === "onboard" && (
            <Link href={`/welcome?next=${n}`} className="porcelain-btn h-12 flex-1 btn-ink text-[16px] font-semibold">
              Choose my name
            </Link>
          )}
          <button type="button" onClick={onClose} className="porcelain-btn h-12 flex-1 text-[16px] font-semibold">
            {reason === "signin" ? "Just looking" : "OK"}
          </button>
        </div>
      </div>
    </>
  );
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(62px+env(safe-area-inset-top))] z-50 flex justify-center px-4" aria-live="polite">
      {message && (
        <p key={message} className="paper rounded-full px-4 py-2.5 text-center text-[14.5px] font-medium text-[#231c16] animate-[fadeLift_.25s_ease-out]">
          {message}
        </p>
      )}
    </div>
  );
}

export function Hints({ onDone }: { onDone: () => void }) {
  const steps = [
    { k: "Paint", t: "Pick a tool from the tray and paint with one finger, a pencil or your mouse." },
    { k: "Move", t: "Two fingers to move and zoom. On a computer: scroll, or hold space and drag." },
    { k: "Look", t: "Tap the loupe, then tap any painting to see who made it." },
    { k: "Share", t: "Paint next to other people, never over them. Your paint refills as you go." },
  ];
  return (
    <>
      <div className="fixed inset-0 z-40 bg-[rgba(30,22,14,.3)]" aria-hidden />
      <div
        role="dialog"
        aria-labelledby="hints-title"
        className="paper fixed inset-x-3 bottom-[calc(118px+env(safe-area-inset-bottom))] z-50 mx-auto max-w-[440px] rounded-[24px] p-6 animate-[fadeLift_.3s_ease-out]"
      >
        <h2 id="hints-title" className="hand-label text-[34px] leading-none text-[#231c16]">
          Welcome to the canvas
        </h2>
        <ol className="mt-4 space-y-3">
          {steps.map((s, i) => (
            <li key={s.k} className="flex gap-3">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#231c16] text-[12.5px] font-bold text-[#fbf8f1]">{i + 1}</span>
              <p className="text-[15.5px] leading-[1.45] text-[#3b3128]">
                <strong className="font-semibold text-[#231c16]">{s.k}.</strong> {s.t}
              </p>
            </li>
          ))}
        </ol>
        <button type="button" onClick={onDone} className="porcelain-btn mt-5 h-12 w-full btn-ink text-[16px] font-semibold">
          Start painting
        </button>
      </div>
    </>
  );
}
