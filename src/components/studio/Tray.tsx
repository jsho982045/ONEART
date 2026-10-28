"use client";

import { BRUSH_ORDER, TOOLS, type ToolId } from "@/lib/paint/tools";
import { PaintDab, ToolArt } from "./ToolArt";

type Props = {
  tool: ToolId;
  looking: boolean;
  color: string;
  inkFraction: number;
  refilling: boolean;
  onLook: () => void;
  onTool: (t: ToolId) => void;
  onPalette: () => void;
  paletteOpen: boolean;
};

/**
 * The tool tray: real tools standing in a porcelain tray. The one in your hand lifts out; the rest sit
 * low. The dab of paint on the right is your colour, and it shrinks as your paint runs low.
 */
export function Tray({ tool, looking, color, inkFraction, refilling, onLook, onTool, onPalette, paletteOpen }: Props) {
  const label = looking ? "Look around" : TOOLS[tool].name;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center sm:bottom-4">
      <div className="pointer-events-auto relative w-full max-w-[560px] sm:w-auto">
        <p
          key={label}
          className="hand-label pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap text-[26px] leading-none text-[#3b3128] [text-shadow:0_1px_0_rgba(255,255,255,.7)] animate-[fadeLift_.35s_ease-out]"
          aria-live="polite"
        >
          {label}
        </p>
        <div className="tray flex items-end justify-between gap-0.5 px-2.5 pb-[calc(6px+env(safe-area-inset-bottom))] pt-2 sm:justify-center sm:gap-1.5 sm:rounded-[26px] sm:px-4 sm:pb-2">
          <ToolButton active={looking} label="Look around and see who painted what" onClick={onLook}>
            <ToolArt tool="look" paint={color} className="h-full w-full" />
          </ToolButton>
          <span className="mx-0.5 mb-3 h-10 w-px self-end bg-[#d9cfc0] sm:mx-1.5" aria-hidden />
          {BRUSH_ORDER.map((t) => (
            <ToolButton key={t} active={!looking && tool === t} label={`${TOOLS[t].name}: ${TOOLS[t].hint}`} onClick={() => onTool(t)}>
              <ToolArt tool={t} paint={color} className="h-full w-full" />
            </ToolButton>
          ))}
          <span className="mx-0.5 mb-3 h-10 w-px self-end bg-[#d9cfc0] sm:mx-1.5" aria-hidden />
          <button
            type="button"
            onClick={onPalette}
            aria-expanded={paletteOpen}
            aria-label={refilling ? "Your paint is refilling. Open the palette." : "Choose colour and size"}
            className="group relative mb-1 grid h-[60px] w-[56px] shrink-0 place-items-center rounded-2xl transition-transform active:scale-95"
          >
            <InkRing fraction={inkFraction} refilling={refilling} />
            <span
              className="transition-transform duration-500"
              style={{ transform: `scale(${0.58 + 0.42 * Math.max(0, Math.min(1, inkFraction))})` }}
            >
              <PaintDab color={color} size={40} dry={refilling} className="drop-shadow-[0_2px_2px_rgba(60,40,20,.35)]" />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className="group relative h-[72px] w-[42px] shrink-0 overflow-hidden rounded-b-xl sm:w-[46px]"
    >
      <span
        className={`absolute inset-x-0 bottom-0 mx-auto block h-[86px] w-[34px] transition-transform duration-300 [transition-timing-function:cubic-bezier(.3,1.5,.5,1)] ${
          active ? "-translate-y-0 drop-shadow-[0_6px_6px_rgba(50,35,20,.35)]" : "translate-y-[26px] group-hover:translate-y-[18px]"
        }`}
      >
        {children}
      </span>
    </button>
  );
}

function InkRing({ fraction, refilling }: { fraction: number; refilling: boolean }) {
  const f = Math.max(0, Math.min(1, fraction));
  const r = 25;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 60 60" className="absolute inset-0 m-auto h-[58px] w-[58px] -rotate-90" aria-hidden>
      <circle cx="30" cy="30" r={r} fill="none" stroke="rgba(120,100,80,.16)" strokeWidth="2.5" />
      <circle
        cx="30"
        cy="30"
        r={r}
        fill="none"
        stroke={refilling ? "#b9a68b" : "#6f5f4b"}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${c * f} ${c}`}
        className="transition-[stroke-dasharray] duration-700"
      />
    </svg>
  );
}
