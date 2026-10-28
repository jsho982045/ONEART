"use client";

import { useId } from "react";
import type { ToolId } from "@/lib/paint/tools";

/**
 * Illustrations of real art tools, standing in the tray tip-up. The business end of each one carries the
 * colour you're painting with, the way a dipped brush would. Drawn as SVG so they stay crisp at any size.
 */

type Props = { paint: string; className?: string };

export function ToolArt({ tool, paint, className }: Props & { tool: ToolId | "look" }) {
  switch (tool) {
    case "pencil":
      return <Pencil paint={paint} className={className} />;
    case "ink":
      return <DipPen paint={paint} className={className} />;
    case "charcoal":
      return <Charcoal paint={paint} className={className} />;
    case "watercolor":
      return <RoundBrush paint={paint} className={className} />;
    case "oil":
      return <FlatBrush paint={paint} className={className} />;
    case "text":
      return <TypeBlock paint={paint} className={className} />;
    case "look":
      return <Loupe className={className} />;
  }
}

function Pencil({ paint, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}b`} x1="0" x2="1">
          <stop offset="0" stopColor="#c98a12" />
          <stop offset="0.35" stopColor="#f6c94a" />
          <stop offset="0.55" stopColor="#f0b72d" />
          <stop offset="1" stopColor="#b97a0c" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" x2="1">
          <stop offset="0" stopColor="#c99d6b" />
          <stop offset="0.5" stopColor="#ecc99c" />
          <stop offset="1" stopColor="#b98a58" />
        </linearGradient>
        <linearGradient id={`${id}m`} x1="0" x2="1">
          <stop offset="0" stopColor="#8a8b8c" />
          <stop offset="0.45" stopColor="#e9eaea" />
          <stop offset="1" stopColor="#7c7d7e" />
        </linearGradient>
      </defs>
      <path d="M13 34 L20 6 L27 34 Z" fill={`url(#${id}w)`} />
      <path d="M17.6 15.8 L20 6 L22.4 15.8 Q20 16.8 17.6 15.8 Z" fill={paint} />
      <path d="M13 34 Q15 31 16.5 34 Q18 31 20 34 Q22 31 23.5 34 Q25 31 27 34 Z" fill="#f2b632" />
      <rect x="13" y="33.6" width="14" height="52" fill={`url(#${id}b)`} />
      <path d="M17.6 34 V85.6 M22.4 34 V85.6" stroke="rgba(120,70,0,.25)" strokeWidth=".6" />
      <rect x="12.6" y="85" width="14.8" height="6.5" rx="1" fill={`url(#${id}m)`} />
      <path d="M12.6 87.2 H27.4 M12.6 89.4 H27.4" stroke="rgba(0,0,0,.2)" strokeWidth=".5" />
      <path d="M13 91.4 H27 V95 Q27 98 24 98 H16 Q13 98 13 95 Z" fill="#e88b8f" />
    </svg>
  );
}

