"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MAX_LOAD, MAX_ZOOM, WORLD_SIZE } from "@/lib/constants";
import { SIZE_MAX, generateSplat, type Splat } from "@/lib/splat";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { SplatOwner, SplatRow } from "@/lib/types";

export type CanvasStageHandle = {
  /** Smoothly move the camera to a world position. */
  flyTo: (x: number, y: number, scale?: number) => void;
  /** Show the whole canvas. */
  fit: () => void;
  zoomBy: (factor: number) => void;
  /** Pulse a ring around a splat so it's easy to spot. */
  highlight: (id: string) => void;
  /** Fly to a splat at a zoom where it's clearly visible, and pulse it. */
  focusSplat: (row: SplatRow) => void;
};

type Props = {
  /** "preview" is a non-interactive, auto-fitted view for the landing page. */
  mode: "preview" | "full";
  className?: string;
  /** When true, a tap/click on the canvas calls onPick with a world position. */
  placementEnabled?: boolean;
  /** Spot the user has picked but not yet confirmed. */
  pending?: { x: number; y: number } | null;
  onPick?: (x: number, y: number) => void;
  /** The logged-in user's own splat; it keeps a ring around it when zoomed out. */
  ownSplatId?: string | null;
  /** Newly placed splat: plays the reveal animation. */
  reveal?: SplatRow | null;
  /** Splat to fly to and highlight (deep links). */
  focus?: SplatRow | null;
};

type Camera = { cx: number; cy: number; scale: number };
type Rect = { minX: number; maxX: number; minY: number; maxY: number };

const SPLAT_COLUMNS = "id,x,y,seed,algo_version,created_at";
const PAGE = 1000;

// ---- Rendering cache (module-level: shapes are pure functions of the seed) ----------------------
type Rendered = { splat: Splat; path: Path2D };
const renderCache = new Map<number, Rendered>();
function getRendered(seed: number): Rendered {
  let r = renderCache.get(seed);
  if (!r) {
    const splat = generateSplat(seed);
    r = { splat, path: new Path2D(splat.path) };
    if (renderCache.size > 20000) renderCache.clear();
    renderCache.set(seed, r);
  }
  return r;
}

// ---- Math helpers --------------------------------------------------------------------------------
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

function computeFit(w: number, h: number, preview: boolean): Camera {
  // In preview the headline block sits over part of the screen; fit the canvas into what's left.
  let insetL = 0;
  let insetB = 0;
  if (preview) {
    if (w >= 900) insetL = Math.min(520, w * 0.36);
    else insetB = Math.min(340, h * 0.5);
  }
  const availW = w - insetL;
  const availH = h - insetB;
  const scale = (Math.min(availW, availH) / WORLD_SIZE) * 0.92;
  const availCx = insetL + availW / 2;
  const availCy = availH / 2;
  return {
    scale,
    cx: WORLD_SIZE / 2 - (availCx - w / 2) / scale,
    cy: WORLD_SIZE / 2 - (availCy - h / 2) / scale,
  };
}

const REVEAL_MS = 1100;
const FLY_MS = 900;
const PULSE_MS = 3600;

