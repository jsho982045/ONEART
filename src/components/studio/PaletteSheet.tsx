"use client";

import { useEffect, useRef, useState } from "react";
import { hexToHsv, hexToRgb, hsvToHex, rgbToHex } from "@/lib/paint/color";
import { FONTS, PIGMENTS, TOOLS, isHexColor, type FontId, type ToolId } from "@/lib/paint/tools";
import { BrushPreview } from "./BrushPreview";
import { PaintDab } from "./ToolArt";

type Props = {
  open: boolean;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  font: FontId;
  recent: string[];
  inkFraction: number;
  refillText: string | null;
  onColor: (hex: string) => void;
  onSize: (n: number) => void;
  onOpacity: (n: number) => void;
  onFont: (f: FontId) => void;
  onEyedropper: () => void;
  onClose: () => void;
};

/** Sizes feel natural on a curve: fine control for small brushes, big jumps for big ones. */
const toSlider = (size: number, min: number, max: number) => Math.log(size / min) / Math.log(max / min);
const fromSlider = (v: number, min: number, max: number) => Math.round(min * Math.pow(max / min, v) * 2) / 2;

export function PaletteSheet(p: Props) {
  const spec = TOOLS[p.tool];
  const sheet = useRef<HTMLDivElement>(null);
  const dragY = useRef<{ y0: number; dy: number } | null>(null);
  const [offset, setOffset] = useState(0);
  const pigment = PIGMENTS.find((x) => x.hex === p.color);

  useEffect(() => {
    if (!p.open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p.open, p]);

  if (!p.open) return null;

  return (
    <>
      <button type="button" aria-label="Close palette" className="fixed inset-0 z-40 bg-[rgba(30,22,14,.18)] sm:bg-transparent" onClick={p.onClose} />
      <div
        ref={sheet}
        role="dialog"
        aria-label="Palette"
        className="paper fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-y-auto overscroll-contain rounded-t-[28px] px-5 pb-[calc(20px+env(safe-area-inset-bottom))] pt-2 animate-[sheetUp_.32s_cubic-bezier(.2,.9,.3,1)] sm:bottom-[112px] sm:left-auto sm:right-[max(16px,calc(50vw-420px))] sm:w-[380px] sm:rounded-[24px]"
        style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
      >
        <div
          className="mx-auto mb-2 flex h-6 w-24 cursor-grab touch-none items-center justify-center sm:hidden"
          onPointerDown={(e) => {
            dragY.current = { y0: e.clientY, dy: 0 };
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!dragY.current) return;
            dragY.current.dy = Math.max(0, e.clientY - dragY.current.y0);
            setOffset(dragY.current.dy);
          }}
          onPointerUp={() => {
            if ((dragY.current?.dy ?? 0) > 70) p.onClose();
            dragY.current = null;
            setOffset(0);
          }}
        >
          <span className="h-1.5 w-11 rounded-full bg-[#cfc4b4]" />
        </div>

        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-display font-normal tracking-[-0.005em] text-[#231c16]">{spec.name}</h2>
            <p className="text-[14px] text-[#7a6c5c]">{spec.hint}</p>
          </div>
          <button type="button" onClick={p.onClose} className="porcelain-btn h-10 px-4 text-[14px] font-semibold">
            Done
          </button>
        </div>

        <BrushPreview tool={p.tool} color={p.color} size={p.size} opacity={p.opacity} font={p.font} />

        <div className="mt-4 space-y-3.5">
          <Slider
            label="Size"
            value={toSlider(p.size, spec.minSize, spec.maxSize)}
            display={`${p.size}`}
            onChange={(v) => p.onSize(fromSlider(v, spec.minSize, spec.maxSize))}
          />
          <Slider
            label={p.tool === "watercolor" ? "Pigment" : p.tool === "pencil" || p.tool === "charcoal" ? "Pressure" : "Strength"}
            value={(p.opacity - 0.15) / 0.85}
            display={`${Math.round(p.opacity * 100)}%`}
            onChange={(v) => p.onOpacity(Math.round((0.15 + v * 0.85) * 100) / 100)}
          />
        </div>

        {p.tool === "text" && (
          <div className="mt-4 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Lettering style">
            {(Object.keys(FONTS) as FontId[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={p.font === f}
                onClick={() => p.onFont(f)}
                className={`porcelain-btn h-14 flex-col gap-0.5 ${p.font === f ? "ring-2 ring-[#3b3128]" : ""}`}
              >
                <span style={{ fontFamily: FONTS[f].family, fontStyle: f === "serif" ? "italic" : "normal" }} className="text-[24px] leading-none">
                  {f === "sans" ? "AB" : "Ab"}
                </span>
                <span className="text-[11px] text-[#7a6c5c]">{FONTS[f].name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mb-2 mt-5 flex items-center justify-between">
          <h3 className="text-[15px] font-display font-normal text-[#231c16]">
            Paint <span className="font-normal text-[#7a6c5c]">· {pigment?.name ?? "your mix"}</span>
          </h3>
          <button type="button" onClick={p.onEyedropper} className="text-[14px] font-semibold text-[#5a4a3a] underline decoration-[#cdbfac] underline-offset-4">
            Pick from canvas
          </button>
        </div>

        <div className="palette-board grid grid-cols-5 gap-1.5 rounded-2xl p-2.5 sm:gap-2">
          {PIGMENTS.map((pg) => (
            <button
              key={pg.hex}
              type="button"
              title={pg.name}
              aria-label={pg.name}
              aria-pressed={p.color === pg.hex}
              onClick={() => p.onColor(pg.hex)}
              className={`grid aspect-square place-items-center rounded-xl transition-transform active:scale-90 ${
                p.color === pg.hex ? "bg-[rgba(60,45,30,.12)]" : ""
              }`}
            >
              <PaintDab color={pg.hex} size={40} />
            </button>
          ))}
        </div>

        {p.recent.length > 0 && (
          <div className="mt-3 flex items-center gap-1.5 overflow-x-auto" aria-label="Recent colours">
            <span className="mr-1 shrink-0 text-[13px] text-[#7a6c5c]">Recent</span>
            {p.recent.map((c) => (
              <button key={c} type="button" aria-label={`Recent colour ${c}`} onClick={() => p.onColor(c)} className="shrink-0">
                <PaintDab color={c} size={30} />
              </button>
            ))}
          </div>
        )}

        <h3 className="mb-2 mt-5 text-[15px] font-semibold text-[#231c16]">Mix any colour</h3>
        <Mixer color={p.color} onChange={p.onColor} />

        <p className="mt-5 flex items-center gap-2 text-[13px] text-[#7a6c5c]">
          <span className="relative inline-block h-1.5 w-20 overflow-hidden rounded-full bg-[#e6ddd0]">
            <span className="absolute inset-y-0 left-0 rounded-full bg-[#7b6a55]" style={{ width: `${Math.max(0, Math.min(1, p.inkFraction)) * 100}%` }} />
          </span>
          {p.refillText ?? "Your paint well refills by itself as you go."}
        </p>
      </div>
    </>
  );
}

function Slider({ label, value, display, onChange }: { label: string; value: number; display: string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[14px] font-semibold text-[#231c16]">
        {label}
        <span className="font-normal tabular-nums text-[#7a6c5c]">{display}</span>
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={Math.max(0, Math.min(1, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        className="studio-range w-full"
      />
    </label>
  );
}

/**
 * Every colour there is: a hue band, a pad for how vivid and how light, and exact values for people who
 * know the code they want. Stays in step with the paint board and the eyedropper.
 */
function Mixer({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(color));
  const [hexText, setHexText] = useState(color);
  const pad = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const [h, s, v] = hsv;

  // Picking a paint on the board (or from the canvas) moves the mixer to that colour.
  useEffect(() => {
    if (hsvToHex(hsv[0], hsv[1], hsv[2]) !== color) setHsv(hexToHsv(color));
    setHexText(color);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color]);

  const set = (next: [number, number, number]) => {
    setHsv(next);
    const hex = hsvToHex(next[0], next[1], next[2]);
    setHexText(hex);
    onChange(hex);
  };

  const fromPad = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect();
    const ns = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const nv = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    set([h, ns, nv]);
  };

  const fromHue = (e: React.PointerEvent) => {
    const r = hue.current!.getBoundingClientRect();
    set([Math.max(0, Math.min(359.9, ((e.clientX - r.left) / r.width) * 360)), s, v]);
  };

  const drag = (fn: (e: React.PointerEvent) => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      fn(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) fn(e);
    },
  });

  const [r, g, b] = hexToRgb(color);
  const setChannel = (i: 0 | 1 | 2, value: string) => {
    const n = Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    const rgb: [number, number, number] = [r, g, b];
    rgb[i] = n;
    const hex = rgbToHex(rgb);
    setHsv(hexToHsv(hex));
    setHexText(hex);
    onChange(hex);
  };

  const commitHex = (text: string) => {
    let t = text.trim().toLowerCase();
    if (!t.startsWith("#")) t = "#" + t;
    if (/^#[0-9a-f]{3}$/.test(t)) t = "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
    if (isHexColor(t)) {
      setHsv(hexToHsv(t));
      onChange(t);
      setHexText(t);
    } else {
      setHexText(color);
    }
  };

  return (
    <div className="space-y-3">
      <div
        ref={pad}
        className="relative h-44 touch-none rounded-2xl shadow-[inset_0_1px_3px_rgba(0,0,0,.25)]"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
        {...drag(fromPad)}
        role="slider"
        aria-label="How vivid and how light"
        aria-valuenow={Math.round(v * 100)}
        aria-valuetext={color}
      >
        <span
          className="pointer-events-none absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_6px_rgba(0,0,0,.45)]"
          style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: color }}
        />
      </div>

      <div
        ref={hue}
        className="relative h-9 touch-none rounded-full shadow-[inset_0_1px_3px_rgba(0,0,0,.3)]"
        style={{ background: "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" }}
        {...drag(fromHue)}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(h)}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") set([(h + 359) % 360, s, v]);
          if (e.key === "ArrowRight") set([(h + 1) % 360, s, v]);
        }}
      >
        <span
          className="pointer-events-none absolute top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_6px_rgba(0,0,0,.45)]"
          style={{ left: `${(h / 360) * 100}%`, background: `hsl(${h} 100% 50%)` }}
        />
      </div>

      <div className="flex items-end gap-2.5">
        <PaintDab color={color} size={46} className="mb-0.5 shrink-0 drop-shadow-[0_2px_2px_rgba(60,40,20,.35)]" />
        <label className="min-w-0 flex-[1.5] text-[12.5px] font-semibold text-[#7a6c5c]">
          Hex
          <input
            value={hexText}
            onChange={(e) => setHexText(e.target.value)}
            onBlur={(e) => commitHex(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && commitHex((e.target as HTMLInputElement).value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="text"
            maxLength={7}
            aria-label="Hex colour code"
            className="mt-1 block h-11 w-full rounded-xl border border-[rgba(150,128,98,.35)] bg-[#fffdf8] px-3 font-mono text-[16px] uppercase text-[#231c16] focus:border-[#3b3128] focus:outline-none"
          />
        </label>
        {(["R", "G", "B"] as const).map((label, i) => (
          <label key={label} className="w-[54px] shrink-0 text-[12.5px] font-semibold text-[#7a6c5c]">
            {label}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={255}
              value={[r, g, b][i]}
              onChange={(e) => setChannel(i as 0 | 1 | 2, e.target.value)}
              aria-label={`${label === "R" ? "Red" : label === "G" ? "Green" : "Blue"}, 0 to 255`}
              className="mt-1 block h-11 w-full rounded-xl border border-[rgba(150,128,98,.35)] bg-[#fffdf8] px-1 text-center text-[16px] tabular-nums text-[#231c16] focus:border-[#3b3128] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}