function DipPen({ paint, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}n`} x1="0" x2="1">
          <stop offset="0" stopColor="#8b6a2c" />
          <stop offset="0.45" stopColor="#f3d98f" />
          <stop offset="1" stopColor="#7d5c22" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" x2="1">
          <stop offset="0" stopColor="#15110e" />
          <stop offset="0.4" stopColor="#4b3a2f" />
          <stop offset="1" stopColor="#120e0b" />
        </linearGradient>
      </defs>
      <path d="M20 5 C23 13 25.5 22 25.5 33 L14.5 33 C14.5 22 17 13 20 5 Z" fill={`url(#${id}n)`} />
      <path d="M20 5 C21.2 9 22 12.5 22.3 16 Q20 17.6 17.7 16 C18 12.5 18.8 9 20 5 Z" fill={paint} />
      <path d="M20 9 V24" stroke="#3a2a10" strokeWidth=".7" />
      <circle cx="20" cy="25.4" r="1.3" fill="#3a2a10" />
      <rect x="14" y="32" width="12" height="7" rx="1.2" fill="#a9852f" />
      <path d="M14.5 39 L25.5 39 L24.4 96 Q20 98.4 15.6 96 Z" fill={`url(#${id}h)`} />
      <path d="M17 44 L16.6 92" stroke="rgba(255,255,255,.18)" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

function Charcoal({ paint, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}c`} x1="0" x2="1">
          <stop offset="0" stopColor="#141312" />
          <stop offset="0.4" stopColor="#3d3a37" />
          <stop offset="0.6" stopColor="#2a2826" />
          <stop offset="1" stopColor="#0e0d0c" />
        </linearGradient>
      </defs>
      <path
        d="M15.5 12 Q20 7.5 24.5 11.5 L26 30 L25 52 L26.4 74 L24.8 95 Q20 97.5 15.2 95 L14.2 72 L15.4 50 L14 30 Z"
        fill={`url(#${id}c)`}
      />
      <path d="M16.5 14 Q20 10.5 23.5 13.5 L23.8 19 Q20 21 16.2 19 Z" fill={paint} opacity=".85" />
      <path d="M17.5 30 L17.2 46 M22.5 56 L22.9 72 M18.4 78 L18 90" stroke="rgba(255,255,255,.12)" strokeWidth=".9" />
      <path d="M14.8 42 Q17 43.5 15 46 M25.4 64 Q23.5 65.5 25.6 68" stroke="#0a0908" strokeWidth=".8" fill="none" />
    </svg>
  );
}

function RoundBrush({ paint, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}f`} x1="0" x2="1">
          <stop offset="0" stopColor="#7d7f81" />
          <stop offset="0.42" stopColor="#f1f2f3" />
          <stop offset="1" stopColor="#6c6e70" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" x2="1">
          <stop offset="0" stopColor="#5c160f" />
          <stop offset="0.4" stopColor="#b3362a" />
          <stop offset="1" stopColor="#4a110b" />
        </linearGradient>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={paint} />
          <stop offset="0.55" stopColor={paint} />
          <stop offset="0.85" stopColor="#7a5634" />
          <stop offset="1" stopColor="#5b3c22" />
        </linearGradient>
      </defs>
      <path d="M20 3 C23.6 10 25.6 18 25 30 L15 30 C14.4 18 16.4 10 20 3 Z" fill={`url(#${id}t)`} />
      <path d="M19 9 C18 15 17.6 21 18 28" stroke="rgba(255,255,255,.28)" strokeWidth=".8" fill="none" />
      <path d="M14.6 29 H25.4 L24.6 49 H15.4 Z" fill={`url(#${id}f)`} />
      <path d="M15 33 H25 M15.2 36 H24.8" stroke="rgba(0,0,0,.18)" strokeWidth=".5" />
      <path d="M15.4 49 Q15.6 70 17.6 97 Q20 98.6 22.4 97 Q24.4 70 24.6 49 Z" fill={`url(#${id}h)`} />
      <path d="M17.2 54 Q17.6 74 18.8 93" stroke="rgba(255,255,255,.22)" strokeWidth="1" fill="none" />
    </svg>
  );
}

function FlatBrush({ paint, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}f`} x1="0" x2="1">
          <stop offset="0" stopColor="#87898b" />
          <stop offset="0.38" stopColor="#f4f5f5" />
          <stop offset="1" stopColor="#6d6f71" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" x2="1">
          <stop offset="0" stopColor="#9a7448" />
          <stop offset="0.45" stopColor="#dcb886" />
          <stop offset="1" stopColor="#8a6438" />
        </linearGradient>
        <linearGradient id={`${id}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={paint} />
          <stop offset="0.62" stopColor={paint} />
          <stop offset="0.66" stopColor="#efe1c4" />
          <stop offset="1" stopColor="#d9c39a" />
        </linearGradient>
      </defs>
      <path d="M11.5 9 Q20 6 28.5 9 L27.6 33 H12.4 Z" fill={`url(#${id}p)`} />
      {[14, 16.5, 19, 21.5, 24, 26.2].map((x) => (
        <path key={x} d={`M${x} 9 L${x - 0.2} 32`} stroke="rgba(0,0,0,.14)" strokeWidth=".5" />
      ))}
      <path d="M12.2 31.5 Q20 33.5 27.8 31.5 L26.4 54 H13.6 Z" fill={`url(#${id}f)`} />
      <path d="M13 37 Q20 38.6 27 37 M13.3 40 Q20 41.6 26.7 40" stroke="rgba(0,0,0,.2)" strokeWidth=".6" fill="none" />
      <path d="M13.6 54 Q15.4 76 17.4 97 Q20 98.6 22.6 97 Q24.6 76 26.4 54 Z" fill={`url(#${id}h)`} />
      <path d="M16.4 60 Q17.4 78 18.6 93 M22 62 Q21.8 76 21.4 90" stroke="rgba(90,55,20,.28)" strokeWidth=".6" fill="none" />
    </svg>
  );
}

function TypeBlock({ paint, className }: Props) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}w`} x1="0" x2="1">
          <stop offset="0" stopColor="#8b5a32" />
          <stop offset="0.45" stopColor="#c48a55" />
          <stop offset="1" stopColor="#7a4c28" />
        </linearGradient>
        <linearGradient id={`${id}m`} x1="0" x2="1">
          <stop offset="0" stopColor="#6f7173" />
          <stop offset="0.4" stopColor="#c9cbcc" />
          <stop offset="1" stopColor="#5f6163" />
        </linearGradient>
      </defs>
      <rect x="8" y="40" width="24" height="56" rx="2" fill={`url(#${id}w)`} />
      <path d="M11 46 Q13 62 11 92 M20 44 Q22 66 19.4 94 M28.6 46 Q27 70 29 92" stroke="rgba(60,30,10,.25)" strokeWidth=".7" fill="none" />
      <rect x="9.5" y="30" width="21" height="11" rx="1" fill={`url(#${id}m)`} />
      <rect x="9" y="12" width="22" height="19" rx="1.6" fill="#3a3c3e" />
      <text x="20" y="27.6" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="15" fill={paint}>
        A
      </text>
    </svg>
  );
}

