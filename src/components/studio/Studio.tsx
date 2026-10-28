"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBackend, isLocalMode } from "@/lib/backend";
import { resetLocalCanvas } from "@/lib/backend/local";
import type { CanvasInfo, Me, ReportReason } from "@/lib/backend/types";
import { friendlyError } from "@/lib/backend/types";
import { describeWait } from "@/lib/paint/ink";
import type { BBox, Stroke } from "@/lib/paint/stroke";
import { BRUSH_ORDER, PIGMENTS, TOOLS, isHexColor, type FontId, type ToolId } from "@/lib/paint/tools";
import { StudioEngine, type BlockReason, type EngineStatus } from "@/lib/studio/engine";
import { ArtistCard } from "./ArtistCard";
import { BlockedSheet, Hints, Toast } from "./Notices";
import { PaletteSheet } from "./PaletteSheet";
import { TextComposer } from "./TextComposer";
import { TopBar, useCountdown } from "./TopBar";
import { Tray } from "./Tray";

type BrushState = {
  tool: ToolId;
  color: string;
  sizes: Record<ToolId, number>;
  opacities: Record<ToolId, number>;
  font: FontId;
  recent: string[];
};

const BRUSH_KEY = "oneart.brush.v1";
const HINTS_KEY = "oneart.hints.v1";
const SOUND_KEY = "oneart.sound.v1";

function defaultBrush(): BrushState {
  const sizes = {} as Record<ToolId, number>;
  const opacities = {} as Record<ToolId, number>;
  for (const t of BRUSH_ORDER) {
    sizes[t] = TOOLS[t].defaultSize;
    opacities[t] = TOOLS[t].defaultOpacity;
  }
  return { tool: "watercolor", color: "#1f3a93", sizes, opacities, font: "hand", recent: [] };
}

function loadBrush(): BrushState {
  const d = defaultBrush();
  try {
    const raw = JSON.parse(localStorage.getItem(BRUSH_KEY) ?? "null") as Partial<BrushState> | null;
    if (!raw) return d;
    return {
      tool: raw.tool && TOOLS[raw.tool] ? raw.tool : d.tool,
      color: raw.color && isHexColor(raw.color) ? raw.color : d.color,
      sizes: { ...d.sizes, ...(raw.sizes ?? {}) },
      opacities: { ...d.opacities, ...(raw.opacities ?? {}) },
      font: raw.font ?? d.font,
      recent: (raw.recent ?? []).filter(isHexColor).slice(0, 8),
    };
  } catch {
    return d;
  }
}

const TOOL_KEYS: Record<string, ToolId | "look"> = {
  h: "look",
  l: "look",
  p: "pencil",
  i: "ink",
  c: "charcoal",
  w: "watercolor",
  o: "oil",
  t: "text",
  "1": "pencil",
  "2": "ink",
  "3": "charcoal",
  "4": "watercolor",
  "5": "oil",
  "6": "text",
};

