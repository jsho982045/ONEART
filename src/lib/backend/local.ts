import { decodePoints } from "@/lib/paint/codec";
import { afterStroke, inkBalance, strokeCost } from "@/lib/paint/ink";
import type { StrokeRow } from "@/lib/paint/store";
import { intersects, strokeBounds, type BBox } from "@/lib/paint/stroke";
import type { Backend, CanvasInfo, Connection, Handlers, LiveMessage, Me, NewStroke } from "./types";

/**
 * Local test mode: the whole app runs in your browser with no accounts or database.
 * Strokes are kept in localStorage, and every open tab is a different "artist" connected over a
 * BroadcastChannel, so you can open two windows side by side and watch them paint together.
 *
 * Rules mirror the database (bounds, ink well, only erasing your own work) so behaviour matches production.
 */

const KEY = "oneart.local.v1";
const ME_KEY = "oneart.local.me";
const CHANNEL = "oneart-local";

const NAMES = ["Vermeer", "Kahlo", "Hokusai", "Turner", "Cassatt", "Basquiat", "Klimt", "Morisot", "Sorolla", "Okeeffe", "Monet", "Lawrence"];

type Data = {
  canvas: CanvasInfo;
  strokes: StrokeRow[];
  nextId: number;
  nextArtist: number;
  artists: Record<number, { username: string; ink: number | null; inkAt: number | null }>;
};

type Msg =
  | { t: "insert"; row: StrokeRow }
  | { t: "update"; row: StrokeRow }
  | { t: "live"; msg: LiveMessage }
  | { t: "here"; tab: string }
  | { t: "bye"; tab: string };

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Data;
  } catch {
    /* fall through to a fresh canvas */
  }
  const now = Date.now();
  return {
    canvas: {
      id: "local",
      slug: "local",
      title: "Local test canvas",
      width: 12000,
      height: 8000,
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 30 * 86400_000).toISOString(),
      inkCapacity: 800000,
      inkRefillSeconds: 7200,
    },
    strokes: [],
    nextId: 1,
    nextArtist: 1,
    artists: {},
  };
}

function save(d: Data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // Storage full: the canvas keeps working for this session.
  }
}

export class LocalBackend implements Backend {
  readonly mode = "local" as const;
  private bc: BroadcastChannel | null = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;
  private tab = Math.random().toString(36).slice(2);