function Loupe({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 100" className={className} aria-hidden>
      <defs>
        <radialGradient id={`${id}g`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".95" />
          <stop offset="0.4" stopColor="#dfe9ee" stopOpacity=".55" />
          <stop offset="1" stopColor="#9fb3bd" stopOpacity=".55" />
        </radialGradient>
        <linearGradient id={`${id}r`} x1="0" x2="1">
          <stop offset="0" stopColor="#8a6a2a" />
          <stop offset="0.45" stopColor="#f2d792" />
          <stop offset="1" stopColor="#7a5a1c" />
        </linearGradient>
        <linearGradient id={`${id}h`} x1="0" x2="1">
          <stop offset="0" stopColor="#24180f" />
          <stop offset="0.45" stopColor="#5a3d26" />
          <stop offset="1" stopColor="#1d130c" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="22" r="14" fill={`url(#${id}r)`} />
      <circle cx="20" cy="22" r="10.6" fill={`url(#${id}g)`} />
      <path d="M13.5 18 Q16 13.4 21 13" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" fill="none" opacity=".9" />
      <rect x="17.6" y="35" width="4.8" height="8" fill={`url(#${id}r)`} />
      <path d="M16.6 43 H23.4 L22.4 96 Q20 97.6 17.6 96 Z" fill={`url(#${id}h)`} />
    </svg>
  );
}

/** A dab of paint as it sits on a palette: thick, glossy, a little irregular. */
export function PaintDab({ color, size = 40, dry = false, className }: { color: string; size?: number; dry?: boolean; className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} className={className} aria-hidden>
      <defs>
        <radialGradient id={`${id}s`} cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity={dry ? 0.05 : 0.55} />
          <stop offset="0.28" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".28" />
        </radialGradient>
      </defs>
      <path
        d="M20 3.5 C27.5 3.2 35.6 8 36.2 17.2 C36.9 27.8 30.4 36.4 20.6 36.5 C10.4 36.6 3.6 30.2 3.8 20.6 C4 11 11.2 3.8 20 3.5 Z"
        fill={color}
      />
      <path
        d="M20 3.5 C27.5 3.2 35.6 8 36.2 17.2 C36.9 27.8 30.4 36.4 20.6 36.5 C10.4 36.6 3.6 30.2 3.8 20.6 C4 11 11.2 3.8 20 3.5 Z"
        fill={`url(#${id}s)`}
      />
      {!dry && <ellipse cx="14" cy="12.5" rx="4.2" ry="2.4" fill="#fff" opacity=".55" transform="rotate(-28 14 12.5)" />}
      {dry && (
        <path d="M12 14 L17 19 L15 25 M24 11 L22 17 L27 22 M20 27 L25 30" stroke="rgba(0,0,0,.25)" strokeWidth=".8" fill="none" />
      )}
    </svg>
  );
}