export const CanvasStage = forwardRef<CanvasStageHandle, Props>(function CanvasStage(props, ref) {
  const { mode, className } = props;
  const preview = mode === "preview";

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  const cam = useRef<Camera>({ cx: WORLD_SIZE / 2, cy: WORLD_SIZE / 2, scale: 0.2 });
  const viewSize = useRef({ w: 0, h: 0, dpr: 1 });
  const interacted = useRef(false);

  const splats = useRef(new Map<string, SplatRow>());
  const sorted = useRef<SplatRow[]>([]);
  const sortedDirty = useRef(false);

  const dirty = useRef(true);
  const raf = useRef<number | null>(null);
  const fly = useRef<{ from: Camera; to: Camera; start: number } | null>(null);
  const revealing = useRef<{ id: string; start: number } | null>(null);
  const pulsing = useRef<{ id: string; start: number } | null>(null);
  const reducedMotion = useRef(false);
  const theme = useRef({ wall: "#f6f6f3", gesso: "#e8eae5", ink: "#15171b", rule: "#d3d6d0" });

  const loadedRect = useRef<Rect | null>(null);
  const loadToken = useRef(0);
  const loadTimer = useRef<number | null>(null);

  const ownerRequested = useRef(new Set<string>());
  const [owners, setOwners] = useState<Record<string, SplatOwner | null>>({});
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);

  // ---- Camera helpers ----------------------------------------------------------------------------
  const minScale = useCallback(() => {
    const { w, h } = viewSize.current;
    return computeFit(w || 1, h || 1, false).scale * 0.7;
  }, []);

  const clampCamera = useCallback(() => {
    const c = cam.current;
    c.scale = clamp(c.scale, minScale(), MAX_ZOOM);
    c.cx = clamp(c.cx, 0, WORLD_SIZE);
    c.cy = clamp(c.cy, 0, WORLD_SIZE);
  }, [minScale]);

  const screenToWorld = useCallback((sx: number, sy: number): [number, number] => {
    const { w, h } = viewSize.current;
    const c = cam.current;
    return [c.cx + (sx - w / 2) / c.scale, c.cy + (sy - h / 2) / c.scale];
  }, []);

  // ---- Drawing -----------------------------------------------------------------------------------
  const requestDraw = useCallback(() => {
    dirty.current = true;
    if (raf.current === null) raf.current = requestAnimationFrame(frameRef.current);
  }, []);

  const frameRef = useRef<(now: number) => void>(() => {});

  const draw = useCallback((now: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h, dpr } = viewSize.current;
    if (!w || !h) return;
    const c = cam.current;
    const t = theme.current;

    if (sortedDirty.current) {
      sorted.current = [...splats.current.values()].sort((a, b) =>
        a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1,
      );
      sortedDirty.current = false;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = t.wall;
    ctx.fillRect(0, 0, w, h);

    // The canvas sheet.
    const x0 = (0 - c.cx) * c.scale + w / 2;
    const y0 = (0 - c.cy) * c.scale + h / 2;
    const sheet = WORLD_SIZE * c.scale;
    ctx.fillStyle = t.gesso;
    ctx.fillRect(x0, y0, sheet, sheet);
    ctx.strokeStyle = t.rule;
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, sheet - 1, sheet - 1);

    // Splats.
    const halfW = w / 2 / c.scale;
    const halfH = h / 2 / c.scale;
    const minX = c.cx - halfW;
    const maxX = c.cx + halfW;
    const minY = c.cy - halfH;
    const maxY = c.cy + halfH;
    const rev = revealing.current;
    ctx.globalAlpha = 0.9;

    for (const row of sorted.current) {
      const r = getRendered(row.seed);
      const s = r.splat;
      const reach = s.size * s.extent;
      if (row.x + reach < minX || row.x - reach > maxX || row.y + reach < minY || row.y - reach > maxY) continue;

      let k = 1;
      if (rev && rev.id === row.id) {
        const p = reducedMotion.current ? 1 : clamp((now - rev.start) / REVEAL_MS, 0, 1);
        k = Math.max(0.001, easeOutBack(p));
      }
      const sx = (row.x - c.cx) * c.scale + w / 2;
      const sy = (row.y - c.cy) * c.scale + h / 2;
      const m = s.size * c.scale * k;
      const cos = Math.cos(s.rotation) * m;
      const sin = Math.sin(s.rotation) * m;
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * sx, dpr * sy);
      ctx.fillStyle = s.color;
      ctx.fill(r.path);
    }

    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Overlays (screen space).
    const p = propsRef.current;
    const drawRing = (sx: number, sy: number, radius: number, width: number, alpha = 1) => {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width + 2;
      ctx.strokeStyle = t.wall;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = width;
      ctx.strokeStyle = t.ink;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    // The user's own mark stays findable when zoomed out.
    if (p.ownSplatId) {
      const own = splats.current.get(p.ownSplatId);
      if (own && !(rev && rev.id === own.id && now - rev.start < REVEAL_MS)) {
        const onScreen = getRendered(own.seed).splat.size * c.scale;
        if (onScreen < 60) {
          drawRing((own.x - c.cx) * c.scale + w / 2, (own.y - c.cy) * c.scale + h / 2, Math.max(onScreen * 1.15 + 3, 9), 1.5);
        }
      }
    }

    // "Find my mark" pulse.
    const pulse = pulsing.current;
    if (pulse) {
      const row = splats.current.get(pulse.id);
      const elapsed = now - pulse.start;
      if (row && elapsed < PULSE_MS) {
        const sx = (row.x - c.cx) * c.scale + w / 2;
        const sy = (row.y - c.cy) * c.scale + h / 2;
        const base = Math.max(getRendered(row.seed).splat.size * c.scale * 1.2, 14);
        drawRing(sx, sy, base, 2);
        for (let i = 0; i < 3; i++) {
          const phase = clamp((elapsed - i * 650) / 1500, 0, 1);
          if (phase > 0 && phase < 1) drawRing(sx, sy, base + phase * 70, 2, 1 - phase);
        }
      } else if (elapsed >= PULSE_MS) {
        pulsing.current = null;
      }
    }

    // Pending pin.
    if (p.pending) {
      const sx = (p.pending.x - c.cx) * c.scale + w / 2;
      const sy = (p.pending.y - c.cy) * c.scale + h / 2;
      drawRing(sx, sy, 13, 2);
      ctx.fillStyle = t.ink;
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx - 22, sy);
      ctx.lineTo(sx - 17, sy);
      ctx.moveTo(sx + 17, sy);
      ctx.lineTo(sx + 22, sy);
      ctx.moveTo(sx, sy - 22);
      ctx.lineTo(sx, sy - 17);
      ctx.moveTo(sx, sy + 17);
      ctx.lineTo(sx, sy + 22);
      ctx.stroke();
    }
  }, []);

  frameRef.current = (now: number) => {
    raf.current = null;

    const f = fly.current;
    if (f) {
      const p = reducedMotion.current ? 1 : clamp((now - f.start) / FLY_MS, 0, 1);
      const e = easeInOutCubic(p);
      cam.current = {
        cx: f.from.cx + (f.to.cx - f.from.cx) * e,
        cy: f.from.cy + (f.to.cy - f.from.cy) * e,
        // Interpolate zoom geometrically so it feels even.
        scale: f.from.scale * Math.pow(f.to.scale / f.from.scale, e),
      };
      if (p >= 1) fly.current = null;
      scheduleLoadRef.current();
    }

    const rev = revealing.current;
    if (rev && now - rev.start >= REVEAL_MS) revealing.current = null;

    draw(now);
    dirty.current = false;

    if (fly.current || revealing.current || pulsing.current) requestDraw();
  };

  // ---- Loading splats for the viewport -----------------------------------------------------------
  const loadView = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const { w, h } = viewSize.current;
    if (!w || !h) return;
    const c = cam.current;
    const halfW = w / 2 / c.scale;
    const halfH = h / 2 / c.scale;
    const pad = SIZE_MAX * 2.4; // so splats just outside the screen still get drawn
    const view: Rect = {
      minX: Math.max(0, c.cx - halfW - pad),
      maxX: Math.min(WORLD_SIZE, c.cx + halfW + pad),
      minY: Math.max(0, c.cy - halfH - pad),
      maxY: Math.min(WORLD_SIZE, c.cy + halfH + pad),
    };
    const have = loadedRect.current;
    if (have && view.minX >= have.minX && view.maxX <= have.maxX && view.minY >= have.minY && view.maxY <= have.maxY) {
      return;
    }

    // Fetch a bit more than needed so small pans don't trigger another request.
    const ex = (view.maxX - view.minX) * 0.4;
    const ey = (view.maxY - view.minY) * 0.4;
    const rect: Rect = {
      minX: Math.max(0, view.minX - ex),
      maxX: Math.min(WORLD_SIZE, view.maxX + ex),
      minY: Math.max(0, view.minY - ey),
      maxY: Math.min(WORLD_SIZE, view.maxY + ey),
    };

    const token = ++loadToken.current;
    const supabase = getSupabaseBrowser();
    let from = 0;
    let total = 0;
    let complete = true;

    for (;;) {
      const { data, error } = await supabase
        .from("splats")
        .select(SPLAT_COLUMNS)
        .gte("x", rect.minX)
        .lte("x", rect.maxX)
        .gte("y", rect.minY)
        .lte("y", rect.maxY)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);

      if (error || !data) {
        complete = false;
        break;
      }
      for (const row of data as SplatRow[]) splats.current.set(row.id, row);
      total += data.length;
      sortedDirty.current = true;
      requestDraw();
      if (data.length < PAGE) break;
      if (total >= MAX_LOAD) {
        complete = false;
        break;
      }
      if (token !== loadToken.current) return; // a newer request took over
      from += PAGE;
    }

    if (complete && token === loadToken.current) loadedRect.current = rect;
  }, [requestDraw]);

  const scheduleLoad = useCallback(() => {
    if (loadTimer.current !== null) window.clearTimeout(loadTimer.current);
    loadTimer.current = window.setTimeout(() => {
      loadTimer.current = null;
      void loadView();
    }, 150);
  }, [loadView]);
  const scheduleLoadRef = useRef(scheduleLoad);
  scheduleLoadRef.current = scheduleLoad;

  const upsertSplat = useCallback(
    (row: SplatRow) => {
      const existing = splats.current.has(row.id);
      splats.current.set(row.id, row);
      if (!existing) {
        const last = sorted.current[sorted.current.length - 1];
        if (!sortedDirty.current && (!last || row.created_at >= last.created_at)) sorted.current.push(row);
        else sortedDirty.current = true;
      }
      requestDraw();
    },
    [requestDraw],
  );

  // ---- Imperative controls -----------------------------------------------------------------------
  const flyToCamera = useCallback(
    (target: Camera) => {
      interacted.current = true;
      const to = { ...target };
      to.scale = clamp(to.scale, minScale(), MAX_ZOOM);
      to.cx = clamp(to.cx, 0, WORLD_SIZE);
      to.cy = clamp(to.cy, 0, WORLD_SIZE);
      fly.current = { from: { ...cam.current }, to, start: performance.now() };
      requestDraw();
    },
    [minScale, requestDraw],
  );

  const targetScaleFor = useCallback(
    (seed: number) => clamp(110 / getRendered(seed).splat.size, minScale(), MAX_ZOOM),
    [minScale],
  );

  useImperativeHandle(
    ref,
    () => ({
      flyTo: (x, y, scale) => flyToCamera({ cx: x, cy: y, scale: scale ?? cam.current.scale }),
      fit: () => {
        const { w, h } = viewSize.current;
        flyToCamera(computeFit(w, h, false));
      },
      zoomBy: (factor) => {
        const c = cam.current;
        flyToCamera({ ...c, scale: c.scale * factor });
      },
      highlight: (id) => {
        pulsing.current = { id, start: performance.now() };
        requestDraw();
      },
      focusSplat: (row) => {
        upsertSplat(row);
        flyToCamera({ cx: row.x, cy: row.y, scale: targetScaleFor(row.seed) });
        pulsing.current = { id: row.id, start: performance.now() };
        requestDraw();
      },
    }),
    [flyToCamera, requestDraw, targetScaleFor, upsertSplat],
  );

  // ---- Setup: sizing, theme, realtime ------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const readTheme = () => {
      const s = getComputedStyle(document.documentElement);
      const get = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
      theme.current = {
        wall: get("--wall", "#f6f6f3"),
        gesso: get("--gesso", "#e8eae5"),
        ink: get("--ink", "#15171b"),
        rule: get("--rule", "#d3d6d0"),
      };
      requestDraw();
    };
    readTheme();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    scheme.addEventListener("change", readTheme);

    const resize = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const first = viewSize.current.w === 0;
      viewSize.current = { w, h, dpr };
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      if (first || preview || !interacted.current) cam.current = computeFit(w, h, preview);
      clampCamera();
      requestDraw();
      scheduleLoadRef.current();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    let channel: ReturnType<ReturnType<typeof getSupabaseBrowser>["channel"]> | null = null;
    let supabase: ReturnType<typeof getSupabaseBrowser> | null = null;
    if (isSupabaseConfigured) {
      supabase = getSupabaseBrowser();
      channel = supabase
        .channel(`splats-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "splats" }, (payload) => {
          upsertSplat(payload.new as SplatRow);
        })
        .subscribe();
    }

    return () => {
      scheme.removeEventListener("change", readTheme);
      observer.disconnect();
      if (channel && supabase) supabase.removeChannel(channel);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      if (loadTimer.current !== null) window.clearTimeout(loadTimer.current);
    };
  }, [preview, clampCamera, requestDraw, upsertSplat]);

  // ---- Reveal and deep-link focus ----------------------------------------------------------------
  const revealId = props.reveal?.id;
  useEffect(() => {
    const row = propsRef.current.reveal;
    if (!row) return;
    upsertSplat(row);
    revealing.current = { id: row.id, start: performance.now() };
    flyToCamera({ cx: row.x, cy: row.y, scale: targetScaleFor(row.seed) });
  }, [revealId, upsertSplat, flyToCamera, targetScaleFor]);

  const focusId = props.focus?.id;
  useEffect(() => {
    const row = propsRef.current.focus;
    if (!row) return;
    upsertSplat(row);
    flyToCamera({ cx: row.x, cy: row.y, scale: targetScaleFor(row.seed) });
    pulsing.current = { id: row.id, start: performance.now() };
    requestDraw();
  }, [focusId, upsertSplat, flyToCamera, targetScaleFor, requestDraw]);

  // Redraw when overlay props change.
  const pendingKey = props.pending ? `${props.pending.x}:${props.pending.y}` : "";
  useEffect(() => {
    requestDraw();
  }, [pendingKey, props.ownSplatId, requestDraw]);

  // ---- Input (full mode only) --------------------------------------------------------------------
  const hitTest = useCallback(
    (sx: number, sy: number): SplatRow | null => {
      const [wx, wy] = screenToWorld(sx, sy);
      const slack = 8 / cam.current.scale;
      const list = sorted.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const row = list[i];
        const radius = Math.max(getRendered(row.seed).splat.size * 0.95, slack);
        if (Math.abs(row.x - wx) > radius || Math.abs(row.y - wy) > radius) continue;
        if (Math.hypot(row.x - wx, row.y - wy) <= radius) return row;
      }
      return null;
    },
    [screenToWorld],
  );

  const fetchOwner = useCallback((id: string) => {
    if (ownerRequested.current.has(id) || !isSupabaseConfigured) return;
    ownerRequested.current.add(id);
    void getSupabaseBrowser()
      .rpc("splat_owner", { p_splat_id: id })
      .then(({ data }) => setOwners((prev) => ({ ...prev, [id]: (data as SplatOwner | null) ?? null })));
  }, []);

  useEffect(() => {
    if (preview) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: { startX: number; startY: number; startT: number; lastX: number; lastY: number; moved: boolean } | null =
      null;
    let pinch: { dist: number; scale: number } | null = null;
    let hoverQueued = false;

    const local = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const zoomAt = (sx: number, sy: number, factor: number) => {
      const { w, h } = viewSize.current;
      const c = cam.current;
      const [wx, wy] = screenToWorld(sx, sy);
      const next = clamp(c.scale * factor, minScale(), MAX_ZOOM);
      c.scale = next;
      c.cx = wx - (sx - w / 2) / next;
      c.cy = wy - (sy - h / 2) / next;
      clampCamera();
      requestDraw();
      scheduleLoadRef.current();
    };

    const showTip = (row: SplatRow, x: number, y: number) => {
      setTip({ id: row.id, x, y });
      fetchOwner(row.id);
    };

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      fly.current = null;
      interacted.current = true;
      if (pointers.size === 1) {
        gesture = { startX: p.x, startY: p.y, startT: performance.now(), lastX: p.x, lastY: p.y, moved: false };
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: cam.current.scale };
        if (gesture) gesture.moved = true;
        setTip(null);
      }
    };

    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);

      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const target = clamp(pinch.scale * (dist / pinch.dist), minScale(), MAX_ZOOM);
        zoomAt(mid.x, mid.y, target / cam.current.scale);
        return;
      }

      if (gesture && pointers.size === 1 && (e.buttons & 1 || e.pointerType !== "mouse")) {
        if (!gesture.moved && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > 6) {
          gesture.moved = true;
          setTip(null);
        }
        if (gesture.moved) {
          const c = cam.current;
          c.cx -= (p.x - gesture.lastX) / c.scale;
          c.cy -= (p.y - gesture.lastY) / c.scale;
          clampCamera();
          requestDraw();
          scheduleLoadRef.current();
        }
        gesture.lastX = p.x;
        gesture.lastY = p.y;
        return;
      }

      if (e.pointerType === "mouse" && !hoverQueued) {
        hoverQueued = true;
        requestAnimationFrame(() => {
          hoverQueued = false;
          const hit = hitTest(p.x, p.y);
          if (hit) showTip(hit, p.x, p.y);
          else setTip(null);
        });
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = local(e);
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;

      if (gesture && pointers.size === 0) {
        const quick = performance.now() - gesture.startT < 600;
        if (!gesture.moved && quick) {
          const opts = propsRef.current;
          if (opts.placementEnabled) {
            const [wx, wy] = screenToWorld(p.x, p.y);
            opts.onPick?.(clamp(wx, 0, WORLD_SIZE), clamp(wy, 0, WORLD_SIZE));
          } else {
            const hit = hitTest(p.x, p.y);
            if (hit) showTip(hit, p.x, p.y);
            else setTip(null);
          }
        }
        gesture = null;
      } else if (gesture && pointers.size === 1) {
        // One finger lifted mid-pinch: carry on panning with the other without a jump.
        const [rest] = [...pointers.values()];
        gesture.lastX = rest.x;
        gesture.lastY = rest.y;
        gesture.moved = true;
      }
    };

    const onCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = null;
      if (pointers.size === 0) gesture = null;
    };

    const onLeave = (e: PointerEvent) => {
      if (e.pointerType === "mouse") setTip(null);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      fly.current = null;
      interacted.current = true;
      const p = local(e);
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(p.x, p.y, Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015)));
    };

    const onKey = (e: KeyboardEvent) => {
      const c = cam.current;
      const step = 90 / c.scale;
      let handled = true;
      switch (e.key) {
        case "ArrowLeft":
          c.cx -= step;
          break;
        case "ArrowRight":
          c.cx += step;
          break;
        case "ArrowUp":
          c.cy -= step;
          break;
        case "ArrowDown":
          c.cy += step;
          break;
        case "+":
        case "=":
          c.scale *= 1.25;
          break;
        case "-":
        case "_":
          c.scale /= 1.25;
          break;
        case "0": {
          const { w, h } = viewSize.current;
          Object.assign(c, computeFit(w, h, false));
          break;
        }
        default:
          handled = false;
      }
      if (handled) {
        e.preventDefault();
        interacted.current = true;
        clampCamera();
        requestDraw();
        scheduleLoadRef.current();
      }
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("keydown", onKey);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("keydown", onKey);
    };
  }, [preview, clampCamera, fetchOwner, hitTest, minScale, requestDraw, screenToWorld]);

  // ---- Tooltip -----------------------------------------------------------------------------------
  const tipRow = tip ? splats.current.get(tip.id) : undefined;
  const tipOwner = tip ? owners[tip.id] : undefined;
  const isOwn = tip && props.ownSplatId === tip.id;
  const wrapW = wrapRef.current?.clientWidth ?? 0;

  return (
    <div ref={wrapRef} className={`overflow-hidden ${className ?? "relative"}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="A shared canvas covered in colorful paint splats, one placed by each person"
        tabIndex={preview ? -1 : 0}
        className={`block h-full w-full ${preview ? "pointer-events-none" : "cursor-grab touch-none active:cursor-grabbing"}`}
      />
      {tip && tipRow && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-max max-w-[220px] rounded-[4px] border border-rule bg-wall px-3 py-2 text-sm shadow-[0_6px_24px_-8px_rgba(0,0,0,0.35)]"
          style={{
            left: clamp(tip.x + 14, 8, Math.max(8, wrapW - 228)),
            top: Math.max(8, tip.y - 56),
          }}
        >
          <p className="font-semibold">
            {isOwn
              ? "Your mark"
              : tipOwner === undefined
                ? "…"
                : tipOwner?.username
                  ? `@${tipOwner.username}`
                  : "Anonymous contributor"}
          </p>
          <p className="text-graphite">
            {new Date(tipRow.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      )}
    </div>
  );
});