  private me(): { artist: number; username: string } {
    try {
      const raw = sessionStorage.getItem(ME_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* new identity below */
    }
    const d = load();
    const artist = d.nextArtist++;
    const username = `${NAMES[(artist - 1) % NAMES.length]}_${String(artist).padStart(2, "0")}`;
    d.artists[artist] = { username, ink: null, inkAt: null };
    save(d);
    const me = { artist, username };
    try {
      sessionStorage.setItem(ME_KEY, JSON.stringify(me));
    } catch {
      /* private mode: identity lasts for this page */
    }
    return me;
  }

  async getCanvas() {
    return load().canvas;
  }

  async getMe(): Promise<Me> {
    const me = this.me();
    const a = load().artists[me.artist];
    return {
      userId: `local-${me.artist}`,
      username: me.username,
      artistNo: me.artist,
      onboarded: true,
      emailVerified: true,
      isAdmin: true,
      banned: false,
      ink: a?.ink ?? null,
      inkAt: a?.inkAt ?? null,
    };
  }

  async loadStrokes(_canvasId: string, b: BBox) {
    return load().strokes.filter((r) =>
      intersects({ minX: r.min_x, minY: r.min_y, maxX: r.max_x, maxY: r.max_y }, b),
    );
  }

  async loadSince(_canvasId: string, afterId: number) {
    return load().strokes.filter((r) => r.id > afterId);
  }

  async tileManifest() {
    // Local test mode keeps everything in the browser: no baked tiles.
    return null;
  }

  async artistBounds(_canvasId: string, artist: number) {
    return load()
      .strokes.filter((r) => r.artist_no === artist && !r.erased && !r.hidden)
      .map((r) => ({ minX: r.min_x, minY: r.min_y, maxX: r.max_x, maxY: r.max_y }));
  }

  async drawStroke(_canvasId: string, s: NewStroke): Promise<StrokeRow> {
    const me = this.me();
    const d = load();
    const c = d.canvas;
    const now = Date.now();
    if (now < Date.parse(c.opensAt) || now >= Date.parse(c.closesAt)) throw new Error("canvas_closed");
    const points = decodePoints(s.points);
    if (points.length === 0) throw new Error("invalid_points");
    if (points.some((p) => p.x > c.width || p.y > c.height)) throw new Error("out_of_bounds");
    const artist = (d.artists[me.artist] ??= { username: me.username, ink: null, inkAt: null });
    const settings = { capacity: c.inkCapacity, refillSeconds: c.inkRefillSeconds };
    const balance = inkBalance({ ink: artist.ink, at: artist.inkAt }, settings, now);
    if (balance <= 0) throw new Error("out_of_ink");
    const cost = strokeCost(s.tool, s.size, points, s.body);
    artist.ink = afterStroke(balance, cost, settings);
    artist.inkAt = now;
    const b = strokeBounds(s.tool, s.size, points, s.body);
    const row: StrokeRow = {
      id: d.nextId++,
      canvas_id: c.id,
      artist_no: me.artist,
      tool: s.tool,
      color: s.color,
      size: s.size,
      opacity: s.opacity,
      points: s.points,
      body: s.body ?? null,
      font: s.font ?? null,
      min_x: b.minX,
      min_y: b.minY,
      max_x: b.maxX,
      max_y: b.maxY,
      erased: false,
      hidden: false,
      created_at: new Date(now).toISOString(),
    };
    d.strokes.push(row);
    save(d);
    this.bc?.postMessage({ t: "insert", row } satisfies Msg);
    return row;
  }

  async setErased(strokeId: number, erased: boolean) {
    const me = this.me();
    const d = load();
    const row = d.strokes.find((r) => r.id === strokeId);
    if (!row) throw new Error("not_found");
    if (row.artist_no !== me.artist) throw new Error("not_yours");
    row.erased = erased;
    save(d);
    this.bc?.postMessage({ t: "update", row } satisfies Msg);
  }

  async artistNames(nos: number[]) {
    const d = load();
    const map = new Map<number, string>();
    for (const n of nos) if (d.artists[n]) map.set(n, d.artists[n].username);
    return map;
  }

  async artistByUsername(username: string) {
    const d = load();
    for (const [k, v] of Object.entries(d.artists)) if (v.username.toLowerCase() === username.toLowerCase()) return Number(k);
    return null;
  }

  async stats() {
    const live = load().strokes.filter((r) => !r.erased && !r.hidden);
    return { strokes: live.length, artists: new Set(live.map((r) => r.artist_no)).size };
  }

  async report() {
    /* Nothing to moderate locally. */
  }

  connect(_canvasId: string, _me: unknown, h: Handlers): Connection {
    const seen = new Map<string, number>([[this.tab, Date.now()]]);
    const emitPresence = () => {
      const cutoff = Date.now() - 6000;
      for (const [k, t] of seen) if (t < cutoff && k !== this.tab) seen.delete(k);
      h.onPresence(seen.size);
    };
    const onMessage = (e: MessageEvent<Msg>) => {
      const m = e.data;
      if (m.t === "insert") h.onInsert(m.row);
      else if (m.t === "update") h.onUpdate(m.row);
      else if (m.t === "live") h.onLive(m.msg);
      else if (m.t === "here") {
        const isNew = !seen.has(m.tab);
        seen.set(m.tab, Date.now());
        if (isNew) this.bc?.postMessage({ t: "here", tab: this.tab } satisfies Msg);
        emitPresence();
      } else if (m.t === "bye") {
        seen.delete(m.tab);
        emitPresence();
      }
    };
    this.bc?.addEventListener("message", onMessage);
    const ping = () => {
      seen.set(this.tab, Date.now());
      this.bc?.postMessage({ t: "here", tab: this.tab } satisfies Msg);
      emitPresence();
    };
    ping();
    const timer = setInterval(ping, 2500);
    const bye = () => this.bc?.postMessage({ t: "bye", tab: this.tab } satisfies Msg);
    window.addEventListener("pagehide", bye);
    return {
      sendLive: (msg) => this.bc?.postMessage({ t: "live", msg } satisfies Msg),
      close: () => {
        clearInterval(timer);
        bye();
        window.removeEventListener("pagehide", bye);
        this.bc?.removeEventListener("message", onMessage);
      },
    };
  }

  admin = {
    openReports: async () => [],
    setHidden: async (strokeId: number, hidden: boolean) => {
      const d = load();
      const row = d.strokes.find((r) => r.id === strokeId);
      if (!row) return;
      row.hidden = hidden;
      save(d);
      this.bc?.postMessage({ t: "update", row } satisfies Msg);
    },
    banArtist: async () => 0,
    dismiss: async () => {},
    listCanvases: async () => [load().canvas],
    saveCanvas: async (c: Omit<CanvasInfo, "id" | "width" | "height"> & { id: string | null }) => {
      const d = load();
      d.canvas = { ...d.canvas, title: c.title, opensAt: c.opensAt, closesAt: c.closesAt, inkCapacity: c.inkCapacity, inkRefillSeconds: c.inkRefillSeconds };
      save(d);
      return d.canvas;
    },
  };
}

/** Wipes the local test canvas (handy between test sessions). */
export function resetLocalCanvas() {
  localStorage.removeItem(KEY);
  sessionStorage.removeItem(ME_KEY);
}