export function Studio() {
  const host = useRef<HTMLDivElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const params = useSearchParams();
  const backend = useMemo(() => getBackend(), []);

  const [info, setInfo] = useState<CanvasInfo | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [brush, setBrush] = useState<BrushState>(defaultBrush);
  const [looking, setLooking] = useState(true);
  const [eyedropper, setEyedropper] = useState(false);
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [palette, setPalette] = useState(false);
  const [blocked, setBlocked] = useState<BlockReason | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pick, setPick] = useState<{ stroke: Stroke; x: number; y: number; username: string | null } | null>(null);
  const [composer, setComposer] = useState<{ wx: number; wy: number; sx: number; sy: number } | null>(null);
  const [hints, setHints] = useState(false);
  const [spot, setSpot] = useState<{ name: string } | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const toastTimer = useRef(0);

  const say = useCallback((m: string) => {
    setToast(m);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  // Restore preferences.
  useEffect(() => {
    setBrush(loadBrush());
    try {
      setSoundOn(localStorage.getItem(SOUND_KEY) !== "off");
      if (!localStorage.getItem(HINTS_KEY)) setHints(true);
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(BRUSH_KEY, JSON.stringify(brush));
    } catch {
      /* private mode */
    }
  }, [brush]);

  // Load the canvas and who you are.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, m] = await Promise.all([backend.getCanvas(params.get("c") ?? undefined), backend.getMe()]);
        if (!alive) return;
        setInfo(c);
        setMe(m);
        if (m && m.onboarded && m.emailVerified && !m.banned) setLooking(false);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [backend, params]);

  // The engine handlers always see the latest React state through this ref.
  const handlers = useRef({
    status: (s: EngineStatus) => setStatus(s),
    pick: (p: { stroke: Stroke; x: number; y: number; username: string | null } | null) => setPick(p),
    blocked: (r: BlockReason) => setBlocked(r),
    toast: (m: string) => say(m),
    placeText: (p: { wx: number; wy: number; sx: number; sy: number }) => setComposer(p),
    colorPicked: (_hex: string) => {},
    view: () => {},
    sizeStep: (_d: 1 | -1) => {},
    toolKey: (_k: string) => {},
  });

  useEffect(() => {
    if (!info || !host.current) return;
    const h = handlers.current;
    const engine = new StudioEngine(host.current, backend, info, {
      status: (s) => h.status(s),
      pick: (p) => h.pick(p),
      blocked: (r) => h.blocked(r),
      toast: (m) => h.toast(m),
      placeText: (p) => h.placeText(p),
      colorPicked: (c) => h.colorPicked(c),
      view: () => h.view(),
      sizeStep: (d) => h.sizeStep(d),
      toolKey: (k) => h.toolKey(k),
    });
    engineRef.current = engine;
    engine.setInsets(64, 120);
    engine.fit();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [info, backend]);

  // Connect once we know who's looking.
  const started = useRef(false);
  useEffect(() => {
    const e = engineRef.current;
    if (!e || started.current || !info) return;
    started.current = true;
    e.start(me);
  }, [info, me]);

  // Keep the engine in sync with the brush and mode.
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setBrush({
      tool: brush.tool,
      color: brush.color,
      size: brush.sizes[brush.tool],
      opacity: brush.opacities[brush.tool],
      font: brush.font,
    });
    e.setMode(eyedropper ? "eyedropper" : looking ? "look" : "paint");
    e.setSound(soundOn);
  }, [brush, looking, eyedropper, soundOn, info]);

  // Let the ink ring refill visibly.
  useEffect(() => {
    const t = setInterval(() => engineRef.current?.emitStatus(), 4000);
    return () => clearInterval(t);
  }, []);

  const chooseTool = useCallback(
    (t: ToolId | "look") => {
      setPick(null);
      setComposer(null);
      setEyedropper(false);
      if (t === "look") return setLooking(true);
      const reason = engineRef.current?.blockReason();
      if (reason && reason !== "closed" && reason !== "notyet") setBlocked(reason);
      if (reason === "closed" || reason === "notyet") {
        setBlocked(reason);
        return;
      }
      setLooking(false);
      setBrush((b) => ({ ...b, tool: t }));
      // Picking up a brush while looking at the whole wall walks you up to the canvas.
      const e = engineRef.current;
      if (e && !reason && !e.closeEnough()) e.approach();
    },
    [],
  );

  // Fresh handlers every render.
  handlers.current.colorPicked = (hex) => {
    setEyedropper(false);
    setBrush((b) => ({ ...b, color: hex }));
    say("Picked that colour.");
  };
  handlers.current.sizeStep = (d) =>
    setBrush((b) => {
      const spec = TOOLS[b.tool];
      const cur = b.sizes[b.tool];
      const next = Math.max(spec.minSize, Math.min(spec.maxSize, Math.round(cur * (d > 0 ? 1.25 : 0.8) * 2) / 2));
      return { ...b, sizes: { ...b.sizes, [b.tool]: next } };
    });
  handlers.current.toolKey = (k) => {
    const t = TOOL_KEYS[k];
    if (t) chooseTool(t);
  };

  const showArtist = useCallback(
    async (artist: number, name: string) => {
      const e = engineRef.current;
      if (!e || !info) return;
      try {
        const rects: BBox[] = await backend.artistBounds(info.id, artist);
        if (!rects.length) return say(`${name} hasn't painted anything yet.`);
        e.frame(rects, 1.5);
        e.spotlight(rects);
        setSpot({ name });
        setPick(null);
      } catch {
        say("Couldn't find that work right now.");
      }
    },
    [backend, info, say],
  );

  // Moderator links: /canvas?at=x,y flies straight to a spot.
  const jumped = useRef(false);
  useEffect(() => {
    const at = params.get("at");
    const e = engineRef.current;
    if (!at || !info || jumped.current || !e) return;
    const [x, y] = at.split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    jumped.current = true;
    e.frame([{ minX: x - 300, minY: y - 300, maxX: x + 300, maxY: y + 300 }], 1.5);
  }, [params, info]);

  // Shared links: /canvas?u=username
  const linked = useRef(false);
  useEffect(() => {
    const u = params.get("u");
    if (!u || !info || linked.current || !engineRef.current) return;
    linked.current = true;
    void backend.artistByUsername(u).then((n) => (n == null ? say(`No artist called ${u}.`) : showArtist(n, u)));
  }, [params, info, backend, showArtist, say]);

  const closePalette = () => {
    setPalette(false);
    setBrush((b) =>
      PIGMENTS.some((p) => p.hex === b.color) || b.recent[0] === b.color
        ? b
        : { ...b, recent: [b.color, ...b.recent.filter((c) => c !== b.color)].slice(0, 8) },
    );
  };

  if (failed) {
    return (
      <main className="grid h-[100dvh] place-items-center bg-[#e9e5de] p-6 text-center">
        <div>
          <p className="hand-label text-[34px] text-[#231c16]">The studio is closed for a moment.</p>
          <p className="mt-2 text-[#5a4a3a]">We couldn&apos;t reach the canvas. Check your connection and try again.</p>
          <button type="button" onClick={() => location.reload()} className="porcelain-btn mt-5 h-12 px-6 font-semibold">
            Try again
          </button>
        </div>
      </main>
    );
  }

  const inkFraction = status ? Math.max(0, status.ink) / status.capacity : 1;
  const refilling = Boolean(status && status.refillIn > 0);
  const refillText = refilling ? `Refilling · ready in ${describeWait(status!.refillIn)}` : null;
  const next = typeof window === "undefined" ? "/canvas" : location.pathname + location.search;
  const e = engineRef.current;

  return (
    <main className="studio fixed inset-0 overflow-hidden bg-[#ddd7cd]">
      <div ref={host} className="absolute inset-0" />
      {!info && <div className="pointer-events-none absolute inset-0 grid place-items-center text-[15px] text-[#7a6c5c]">Stretching the canvas…</div>}

      {info && (
        <>
          <TopBar
            title={info.title}
            opensAt={info.opensAt}
            closesAt={info.closesAt}
            painting={status?.painting ?? 1}
            username={me?.username ?? null}
            localMode={isLocalMode}
            isAdmin={Boolean(me?.isAdmin)}
            soundOn={soundOn}
            onSound={(on) => {
              setSoundOn(on);
              try {
                localStorage.setItem(SOUND_KEY, on ? "on" : "off");
              } catch {
                /* private mode */
              }
            }}
            onMyWork={() => (me ? void showArtist(me.artistNo, me.username) : setBlocked("signin"))}
            onHelp={() => setHints(true)}
            onResetLocal={() => {
              resetLocalCanvas();
              location.reload();
            }}
            onSignIn={() => setBlocked("signin")}
          />

          {spot && (
            <div className="fixed inset-x-0 top-[calc(62px+env(safe-area-inset-top))] z-30 flex justify-center">
              <button
                type="button"
                onClick={() => {
                  engineRef.current?.spotlight(null);
                  setSpot(null);
                }}
                className="porcelain-chip h-10 gap-2 px-4 text-[14px] font-semibold text-[#231c16]"
              >
                Showing {spot.name}&apos;s work <span aria-hidden className="text-[18px] leading-none text-[#7a6c5c]">×</span>
              </button>
            </div>
          )}

          {/* Undo / redo: thumb-height, only when there's something to undo. */}
          {!looking && (status?.canUndo || status?.canRedo) && (
            <div className="fixed bottom-[calc(126px+env(safe-area-inset-bottom))] left-3 z-30 flex gap-1.5 sm:bottom-[132px] sm:left-[max(12px,calc(50vw-300px))]">
              <RoundButton label="Undo" disabled={!status?.canUndo} onClick={() => void engineRef.current?.undo()}>
                <path d="M9 7 4 12l5 5M4.5 12H15a5 5 0 0 1 0 10h-2" />
              </RoundButton>
              <RoundButton label="Redo" disabled={!status?.canRedo} onClick={() => void engineRef.current?.redo()}>
                <path d="m15 7 5 5-5 5M19.5 12H9a5 5 0 0 0 0 10h2" />
              </RoundButton>
            </div>
          )}

          {/* Zoom controls for mouse users. */}
          <div className="fixed bottom-[132px] right-[max(12px,calc(50vw-300px))] z-30 hidden flex-col gap-1.5 sm:flex">
            <RoundButton label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.6)}>
              <path d="M12 6v12M6 12h12" />
            </RoundButton>
            <RoundButton label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.6)}>
              <path d="M6 12h12" />
            </RoundButton>
            <RoundButton label="See the whole canvas" onClick={() => engineRef.current?.fit()}>
              <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
            </RoundButton>
          </div>

          <Tray
            tool={brush.tool}
            looking={looking}
            color={brush.color}
            inkFraction={inkFraction}
            refilling={refilling}
            paletteOpen={palette}
            onLook={() => chooseTool("look")}
            onTool={chooseTool}
            onPalette={() => (palette ? closePalette() : setPalette(true))}
          />

          <PaletteSheet
            open={palette}
            tool={brush.tool}
            color={brush.color}
            size={brush.sizes[brush.tool]}
            opacity={brush.opacities[brush.tool]}
            font={brush.font}
            recent={brush.recent}
            inkFraction={inkFraction}
            refillText={refillText}
            onColor={(c) => setBrush((b) => ({ ...b, color: c }))}
            onSize={(n) => setBrush((b) => ({ ...b, sizes: { ...b.sizes, [b.tool]: n } }))}
            onOpacity={(n) => setBrush((b) => ({ ...b, opacities: { ...b.opacities, [b.tool]: n } }))}
            onFont={(f) => setBrush((b) => ({ ...b, font: f }))}
            onEyedropper={() => {
              closePalette();
              setEyedropper(true);
              say("Tap anywhere on the canvas to pick up its colour.");
            }}
            onClose={closePalette}
          />

          {pick && e && (
            <ArtistCard
              stroke={pick.stroke}
              username={pick.username}
              x={pick.x}
              y={pick.y}
              mine={me != null && pick.stroke.artist === me.artistNo}
              canReport={true}
              isAdmin={Boolean(me?.isAdmin)}
              onClose={() => setPick(null)}
              onSeeAll={() => pick.stroke.artist != null && void showArtist(pick.stroke.artist, pick.username ?? "This artist")}
              onErase={() => {
                void e.erase(pick.stroke.id);
                setPick(null);
              }}
              onReport={async (r: ReportReason) => {
                if (!me) {
                  setBlocked("signin");
                  throw new Error("signin");
                }
                await backend.report(pick.stroke.id, r).catch((err) => say(friendlyError(String(err))));
              }}
              onHide={() => {
                void backend.admin.setHidden(pick.stroke.id, true).then(
                  () => say("Hidden from the canvas."),
                  (err) => say(friendlyError(String(err))),
                );
                setPick(null);
              }}
            />
          )}

          {composer && e && (
            <TextComposer
              sx={composer.sx}
              sy={composer.sy}
              scale={e.camera.scale}
              size={brush.sizes.text}
              color={brush.color}
              font={brush.font}
              onCancel={() => setComposer(null)}
              onPlace={(text) => {
                void e.placeText(composer.wx, composer.wy, text);
                setComposer(null);
              }}
            />
          )}

          {blocked && <BlockedSheet reason={blocked} next={next} onClose={() => setBlocked(null)} />}
          {hints && (
            <Hints
              onDone={() => {
                setHints(false);
                try {
                  localStorage.setItem(HINTS_KEY, "1");
                } catch {
                  /* private mode */
                }
              }}
            />
          )}
          <Toast message={toast} />
          <CanvasStateBanner opensAt={info.opensAt} closesAt={info.closesAt} />
          {isLocalMode && (
            <p className="pointer-events-none fixed left-3 top-[calc(58px+env(safe-area-inset-top))] z-20 rounded-full bg-[rgba(35,28,22,.75)] px-2.5 py-1 text-[11.5px] font-semibold text-[#fbf8f1] sm:left-5">
              Local test mode · open another tab to paint together
            </p>
          )}
        </>
      )}
    </main>
  );
}

/** When the canvas is finished (or not open yet) the tray steps aside and a plaque says so. */
function CanvasStateBanner({ opensAt, closesAt }: { opensAt: string; closesAt: string }) {
  const cd = useCountdown(opensAt, closesAt);
  if (cd.state !== "closed" && cd.state !== "soon") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(128px+env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
      <div className="paper pointer-events-auto max-w-[420px] rounded-2xl px-5 py-4 text-center">
        <p className="hand-label text-[28px] leading-none text-[#231c16]">{cd.state === "closed" ? "This canvas is finished" : cd.text}</p>
        <p className="mt-1.5 text-[14.5px] leading-[1.45] text-[#5a4a3a]">
          {cd.state === "closed"
            ? "Every stroke on it is final. Look around and find your work: tap the loupe, then tap any painting."
            : "Have a look around. Painting opens when the clock runs down."}
        </p>
        {cd.state === "closed" && (
          <a href="/piece" className="porcelain-btn mt-3 h-11 btn-ink px-5 text-[15px] font-semibold">
            See the finished piece
          </a>
        )}
      </div>
    </div>
  );
}

function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="porcelain-chip grid h-11 w-11 place-items-center text-[#3b3128] transition-transform active:scale-90 disabled:opacity-40"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
