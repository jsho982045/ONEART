"use client";

import Link from "next/link";
import { useState } from "react";
import { CanvasPreview } from "@/components/studio/CanvasPreview";
import { useCountdown } from "@/components/studio/TopBar";
import type { CanvasInfo } from "@/lib/backend/types";

export function Landing() {
  const [info, setInfo] = useState<CanvasInfo | null>(null);
  const [painting, setPainting] = useState(1);

  return (
    <main className="studio relative h-[100dvh] overflow-hidden bg-[#e3ded5]">
      <CanvasPreview
        onInfo={(c, n) => {
          setInfo(c);
          setPainting(n);
        }}
      />

      <header className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-[calc(12px+env(safe-area-inset-top))] sm:px-8 sm:pt-6">
        <span className="porcelain-chip h-10 px-3.5 text-[21px] font-display italic !font-normal normal-case tracking-[-0.01em]">oneart</span>
        <nav className="flex items-center gap-2 text-[14px] font-semibold">
          <Link href="/login" className="porcelain-chip h-10 px-4">
            Log in
          </Link>
        </nav>
      </header>

      <section
        aria-labelledby="headline"
        className="paper absolute inset-x-0 bottom-0 z-10 rounded-t-[28px] px-6 pb-[calc(24px+env(safe-area-inset-bottom))] pt-7 sm:px-9 lg:inset-x-auto lg:bottom-8 lg:left-8 lg:w-[30rem] lg:rounded-[28px] lg:p-10"
      >
        <p className="hand-label text-[26px] leading-none text-[#8a5a2b]">{info ? <Status info={info} /> : " "}</p>
        <h1 id="headline" className="mt-2 text-[clamp(2.2rem,6vw,3.4rem)] font-display font-normal leading-[0.98] tracking-[-0.005em] text-balance text-[#1d1712]">
          One canvas.
          <br />
          The whole world.
        </h1>
        <p className="mt-4 max-w-[36ch] text-[17px] leading-[1.5] text-[#5a4a3a]">
          Pick up a brush and paint anything, live, next to everyone else. Pencil, ink, charcoal, watercolor and oil on a real woven
          canvas. When the clock runs out, it&apos;s finished forever.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {info && Date.now() >= Date.parse(info.closesAt) ? (
            <>
              <Link href="/piece" className="porcelain-btn h-[52px] btn-ink px-7 text-[17px] font-semibold">
                See the finished piece
              </Link>
              <Link href="/canvas" className="porcelain-btn h-[52px] px-6 text-[16px] font-semibold">
                Explore it
              </Link>
            </>
          ) : (
            <Link href="/canvas" className="porcelain-btn h-[52px] btn-ink px-7 text-[17px] font-semibold">
              Start painting
            </Link>
          )}
          <p className="flex items-center gap-2 text-[14.5px] font-medium text-[#5a4a3a]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4f8a4a] opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4f8a4a]" />
            </span>
            {painting} {painting === 1 ? "person" : "people"} here now
          </p>
        </div>
        <p className="mt-6 text-[13px] text-[#8a7b69]">
          Free to paint. <Link href="/terms" className="underline decoration-[#cdbfac] underline-offset-4">Terms</Link> ·{" "}
          <Link href="/privacy" className="underline decoration-[#cdbfac] underline-offset-4">Privacy</Link>
        </p>
      </section>
    </main>
  );
}

function Status({ info }: { info: CanvasInfo }) {
  const cd = useCountdown(info.opensAt, info.closesAt);
  if (cd.state === "closed") return <>This canvas is finished</>;
  if (cd.state === "soon") return <>{cd.text}</>;
  return <>Open now · {cd.text}</>;
}
