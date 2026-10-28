import type { Backend, CanvasInfo, Connection, LiveMessage, Me } from "@/lib/backend/types";
import { friendlyError } from "@/lib/backend/types";
import { paintStroke, polyPath } from "@/lib/paint/brushes";
import { strokeOutline } from "@/lib/paint/geometry";
import {
  clampCamera,
  fitCamera,
  frameRect,
  toWorld,
  visibleWorld,
  zoomAt,
  type Camera,
  type Viewport,
} from "@/lib/paint/camera";
import { decodePoints, encodePoints, MAX_POINTS, quantize, type InkPoint } from "@/lib/paint/codec";
import { distanceToPath } from "@/lib/paint/geometry";
import { afterStroke, inkBalance, secondsUntilPaint, strokeCost, type InkLevel } from "@/lib/paint/ink";
import { ChunkRenderer, lodFor, type TileSource } from "@/lib/paint/renderer";
import { PaintSound } from "@/lib/paint/sound";
import { StrokeStore, rowToStroke, type StrokeRow } from "@/lib/paint/store";
import { seedFor, strokeBounds, type BBox, type Stroke } from "@/lib/paint/stroke";
import { TEX_PX, TEX_WORLD, getTextures } from "@/lib/paint/textures";
import { FONTS, type FontId, type ToolId } from "@/lib/paint/tools";

export type Brush = { tool: ToolId; color: string; size: number; opacity: number; font: FontId };
export type Mode = "paint" | "look" | "eyedropper";
export type BlockReason = "signin" | "verify" | "onboard" | "banned" | "closed" | "notyet" | "loading";

export type EngineEvents = {
  /** Something about ink, undo or presence changed. */
  status: (s: EngineStatus) => void;
  /** Someone tapped/hovered a stroke in Look mode (null = nothing there). */
  pick: (p: { stroke: Stroke; x: number; y: number; username: string | null } | null) => void;
  /** Painting isn't possible right now; the UI explains why. */
  blocked: (reason: BlockReason) => void;
  toast: (message: string) => void;
  /** Text tool: user tapped where the words should go. */
  placeText: (p: { wx: number; wy: number; sx: number; sy: number }) => void;
  colorPicked: (hex: string) => void;
  /** The view moved (used to position overlays such as the text composer). */
  view: (cam: Camera) => void;
  /** Request to change brush size from the keyboard. */
  sizeStep: (dir: 1 | -1) => void;
  /** Keyboard tool shortcut. */
  toolKey: (key: string) => void;
};

export type EngineStatus = {
  ink: number;
  capacity: number;
  refillIn: number;
  canUndo: boolean;
  canRedo: boolean;
  painting: number;
  loading: boolean;
};

const CELL = 2048;
/** Below this zoom you're looking at the whole wall; a tap walks you up to the canvas instead of painting. */
export const PAINT_MIN_SCALE = 0.42;
const PAINT_SCALE = 1.15;
const LOOK_TAP_PX = 7;

type Ghost = {
  artist: number;
  username: string;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  points: InkPoint[];
  seed: number;
  lastAt: number;
  doneAt: number | null;
};

type Live = {
  pointerId: number;
  points: InkPoint[];
  raw: { x: number; y: number; t: number }[];
  pressure: number;
  pen: boolean;
  t0: number;
  key: string;
  sent: number;
  lastSend: number;
  ink: number;
  /** Where the pointer is about to be (browser prediction): drawn ahead of the real points, never saved. */
  predicted: InkPoint[];
};

export class StudioEngine {
  readonly store = new StrokeStore();
  private renderer: ChunkRenderer;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Separate on-screen layer for the stroke being painted and other people's live strokes, so painting
   * never has to redraw the whole canvas. */
  private overlay = document.createElement("canvas");
  private octx: CanvasRenderingContext2D;
  private overlayDirty: { x: number; y: number; w: number; h: number }[] = [];
  private needsOverlay = true;
  private liveLayer = document.createElement("canvas");
  private blockLayer = document.createElement("canvas");
  private dpr = 1;
  private vp: Viewport = { w: 1, h: 1, insetTop: 0, insetBottom: 0 };
  private cam: Camera = { cx: 0, cy: 0, scale: 1 };
  private anim: { from: Camera; to: Camera; t0: number; dur: number } | null = null;
  private velocity = { x: 0, y: 0 };
  private raf = 0;
  private needsFrame = true;
  private destroyed = false;

  private me: Me | null = null;
  private brush: Brush = { tool: "pencil", color: "#1f1d1b", size: 3, opacity: 0.9, font: "hand" };
  private mode: Mode = "look";
  private inkLevel: InkLevel = { ink: null, at: null };
  private painting = 1;
  private undoStack: number[] = [];
  private redoStack: number[] = [];
  private pendingByPoints = new Map<string, number>();
  private seq = 0;

  private pointers = new Map<number, { x: number; y: number; type: string; sx: number; sy: number; t0: number }>();
  private live: Live | null = null;
  private pan: { id: number; lastX: number; lastY: number; lastT: number; moved: number; tap: boolean } | null = null;
  private pinch: { dist: number; mid: { x: number; y: number } } | null = null;
  private penSeen = false;
  private spaceDown = false;
  private hoverTimer = 0;

  private cells = new Map<string, "loading" | "ready">();
  private loadTimer = 0;
  private conn: Connection | null = null;
  private ghosts = new Map<string, Ghost>();
  private names = new Map<number, string>();
  private spotlightRects: BBox[] | null = null;
  private sound = new PaintSound();
  private fontsReady = false;

  constructor(
    private host: HTMLElement,
    private backend: Backend,
    private info: CanvasInfo,
    private events: EngineEvents,
    private opts: { preview?: boolean } = {},
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block h-full w-full touch-none select-none";
    this.canvas.setAttribute("aria-label", `${info.title}. A shared canvas.`);
    this.canvas.setAttribute("role", "img");
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d", { alpha: false })!;
    this.overlay.className = "pointer-events-none absolute inset-0 block h-full w-full";
    this.overlay.setAttribute("aria-hidden", "true");
    host.appendChild(this.overlay);
    // `desynchronized` lets the browser show the live stroke without waiting for the page compositor:
    // the brush mark appears under your finger a frame sooner (Chrome/Android; ignored elsewhere).
    this.octx = (this.overlay.getContext("2d", { desynchronized: true }) ?? this.overlay.getContext("2d"))!;
    // Warm up the sound engine on the very first touch anywhere (choosing a tool, closing the hints),
    // so it never costs anything when the brush first meets the canvas.
    window.addEventListener("pointerdown", this.warmUp, { capture: true, once: true });
    this.renderer = new ChunkRenderer(this.store, info, (b, lod) => this.regionReady(b, lod));
    this.renderer.onChange = () => this.request();

    this.resize();
    this.cam = fitCamera(info, this.vp);
    // Local test mode: expose the engine for debugging from the browser console.
    if (backend.mode === "local") (window as unknown as { __oneart?: StudioEngine }).__oneart = this;
    getTextures();

    if (!opts.preview) this.bindInput();
    window.addEventListener("resize", this.resize);
    void this.loadFonts();
    this.scheduleLoad();
    this.loop();
  }

  // ---- Public API -------------------------------------------------------------------------------

  start(me: Me | null) {
    this.setMe(me);
    void this.setupTiles();
    this.conn = this.backend.connect(this.info.id, me ? { artist: me.artistNo, username: me.username } : null, {
      onInsert: (row) => this.onInsert(row),
      onUpdate: (row) => this.onUpdate(row),
      onLive: (msg) => this.onLive(msg),
      onPresence: (n) => {
        this.painting = Math.max(1, n);
        this.emitStatus();
      },
      onResync: () => this.resync(),
    });
  }

  setMe(me: Me | null) {
    this.me = me;
    this.inkLevel = { ink: me?.ink ?? null, at: me?.inkAt ?? null };
    if (me) this.names.set(me.artistNo, me.username);
    this.emitStatus();
  }

  setBrush(b: Brush) {
    this.brush = b;
  }

  setMode(m: Mode) {
    this.mode = m;
    this.canvas.style.cursor = m === "look" ? "grab" : m === "eyedropper" ? "copy" : "crosshair";
  }

  setInsets(top: number, bottom: number) {
    this.vp = { ...this.vp, insetTop: top, insetBottom: bottom };
  }

  setSound(on: boolean) {
    this.sound.enabled = on;
  }

  get camera() {
    return this.cam;
  }

  get viewport() {
    return this.vp;
  }

  get canvasInfo() {
    return this.info;
  }

  isOpen(now = Date.now()) {
    return now >= Date.parse(this.info.opensAt) && now < Date.parse(this.info.closesAt);
  }

  /** Why the current user can't paint, or null if they can. */
  blockReason(): BlockReason | null {
    const now = Date.now();
    if (now < Date.parse(this.info.opensAt)) return "notyet";
    if (now >= Date.parse(this.info.closesAt)) return "closed";
    if (!this.me) return "signin";
    if (this.me.banned) return "banned";
    if (!this.me.emailVerified) return "verify";
    if (!this.me.onboarded) return "onboard";
    return null;
  }

  fit() {
    this.flyTo(fitCamera(this.info, this.vp));
  }

  zoomBy(f: number) {
    // Repeated presses keep zooming from where the last one was heading.
    const from = this.anim ? this.anim.to : this.cam;
    this.flyTo(clampCamera(zoomAt(from, this.vp, this.vp.w / 2, this.vp.h / 2, f), this.info, this.vp), 220);
  }

  /** Close enough to paint? Far away, a brush would be smaller than a pixel. */
  closeEnough() {
    return this.cam.scale >= PAINT_MIN_SCALE;
  }

  /** Walk up to the canvas: fly in to a comfortable painting distance at a screen point (default: centre). */
  approach(sx = this.vp.w / 2, sy = this.vp.h / 2) {
    const w = toWorld(this.cam, this.vp, sx, sy);
    const scale = PAINT_SCALE;
    const target = { scale, cx: w.x - (sx - this.vp.w / 2) / scale, cy: w.y - (sy - this.vp.h / 2) / scale };
    this.flyTo(clampCamera(target, this.info, this.vp), 650);
  }

  frame(rects: BBox[], maxScale = 2) {
    if (!rects.length) return;
    const u = rects.reduce((a, r) => ({
      minX: Math.min(a.minX, r.minX),
      minY: Math.min(a.minY, r.minY),
      maxX: Math.max(a.maxX, r.maxX),
      maxY: Math.max(a.maxY, r.maxY),
    }));
    this.flyTo(clampCamera(frameRect(u, this.vp, maxScale), this.info, this.vp));
  }

  spotlight(rects: BBox[] | null) {
    this.spotlightRects = rects;
    this.request();
  }

  async undo() {
    const id = this.undoStack.pop();
    if (id == null) return;
    this.redoStack.push(id);
    await this.setErased(id, true);
  }

  async redo() {
    const id = this.redoStack.pop();
    if (id == null) return;
    this.undoStack.push(id);
    await this.setErased(id, false);
  }

  /** Erase one of your own strokes (from the "you painted this" card). */
  async erase(id: number) {
    this.undoStack = this.undoStack.filter((x) => x !== id);
    await this.setErased(id, true);
  }

  async placeText(wx: number, wy: number, body: string) {
    const text = body.replace(/[\r\n\t]+/g, " ").trim().slice(0, 200);
    if (!text) return;
    const reason = this.blockReason();
    if (reason) return this.events.blocked(reason);
    const pt = quantize([{ x: clampTo(wx, 0, this.info.width), y: clampTo(wy, 0, this.info.height), p: 0.5 }]);
    await this.commit(pt, { ...this.brush, tool: "text" }, text);
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.tileTimer);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("pointerdown", this.warmUp, { capture: true });
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    this.conn?.close();
    this.sound.stop(true);
    this.canvas.remove();
    this.overlay.remove();
  }

  // ---- Status ------------------------------------------------------------------------------------

  private settings() {
    return { capacity: this.info.inkCapacity, refillSeconds: this.info.inkRefillSeconds };
  }

  inkNow() {
    return inkBalance(this.inkLevel, this.settings(), Date.now());
  }

  emitStatus() {
    const ink = this.inkNow();
    this.events.status({
      ink,
      capacity: this.info.inkCapacity,
      refillIn: secondsUntilPaint(ink, this.settings()),
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      painting: this.painting,
      loading: [...this.cells.values()].some((v) => v === "loading"),
    });
  }

  // ---- Loading -----------------------------------------------------------------------------------

  private regionReady(b: BBox, lod: number) {
    if (this.renderer.tiled(lod)) return this.recentLoaded;
    const x0 = Math.floor(Math.max(0, b.minX) / CELL);
    const y0 = Math.floor(Math.max(0, b.minY) / CELL);
    const x1 = Math.floor(Math.min(this.info.width - 1, b.maxX) / CELL);
    const y1 = Math.floor(Math.min(this.info.height - 1, b.maxY) / CELL);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (this.cells.get(`${x},${y}`) !== "ready") return false;
    return true;
  }

  private scheduleLoad() {
    clearTimeout(this.loadTimer);
    this.loadTimer = window.setTimeout(() => this.loadVisible(), 90);
  }

  private loadVisible() {
    // Wait until we know whether baked tiles exist, so a far-zoom first view never pulls every stroke.
    if (!this.tilesChecked) return;
    // Zoomed far out over baked tiles: only the strokes newer than the bake are needed.
    if (this.renderer.tiled(lodFor(this.cam.scale * this.dpr))) {
      if (!this.recentLoaded && !this.recentLoading) void this.loadRecent();
      return;
    }
    const v = visibleWorld(this.cam, this.vp);
    const padX = (v.maxX - v.minX) * 0.25;
    const padY = (v.maxY - v.minY) * 0.25;
    const x0 = Math.max(0, Math.floor((v.minX - padX) / CELL));
    const y0 = Math.max(0, Math.floor((v.minY - padY) / CELL));
    const x1 = Math.min(Math.ceil(this.info.width / CELL) - 1, Math.floor((v.maxX + padX) / CELL));
    const y1 = Math.min(Math.ceil(this.info.height / CELL) - 1, Math.floor((v.maxY + padY) / CELL));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!this.cells.has(`${x},${y}`)) void this.loadCell(x, y);
  }

  private async loadCell(x: number, y: number, refresh = false) {
    const key = `${x},${y}`;
    if (!refresh) this.cells.set(key, "loading");
    this.emitStatus();
    const box = { minX: x * CELL, minY: y * CELL, maxX: (x + 1) * CELL, maxY: (y + 1) * CELL };
    for (let attempt = 0; attempt < 4 && !this.destroyed; attempt++) {
      try {
        const rows = await this.backend.loadStrokes(this.info.id, box);
        let changed = false;
        for (const row of rows) changed = this.upsert(row) || changed;
        this.cells.set(key, "ready");
        if (changed || !refresh) this.renderer.invalidateRegion(box);
        void this.fetchNames(rows.map((r) => r.artist_no));
        this.emitStatus();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1) ** 2));
      }
    }
    this.cells.delete(key);
    this.events.toast("Part of the canvas didn't load. Check your connection.");
  }

  // ---- Baked tiles ---------------------------------------------------------------------------------

  private tilesChecked = false;
  private recentLoaded = false;
  private recentLoading = false;
  private tileBase = 0;
  private tileBakedAt = "";
  private tileTimer = 0;

  private async setupTiles() {
    const t = await this.backend.tileManifest(this.info.id).catch(() => null);
    if (this.destroyed) return;
    if (!t) {
      this.renderer.setTiles(null);
    } else if (t.manifest.bakedAt !== this.tileBakedAt) {
      const images = new Map<string, HTMLImageElement | null>();
      const lods = new Set(t.manifest.lods);
      const source: TileSource = {
        maxLod: Math.max(...t.manifest.lods),
        baseOrder: t.manifest.maxId,
        get: (lod, x, y) => {
          if (!lods.has(lod)) return null;
          const key = `${lod}:${x}:${y}`;
          const have = images.get(key);
          if (have !== undefined) return have && have.complete && have.naturalWidth ? have : null;
          const url = t.tileUrl(lod, x, y);
          if (!url) {
            images.set(key, null);
            return null;
          }
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.decoding = "async";
          img.onload = () => this.request();
          img.onerror = () => images.set(key, null);
          img.src = url;
          images.set(key, img);
          return null;
        },
      };
      this.tileBase = t.manifest.maxId;
      this.tileBakedAt = t.manifest.bakedAt;
      this.recentLoaded = false;
      this.renderer.setTiles(source);
    }
    this.tilesChecked = true;
    this.scheduleLoad();
    clearTimeout(this.tileTimer);
    this.tileTimer = window.setTimeout(() => void this.setupTiles(), 5 * 60_000);
  }

  private async loadRecent() {
    this.recentLoading = true;
    try {
      const rows = await this.backend.loadSince(this.info.id, this.tileBase);
      for (const row of rows) this.upsert(row);
      void this.fetchNames(rows.map((r) => r.artist_no));
      this.recentLoaded = true;
      this.renderer.invalidateAll();
    } catch {
      window.setTimeout(() => this.scheduleLoad(), 3000);
    } finally {
      this.recentLoading = false;
    }
  }

  private resync() {
    this.recentLoaded = false;
    for (const key of this.cells.keys()) {
      const [x, y] = key.split(",").map(Number);
      void this.loadCell(x, y, true);
    }
  }

  /** Returns true if the store changed. */
  private upsert(row: StrokeRow): boolean {
    const prev = this.store.get(Number(row.id));
    if (prev && prev.erased === row.erased && prev.hidden === row.hidden) return false;
    const s = rowToStroke(row);
    this.store.put(s);
    return true;
  }

  private async fetchNames(nos: (number | null)[]) {
    const missing = [...new Set(nos.filter((n): n is number => n != null).map(Number))].filter((n) => !this.names.has(n));
    if (!missing.length) return;
    for (const n of missing) this.names.set(n, "");
    try {
      const got = await this.backend.artistNames(missing.slice(0, 500));
      got.forEach((v, k) => this.names.set(k, v));
    } catch {
      for (const n of missing) this.names.delete(n);
    }
  }

  async nameOf(artist: number | null): Promise<string | null> {
    if (artist == null) return null;
    const known = this.names.get(artist);
    if (known) return known;
    this.names.delete(artist);
    await this.fetchNames([artist]);
    return this.names.get(artist) || null;
  }

  // ---- Realtime ----------------------------------------------------------------------------------

  private onInsert(row: StrokeRow) {
    const id = Number(row.id);
    if (this.store.get(id)) return;
    const pending = this.pendingByPoints.get(row.points);
    if (pending != null && row.artist_no === this.me?.artistNo) {
      this.confirm(pending, row);
      return;
    }
    const s = rowToStroke(row);
    this.store.put(s);
    this.renderer.strokeChanged(s, "append");
    for (const [k, g] of this.ghosts) if (g.artist === s.artist && g.doneAt) this.ghosts.delete(k);
    void this.fetchNames([s.artist]);
  }

  private onUpdate(row: StrokeRow) {
    const prev = this.store.get(Number(row.id));
    const s = rowToStroke(row);
    this.store.put(s);
    if (prev) this.renderer.invalidateRegion(prev.bbox);
    this.renderer.strokeChanged(s, "rebuild");
  }

  private onLive(msg: LiveMessage) {
    if (this.opts.preview || msg.artist === this.me?.artistNo) return;
    let g = this.ghosts.get(msg.key);
    if (!g) {
      g = {
        artist: msg.artist,
        username: msg.username,
        tool: msg.tool,
        color: msg.color,
        size: msg.size,
        opacity: msg.opacity,
        points: [],
        seed: 1,
        lastAt: 0,
        doneAt: null,
      };
      this.ghosts.set(msg.key, g);
      this.names.set(msg.artist, msg.username);
    }
    if (msg.pts) {
      const pts = decodePoints(msg.pts);
      if (msg.from < g.points.length) g.points.length = msg.from;
      g.points.push(...pts);
      g.seed = seedFor(g.points);
    }
    g.lastAt = performance.now();
    if (msg.done) g.doneAt = performance.now();
    this.needsOverlay = true;
  }

  // ---- Painting ----------------------------------------------------------------------------------

  private startStroke(e: PointerEvent) {
    const reason = this.blockReason();
    if (reason) {
      this.events.blocked(reason);
      return false;
    }
    const ink = this.inkNow();
    if (ink <= this.info.inkCapacity * 0.002) {
      const wait = secondsUntilPaint(ink, this.settings());
      this.events.toast(`Your paint is drying. Ready again in ${Math.max(1, Math.ceil(wait / 60))} min.`);
      return false;
    }
    const w = this.worldAt(e);
    const pen = e.pointerType === "pen";
    const p = pen ? (e.pressure > 0 ? e.pressure : 0.5) : 0.55;
    this.live = {
      pointerId: e.pointerId,
      points: [{ x: w.x, y: w.y, p }],
      raw: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }],
      pressure: p,
      pen,
      t0: performance.now(),
      key: `${this.me?.artistNo ?? 0}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      sent: 0,
      lastSend: 0,
      ink,
      predicted: [],
    };
    const blockCtx = this.blockLayer.getContext("2d")!;
    this.renderer.buildBlockedMask(blockCtx, this.cam, this.vp, this.dpr, this.me!.artistNo);
    // Paint first, everything else after: the dab is on screen before anything else runs.
    this.drawOverlay();
    this.needsOverlay = false;
    this.sound.start(this.brush.tool, p, (e.clientX - this.rect.left) / Math.max(1, this.vp.w));
    return true;
  }

  private extendStroke(e: PointerEvent) {
    const L = this.live!;
    const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const list = events.length ? events : [e];
    let speed = 0;
    for (const ev of list) {
      const last = L.raw[L.raw.length - 1];
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;
      const dt = Math.max(1, ev.timeStamp - last.t);
      speed = dist / dt;
      L.raw.push({ x: ev.clientX, y: ev.clientY, t: ev.timeStamp });
      if (L.pen) {
        L.pressure = ev.pressure > 0 ? ev.pressure : L.pressure;
      } else {
        // No pressure sensor: fast strokes thin out, slow deliberate strokes lay down more paint.
        const target = Math.max(0.22, Math.min(1, 1.02 - speed * 0.3));
        L.pressure += (target - L.pressure) * 0.28;
      }
      const w = this.worldAt(ev);
      L.points.push({ x: w.x, y: w.y, p: L.pressure });
      if (L.points.length >= MAX_POINTS - 2) {
        // Very long gesture: save what we have and keep painting seamlessly.
        const carry = L.points[L.points.length - 1];
        void this.finishStroke(false);
        this.continueStroke(e, carry);
        return;
      }
    }
    // Draw a few milliseconds ahead along the browser's predicted path, so the paint keeps up with a fast
    // finger. Predicted points are only shown; the saved stroke uses the real ones.
    const predicted = typeof e.getPredictedEvents === "function" ? e.getPredictedEvents() : [];
    L.predicted = predicted.slice(0, 3).map((ev) => ({ ...this.worldAt(ev), p: L.pressure }));
    // Show it now, unless we drew a moment ago (fast pens send 240 events a second): then the next frame does.
    const t = performance.now();
    if (t - this.lastLiveDraw > 6) {
      this.drawOverlay();
      this.needsOverlay = false;
    } else {
      this.needsOverlay = true;
    }
    const last = L.raw[L.raw.length - 1];
    this.sound.update(speed, L.pressure, (last.x - this.rect.left) / Math.max(1, this.vp.w));
    this.sendLive(false);
  }

  private continueStroke(e: PointerEvent, from: InkPoint) {
    if (!this.startStroke(e)) return;
    this.live!.points = [from];
  }

  private sendLive(done: boolean) {
    const L = this.live;
    if (!L || !this.conn || !this.me) return;
    const now = performance.now();
    if (!done && now - L.lastSend < 80) return;
    const fresh = L.points.slice(L.sent);
    if (!fresh.length && !done) return;
    this.conn.sendLive({
      key: L.key,
      artist: this.me.artistNo,
      username: this.me.username,
      tool: this.brush.tool,
      color: this.brush.color,
      size: this.brush.size,
      opacity: this.brush.opacity,
      from: L.sent,
      pts: fresh.length ? encodePoints(quantize(fresh)) : "",
      done,
    });
    L.sent = L.points.length;
    L.lastSend = now;
  }

  private cancelStroke() {
    if (!this.live) return;
    this.sendLive(true);
    this.live = null;
    this.sound.stop(true);
    this.needsOverlay = true;
  }

  private async finishStroke(cancelled: boolean) {
    const L = this.live;
    if (!L) return;
    this.sendLive(true);
    this.live = null;
    this.sound.stop();
    this.needsOverlay = true;
    if (cancelled && L.points.length < 3) return;
    await this.commit(quantize(L.points), this.brush);
  }

  private async commit(points: InkPoint[], brush: Brush, body?: string) {
    if (!this.me) return;
    const tool = brush.tool;
    const encoded = encodePoints(points);
    const tempId = -++this.seq;
    const bbox = strokeBounds(tool, brush.size, points, body);
    const stroke: Stroke = {
      id: tempId,
      order: 1e15 + this.seq,
      artist: this.me.artistNo,
      tool,
      color: brush.color,
      size: brush.size,
      opacity: brush.opacity,
      points,
      body,
      font: tool === "text" ? brush.font : undefined,
      bbox,
      erased: false,
      hidden: false,
      seed: seedFor(points),
      createdAt: new Date().toISOString(),
    };
    this.store.put(stroke);
    this.pendingByPoints.set(encoded, tempId);
    this.renderer.strokeChanged(stroke, "append");

    const before = this.inkLevel;
    const cost = strokeCost(tool, brush.size, points, body);
    this.inkLevel = { ink: afterStroke(this.inkNow(), cost, this.settings()), at: Date.now() };
    this.redoStack = [];
    this.emitStatus();

    try {
      const row = await this.backend.drawStroke(this.info.id, {
        tool,
        color: brush.color,
        size: brush.size,
        opacity: brush.opacity,
        points: encoded,
        body,
        font: tool === "text" ? brush.font : undefined,
      });
      if (this.pendingByPoints.get(encoded) === tempId) this.confirm(tempId, row);
      this.undoStack.push(Number(row.id));
      if (this.undoStack.length > 200) this.undoStack.shift();
      this.emitStatus();
    } catch (err) {
      this.pendingByPoints.delete(encoded);
      this.store.remove(tempId);
      this.renderer.strokeChanged(stroke, "rebuild");
      this.inkLevel = before;
      const code = err instanceof Error ? err.message : String(err);
      if (code.includes("out_of_ink")) this.inkLevel = { ink: 0, at: Date.now() };
      this.events.toast(friendlyError(code));
      this.emitStatus();
    }
  }

  private confirm(tempId: number, row: StrokeRow) {
    const temp = this.store.get(tempId);
    this.pendingByPoints.delete(row.points);
    this.store.remove(tempId);
    const s = rowToStroke(row);
    this.store.put(s);
    if (temp) {
      // Paint order changed from "last" to its real place; repaint only if that matters.
      this.renderer.strokeConfirmed(s);
    } else {
      this.renderer.strokeChanged(s, "append");
    }
  }

  private async setErased(id: number, erased: boolean) {
    const s = this.store.get(id);
    if (!s) return;
    this.store.put({ ...s, erased });
    this.renderer.strokeChanged(s, "rebuild");
    this.emitStatus();
    try {
      await this.backend.setErased(id, erased);
    } catch (err) {
      this.store.put({ ...s, erased: !erased });
      this.renderer.strokeChanged(s, "rebuild");
      this.events.toast(friendlyError(err instanceof Error ? err.message : undefined));
    }
  }

  // ---- Looking -----------------------------------------------------------------------------------

  hitTest(sx: number, sy: number): Stroke | null {
    const w = toWorld(this.cam, this.vp, sx, sy);
    const tol = 8 / this.cam.scale;
    const near = this.store.query({ minX: w.x - tol, minY: w.y - tol, maxX: w.x + tol, maxY: w.y + tol });
    for (let i = near.length - 1; i >= 0; i--) {
      const s = near[i];
      if (s.erased || s.hidden || !s.points.length) continue;
      if (s.tool === "text") {
        if (w.x >= s.bbox.minX && w.x <= s.bbox.maxX && w.y >= s.bbox.minY && w.y <= s.bbox.maxY) return s;
      } else if (distanceToPath(s.points, w.x, w.y) <= s.size * 0.55 + tol) {
        return s;
      }
    }
    return null;
  }

  private hoverCard = false;

  private async pickAt(sx: number, sy: number, hover = false) {
    const s = this.hitTest(sx, sy);
    if (!s) {
      // Moving the mouse off a painting closes a hover card, never one that was clicked open.
      if (!hover || this.hoverCard) this.events.pick(null);
      this.hoverCard = false;
      return;
    }
    this.hoverCard = hover;
    const username = await this.nameOf(s.artist);
    this.events.pick({ stroke: s, x: sx, y: sy, username });
  }

  private pickColor(sx: number, sy: number) {
    const px = this.ctx.getImageData(Math.round(sx * this.dpr), Math.round(sy * this.dpr), 1, 1).data;
    const hex = "#" + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    this.events.colorPicked(hex);
  }

  // ---- Camera ------------------------------------------------------------------------------------

  private setCamera(c: Camera) {
    this.cam = clampCamera(c, this.info, this.vp);
    this.events.view(this.cam);
    this.scheduleLoad();
    this.request();
  }

  flyTo(to: Camera, dur = 520) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) dur = 0;
    this.velocity = { x: 0, y: 0 };
    this.anim = { from: { ...this.cam }, to, t0: performance.now(), dur };
    this.request();
  }

  private stepCamera(now: number) {
    if (this.anim) {
      const { from, to, t0, dur } = this.anim;
      const t = dur <= 0 ? 1 : Math.min(1, (now - t0) / dur);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      // Interpolate zoom geometrically so it feels even.
      const scale = from.scale * Math.pow(to.scale / from.scale, e);
      this.setCamera({ cx: from.cx + (to.cx - from.cx) * e, cy: from.cy + (to.cy - from.cy) * e, scale });
      if (t >= 1) this.anim = null;
      return true;
    }
    if (!this.pan && (Math.abs(this.velocity.x) > 0.01 || Math.abs(this.velocity.y) > 0.01)) {
      this.setCamera({
        ...this.cam,
        cx: this.cam.cx - (this.velocity.x * 16) / this.cam.scale,
        cy: this.cam.cy - (this.velocity.y * 16) / this.cam.scale,
      });
      this.velocity.x *= 0.9;
      this.velocity.y *= 0.9;
      return true;
    }
    return false;
  }

  // ---- Frame -------------------------------------------------------------------------------------

  request() {
    this.needsFrame = true;
    this.needsOverlay = true;
  }

  private loop = () => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const moving = this.stepCamera(now);
    const ghostsActive = this.tickGhosts(now);
    if (this.needsFrame || moving) {
      this.needsFrame = false;
      const pending = this.draw();
      const changed = this.renderer.work(this.live ? 4 : 9);
      if (pending || changed) this.needsFrame = true;
      this.needsOverlay = true;
    }
    if (this.needsOverlay || ghostsActive) {
      this.needsOverlay = false;
      this.drawOverlay();
    }
    // Quiet moment: get the next brush-down ready.
    if (!this.live && this.me && this.mode === "paint" && !moving) {
      this.renderer.prepareBlocked(this.cam, this.vp, this.dpr, this.me.artistNo, 2);
    }
  };

  private warmUp = () => this.sound.prepare();

  private tickGhosts(now: number) {
    let any = false;
    for (const [k, g] of this.ghosts) {
      if ((g.doneAt && now - g.doneAt > 1500) || now - g.lastAt > 5000) this.ghosts.delete(k);
      else any = true;
    }
    return any;
  }

  private draw(): boolean {
    const { ctx, dpr, cam, vp } = this;
    const W = this.info.width;
    const H = this.info.height;
    const sp = cam.scale * dpr;
    const left = cam.cx - vp.w / 2 / cam.scale;
    const top = cam.cy - vp.h / 2 / cam.scale;
    const X0 = -left * sp;
    const Y0 = -top * sp;
    const X1 = (W - left) * sp;
    const Y1 = (H - top) * sp;
    const cw = this.canvas.width;
    const ch = this.canvas.height;

    // The gallery wall, lit from above.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const wall = ctx.createRadialGradient(cw / 2, ch * 0.18, 0, cw / 2, ch * 0.4, Math.max(cw, ch) * 0.95);
    wall.addColorStop(0, "#efebe4");
    wall.addColorStop(0.55, "#e2ddd4");
    wall.addColorStop(1, "#c9c2b6");
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, cw, ch);

    // The stretched canvas: cast shadow and the depth of the stretcher bars.
    const depth = Math.max(2 * dpr, Math.min(28 * dpr, Math.min(W, H) * 0.012 * sp));
    this.drawCastShadow(X0, Y0, X1 + depth * 0.55, Y1 + depth * 0.55, depth);
    ctx.fillStyle = "#cdc3b1";
    ctx.beginPath();
    ctx.moveTo(X1, Y0);
    ctx.lineTo(X1 + depth * 0.55, Y0 + depth * 0.55);
    ctx.lineTo(X1 + depth * 0.55, Y1 + depth * 0.55);
    ctx.lineTo(X1, Y1);
    ctx.fill();
    ctx.fillStyle = "#bdb29f";
    ctx.beginPath();
    ctx.moveTo(X0, Y1);
    ctx.lineTo(X1, Y1);
    ctx.lineTo(X1 + depth * 0.55, Y1 + depth * 0.55);
    ctx.lineTo(X0 + depth * 0.55, Y1 + depth * 0.55);
    ctx.fill();

    // Primed cotton duck.
    this.drawSurface(X0, Y0, X1, Y1, sp, left, top);

    // Paint.
    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.clip();
    const pending = this.renderer.draw(ctx, cam, vp, dpr);
    ctx.restore();

    // Paint lies in the weave: the threads' light and shadow show through thin paint, like real canvas.
    this.drawRelief(X0, Y0, X1, Y1, sp, left, top);

    // Soft raking light across the surface.
    const light = ctx.createLinearGradient(X0, Y0, X1, Y1);
    light.addColorStop(0, "rgba(255, 249, 236, 0.10)");
    light.addColorStop(0.5, "rgba(255, 249, 236, 0)");
    light.addColorStop(1, "rgba(40, 28, 14, 0.08)");
    ctx.fillStyle = light;
    ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);

    // A studio lamp above your shoulder. It stays where you are, so as you move across the canvas the warm
    // pool of light slides over the paint, the way it does when you walk along a real painting.
    const lx = cw * 0.3;
    const ly = ch * 0.12;
    const lamp = ctx.createRadialGradient(lx, ly, 0, lx, ly, Math.max(cw, ch) * 0.85);
    lamp.addColorStop(0, "rgba(255, 244, 222, 0.13)");
    lamp.addColorStop(0.45, "rgba(255, 244, 222, 0.04)");
    lamp.addColorStop(1, "rgba(30, 20, 8, 0.07)");
    ctx.save();
    ctx.beginPath();
    ctx.rect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.clip();
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, cw, ch);
    ctx.restore();

    if (this.spotlightRects) this.drawSpotlight(X0, Y0, X1, Y1, sp, left, top);
    return pending;
  }

  private surfacePattern: CanvasPattern | null = null;
  private mottlePattern: CanvasPattern | null = null;

  private drawSurface(X0: number, Y0: number, X1: number, Y1: number, sp: number, left: number, top: number) {
    const { ctx } = this;
    const t = getTextures();
    this.surfacePattern ??= ctx.createPattern(t.surface, "repeat");
    this.mottlePattern ??= ctx.createPattern(t.mottle, "repeat");
    const fine = Math.max(0, Math.min(1, (sp - 0.22) / 0.25));
    ctx.save();
    if (this.mottlePattern && fine < 1) {
      const k = (4096 / TEX_PX) * sp;
      this.mottlePattern.setTransform(new DOMMatrix([k, 0, 0, k, -left * sp, -top * sp]));
      ctx.fillStyle = this.mottlePattern;
      ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    }
    if (this.surfacePattern && fine > 0) {
      const k = (TEX_WORLD / TEX_PX) * sp;
      this.surfacePattern.setTransform(new DOMMatrix([k, 0, 0, k, -left * sp, -top * sp]));
      ctx.globalAlpha = fine;
      ctx.fillStyle = this.surfacePattern;
      ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    }
    ctx.restore();
  }

  /** Soft cast shadow of the stretched canvas on the wall, built from gradients (blur filters are slow). */
  private drawCastShadow(x0: number, y0: number, x1: number, y1: number, depth: number) {
    const { ctx } = this;
    const blur = Math.max(6, Math.min(90, depth * 3.4));
    const ox = depth * 0.45;
    const oy = depth * 1.05;
    const a = "rgba(48, 36, 22, 0.30)";
    const z = "rgba(48, 36, 22, 0)";
    // Right edge
    let g = ctx.createLinearGradient(x1, 0, x1 + ox + blur, 0);
    g.addColorStop(0, a);
    g.addColorStop(1, z);
    ctx.fillStyle = g;
    ctx.fillRect(x1, y0 + oy + blur * 0.4, ox + blur, y1 - y0 - blur * 0.4);
    // Bottom edge
    g = ctx.createLinearGradient(0, y1, 0, y1 + oy + blur);
    g.addColorStop(0, a);
    g.addColorStop(1, z);
    ctx.fillStyle = g;
    ctx.fillRect(x0 + ox + blur * 0.4, y1, x1 - x0 - blur * 0.4, oy + blur);
    // Corner
    const r = ox + blur;
    const rg = ctx.createRadialGradient(x1, y1, 0, x1, y1, Math.max(r, oy + blur));
    rg.addColorStop(0, a);
    rg.addColorStop(1, z);
    ctx.fillStyle = rg;
    ctx.fillRect(x1, y1, ox + blur, oy + blur);
  }

  /** Screen-space (device px) rectangle for a world bbox, padded and clamped to the screen. */
  private screenRect(b: BBox, padPx: number) {
    const sp = this.cam.scale * this.dpr;
    const left = this.cam.cx - this.vp.w / 2 / this.cam.scale;
    const top = this.cam.cy - this.vp.h / 2 / this.cam.scale;
    const x0 = Math.max(0, Math.floor((b.minX - left) * sp - padPx));
    const y0 = Math.max(0, Math.floor((b.minY - top) * sp - padPx));
    const x1 = Math.min(this.overlay.width, Math.ceil((b.maxX - left) * sp + padPx));
    const y1 = Math.min(this.overlay.height, Math.ceil((b.maxY - top) * sp + padPx));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }

  private lastLiveDraw = 0;

  private drawOverlay() {
    this.lastLiveDraw = performance.now();
    const o = this.octx;
    o.setTransform(1, 0, 0, 1, 0, 0);
    for (const r of this.overlayDirty) o.clearRect(r.x, r.y, r.w, r.h);
    this.overlayDirty = [];
    const sp = this.cam.scale * this.dpr;
    const left = this.cam.cx - this.vp.w / 2 / this.cam.scale;
    const top = this.cam.cy - this.vp.h / 2 / this.cam.scale;
    this.drawGhosts(sp, left, top);
    this.drawLive(sp, left, top);
  }

  private reliefPattern: CanvasPattern | null = null;

  private drawRelief(X0: number, Y0: number, X1: number, Y1: number, sp: number, left: number, top: number) {
    const fine = Math.max(0, Math.min(1, (sp - 0.35) / 0.4));
    if (fine <= 0) return;
    const { ctx } = this;
    this.reliefPattern ??= ctx.createPattern(getTextures().relief, "repeat");
    if (!this.reliefPattern) return;
    const k = (TEX_WORLD / TEX_PX) * sp;
    this.reliefPattern.setTransform(new DOMMatrix([k, 0, 0, k, -left * sp, -top * sp]));
    ctx.save();
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.5 * fine;
    ctx.fillStyle = this.reliefPattern;
    ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    ctx.restore();
  }

  /** Fresh paint is wet: a glossy highlight along the lit edge that disappears as it "dries" (is saved). */
  private wetGloss(lc: CanvasRenderingContext2D, pts: InkPoint[], sp: number, left: number, top: number) {
    const tool = this.brush.tool;
    if (tool === "pencil" || tool === "charcoal" || tool === "text" || sp < 0.5) return;
    const size = this.brush.size;
    lc.save();
    lc.setTransform(sp, 0, 0, sp, -left * sp, -top * sp);
    lc.globalCompositeOperation = "source-atop";
    lc.globalAlpha = tool === "watercolor" ? 0.1 : 0.2;
    lc.fillStyle = "#fffaf0";
    lc.translate(-size * 0.08, -size * 0.1);
    lc.fill(polyPath(strokeOutline(pts, tool, size * 0.7)));
    lc.restore();
  }

  private drawLive(sp: number, left: number, top: number) {
    const L = this.live;
    if (!L) return;
    const pts = L.predicted.length ? L.points.concat(L.predicted) : L.points;
    const bbox = strokeBounds(this.brush.tool, this.brush.size, pts);
    const r = this.screenRect(bbox, 4 * this.dpr);
    if (!r.w || !r.h) return;
    const lc = this.liveLayer.getContext("2d")!;
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "source-over";
    lc.clearRect(r.x, r.y, r.w, r.h);
    lc.beginPath();
    lc.rect(r.x, r.y, r.w, r.h);
    lc.clip();
    lc.setTransform(sp, 0, 0, sp, -left * sp, -top * sp);
    paintStroke(lc, { ...this.brush, points: pts, seed: seedFor(L.points), bbox }, { density: sp });
    this.wetGloss(lc, pts, sp, left, top);
    // Paint never lands on other people's work: the brush skips over it.
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = "destination-out";
    lc.drawImage(this.blockLayer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    lc.restore();
    this.octx.drawImage(this.liveLayer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
    this.overlayDirty.push(r);
  }

  private drawGhosts(sp: number, left: number, top: number) {
    if (!this.ghosts.size) return;
    const o = this.octx;
    const now = performance.now();
    const layer = this.ghostLayer();
    const gl = layer.getContext("2d")!;
    for (const g of this.ghosts.values()) {
      if (!g.points.length) continue;
      const fade = g.doneAt ? Math.max(0, 1 - (now - g.doneAt) / 1500) : 1;
      const bbox = strokeBounds(g.tool, g.size, g.points);
      const r = this.screenRect(bbox, 4 * this.dpr);
      if (r.w && r.h) {
        gl.save();
        gl.setTransform(1, 0, 0, 1, 0, 0);
        gl.clearRect(r.x, r.y, r.w, r.h);
        gl.beginPath();
        gl.rect(r.x, r.y, r.w, r.h);
        gl.clip();
        gl.setTransform(sp, 0, 0, sp, -left * sp, -top * sp);
        paintStroke(gl, { ...g, bbox }, { density: sp });
        gl.restore();
        o.globalAlpha = 0.85 * fade;
        o.drawImage(layer, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        o.globalAlpha = 1;
        this.overlayDirty.push(r);
      }
      // Who is painting, right at the tip of their brush.
      if (!g.doneAt) {
        const tip = g.points[g.points.length - 1];
        const x = (tip.x - left) * sp;
        const y = (tip.y - top) * sp;
        o.font = `400 ${15 * this.dpr}px "La Belle Aurore", cursive`;
        const w = o.measureText(g.username).width + 14 * this.dpr;
        const h = 22 * this.dpr;
        o.fillStyle = "rgba(28, 24, 20, 0.82)";
        o.beginPath();
        o.roundRect(x + 10 * this.dpr, y + 10 * this.dpr, w, h, h / 2);
        o.fill();
        o.fillStyle = "#fbf8f1";
        o.fillText(g.username, x + 17 * this.dpr, y + 25 * this.dpr);
        this.overlayDirty.push({ x: Math.floor(x), y: Math.floor(y), w: Math.ceil(w + 14 * this.dpr), h: Math.ceil(h + 14 * this.dpr) });
      }
    }
  }

  private _ghost: HTMLCanvasElement | null = null;
  private ghostLayer() {
    if (!this._ghost) this._ghost = document.createElement("canvas");
    if (this._ghost.width !== this.canvas.width || this._ghost.height !== this.canvas.height) {
      this._ghost.width = this.canvas.width;
      this._ghost.height = this.canvas.height;
    }
    return this._ghost;
  }

  private drawSpotlight(X0: number, Y0: number, X1: number, Y1: number, sp: number, left: number, top: number) {
    const layer = this.ghostLayer();
    const g = layer.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, layer.width, layer.height);
    g.fillStyle = "rgba(24, 19, 14, 0.5)";
    g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
    g.globalCompositeOperation = "destination-out";
    g.filter = `blur(${Math.max(2, 10 * this.dpr)}px)`;
    for (const r of this.spotlightRects!) {
      const pad = 30 / this.cam.scale;
      g.beginPath();
      g.roundRect(
        (r.minX - pad - left) * sp,
        (r.minY - pad - top) * sp,
        (r.maxX - r.minX + pad * 2) * sp,
        (r.maxY - r.minY + pad * 2) * sp,
        16 * this.dpr,
      );
      g.fill();
    }
    g.filter = "none";
    g.globalCompositeOperation = "source-over";
    this.ctx.drawImage(layer, 0, 0);
  }

  // ---- Input -------------------------------------------------------------------------------------

  /** The canvas's position on screen, measured on resize (reading layout on every touch is slow). */
  private rect = { left: 0, top: 0 };

  private resize = () => {
    const rect = this.host.getBoundingClientRect();
    this.rect = { left: rect.left, top: rect.top };
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.vp = { ...this.vp, w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
    for (const c of [this.canvas, this.overlay, this.liveLayer, this.blockLayer]) {
      c.width = Math.round(this.vp.w * this.dpr);
      c.height = Math.round(this.vp.h * this.dpr);
    }
    this.surfacePattern = null;
    this.mottlePattern = null;
    this.reliefPattern = null;
    this.overlayDirty = [];
    this.setCamera(this.cam);
  };

  private worldAt(e: { clientX: number; clientY: number }) {
    const r = this.rect;
    const w = toWorld(this.cam, this.vp, e.clientX - r.left, e.clientY - r.top);
    return { x: clampTo(w.x, 0, this.info.width), y: clampTo(w.y, 0, this.info.height) };
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.rect;
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener("pointerdown", this.onDown);
    c.addEventListener("pointermove", this.onMove);
    c.addEventListener("pointerup", this.onUp);
    c.addEventListener("pointercancel", this.onCancel);
    c.addEventListener("wheel", this.onWheel, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    // iOS Safari: stop the page itself from zooming on pinch.
    c.addEventListener("gesturestart", (e) => e.preventDefault());
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === "pen") this.penSeen = true;
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType, sx: p.x, sy: p.y, t0: performance.now() });
    this.anim = null;
    this.velocity = { x: 0, y: 0 };

    if (this.pointers.size === 2) {
      // Second finger: this is a pinch/pan. A brand-new stroke was really the start of the gesture.
      if (this.live && (performance.now() - this.live.t0 < 250 || this.live.points.length < 8)) this.cancelStroke();
      if (this.live) return;
      this.pan = null;
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      return;
    }
    if (this.pointers.size > 2 || this.live) return;

    const wantsPan =
      e.button === 1 ||
      e.button === 2 ||
      this.spaceDown ||
      this.mode === "look" ||
      (e.pointerType === "touch" && this.penSeen) || // palm rejection: with a pencil, fingers only move the view
      this.brush.tool === "text" ||
      this.mode === "eyedropper";

    if (!wantsPan && !this.closeEnough()) {
      // Too far away to paint: step up to the canvas right where they touched.
      this.pointers.delete(e.pointerId);
      this.approach(p.x, p.y);
      this.events.toast("Up close now. Paint away.");
      return;
    }
    if (!wantsPan && this.startStroke(e)) return;
    this.pan = { id: e.pointerId, lastX: p.x, lastY: p.y, lastT: e.timeStamp, moved: 0, tap: true };
    if (this.mode === "look" || this.spaceDown) this.canvas.style.cursor = "grabbing";
  };

  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    const ptr = this.pointers.get(e.pointerId);
    if (ptr) {
      ptr.x = p.x;
      ptr.y = p.y;
    }

    if (this.live && e.pointerId === this.live.pointerId) return this.extendStroke(e);

    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      let next = zoomAt(this.cam, this.vp, mid.x, mid.y, dist / Math.max(1, this.pinch.dist));
      next = { ...next, cx: next.cx - (mid.x - this.pinch.mid.x) / next.scale, cy: next.cy - (mid.y - this.pinch.mid.y) / next.scale };
      this.pinch = { dist, mid };
      this.setCamera(next);
      return;
    }

    if (this.pan && e.pointerId === this.pan.id) {
      const dx = p.x - this.pan.lastX;
      const dy = p.y - this.pan.lastY;
      const dt = Math.max(1, e.timeStamp - this.pan.lastT);
      this.pan.moved += Math.hypot(dx, dy);
      if (this.pan.moved > LOOK_TAP_PX) this.pan.tap = false;
      this.velocity = { x: (dx / dt) * 0.8 + this.velocity.x * 0.2, y: (dy / dt) * 0.8 + this.velocity.y * 0.2 };
      this.pan.lastX = p.x;
      this.pan.lastY = p.y;
      this.pan.lastT = e.timeStamp;
      if (!this.pan.tap) this.setCamera({ ...this.cam, cx: this.cam.cx - dx / this.cam.scale, cy: this.cam.cy - dy / this.cam.scale });
      return;
    }

    // Mouse hover in Look mode: who painted this?
    if (e.pointerType === "mouse" && this.mode === "look" && !this.pointers.size) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => void this.pickAt(p.x, p.y, true), 140);
    }
  };

  private onUp = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    if (this.live && e.pointerId === this.live.pointerId) {
      void this.finishStroke(false);
      return;
    }
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.pan && e.pointerId === this.pan.id) {
      const wasTap = this.pan.tap && e.timeStamp - this.pan.lastT < 600;
      this.pan = null;
      this.canvas.style.cursor = this.mode === "look" ? "grab" : this.mode === "eyedropper" ? "copy" : "crosshair";
      if (!wasTap) return;
      this.velocity = { x: 0, y: 0 };
      if (this.mode === "eyedropper") return this.pickColor(p.x, p.y);
      if (this.mode === "paint" && this.brush.tool === "text" && !this.spaceDown) {
        const reason = this.blockReason();
        if (reason) return this.events.blocked(reason);
        if (!this.closeEnough()) return this.approach(p.x, p.y);
        const w = toWorld(this.cam, this.vp, p.x, p.y);
        return this.events.placeText({ wx: w.x, wy: w.y, sx: p.x, sy: p.y });
      }
      if (this.mode === "look") void this.pickAt(p.x, p.y);
    }
  };

  private onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.live && e.pointerId === this.live.pointerId) void this.finishStroke(true);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pan?.id === e.pointerId) this.pan = null;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    this.anim = null;
    const mouseWheel = e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || e.metaKey) {
      // Trackpad pinch arrives as ctrl+wheel.
      this.setCamera(zoomAt(this.cam, this.vp, p.x, p.y, Math.exp(-e.deltaY * 0.012)));
    } else if (mouseWheel) {
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      this.setCamera(zoomAt(this.cam, this.vp, p.x, p.y, Math.exp(-dy * 0.0016)));
    } else {
      this.setCamera({ ...this.cam, cx: this.cam.cx + e.deltaX / this.cam.scale, cy: this.cam.cy + e.deltaY / this.cam.scale });
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.code === "Space") {
      if (!this.spaceDown) {
        this.spaceDown = true;
        this.canvas.style.cursor = "grab";
      }
      e.preventDefault();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      void (e.shiftKey ? this.redo() : this.undo());
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      void this.redo();
      return;
    }
    if (mod) return;
    if (e.key === "[") this.events.sizeStep(-1);
    else if (e.key === "]") this.events.sizeStep(1);
    else if (e.key === "0") this.fit();
    else if (e.key === "=" || e.key === "+") this.zoomBy(1.5);
    else if (e.key === "-") this.zoomBy(1 / 1.5);
    else this.events.toolKey(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === "Space") {
      this.spaceDown = false;
      this.canvas.style.cursor = this.mode === "look" ? "grab" : "crosshair";
    }
  };

  private async loadFonts() {
    if (this.fontsReady || typeof document === "undefined" || !document.fonts) return;
    try {
      await Promise.race([
        Promise.all(Object.values(FONTS).map((f) => document.fonts.load(`${f.css} 48px ${f.family}`))),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      /* fall back to system fonts */
    }
    this.fontsReady = true;
    // Text painted before the fonts arrived used a fallback face: repaint it.
    for (const s of this.store.all()) if (s.tool === "text") this.renderer.strokeChanged(s, "rebuild");
  }
}

function clampTo(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

