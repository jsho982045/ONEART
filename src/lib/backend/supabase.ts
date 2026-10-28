import type { SupabaseClient } from "@supabase/supabase-js";
import { STROKE_COLUMNS, type StrokeRow } from "@/lib/paint/store";
import type { BBox } from "@/lib/paint/stroke";
import { TILE_BUCKET, isManifest, manifestPath, tileKey, tilePath } from "@/lib/paint/tiles";
import type { AdminReport, Backend, CanvasInfo, Connection, Handlers, LiveMessage, Me, NewStroke, ReportReason } from "./types";

const PAGE = 1000;
const MAX_PER_REGION = 20000;

type CanvasRow = {
  id: string;
  slug: string;
  title: string;
  width: number;
  height: number;
  opens_at: string;
  closes_at: string;
  ink_capacity: number;
  ink_refill_seconds: number;
};

function toCanvas(r: CanvasRow): CanvasInfo {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    width: r.width,
    height: r.height,
    opensAt: r.opens_at,
    closesAt: r.closes_at,
    inkCapacity: Number(r.ink_capacity),
    inkRefillSeconds: r.ink_refill_seconds,
  };
}

function fail(error: { message: string } | null): never {
  throw new Error(error?.message ?? "unknown_error");
}

export class SupabaseBackend implements Backend {
  readonly mode = "supabase" as const;
  constructor(private sb: SupabaseClient) {}

  async getCanvas(slug?: string): Promise<CanvasInfo | null> {
    let q = this.sb.from("canvases").select("*");
    q = slug ? q.eq("slug", slug) : q.lte("opens_at", new Date().toISOString());
    const { data, error } = await q.order("opens_at", { ascending: false }).limit(1);
    if (error) fail(error);
    if (data?.[0]) return toCanvas(data[0] as CanvasRow);
    if (slug) return null;
    // Nothing open yet: show the next scheduled canvas.
    const next = await this.sb.from("canvases").select("*").order("opens_at", { ascending: true }).limit(1);
    return next.data?.[0] ? toCanvas(next.data[0] as CanvasRow) : null;
  }

  async getMe(): Promise<Me | null> {
    const { data, error } = await this.sb.rpc("my_state");
    if (error) fail(error);
    if (!data) return null;
    return {
      userId: data.user_id,
      username: data.username,
      artistNo: Number(data.artist_no),
      onboarded: data.onboarded,
      emailVerified: data.email_verified,
      isAdmin: data.is_admin,
      banned: data.banned,
      ink: data.ink == null ? null : Number(data.ink),
      inkAt: data.ink_at ? Date.parse(data.ink_at) : null,
    };
  }

  async loadStrokes(canvasId: string, b: BBox): Promise<StrokeRow[]> {
    const out: StrokeRow[] = [];
    let after = 0;
    while (out.length < MAX_PER_REGION) {
      const { data, error } = await this.sb
        .from("strokes")
        .select(STROKE_COLUMNS)
        .eq("canvas_id", canvasId)
        .lte("min_x", b.maxX)
        .gte("max_x", b.minX)
        .lte("min_y", b.maxY)
        .gte("max_y", b.minY)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (error) fail(error);
      const rows = (data ?? []) as unknown as StrokeRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      after = Number(rows[rows.length - 1].id);
    }
    return out;
  }

  async loadSince(canvasId: string, afterId: number): Promise<StrokeRow[]> {
    const out: StrokeRow[] = [];
    let after = afterId;
    while (out.length < 50000) {
      const { data, error } = await this.sb
        .from("strokes")
        .select(STROKE_COLUMNS)
        .eq("canvas_id", canvasId)
        .gt("id", after)
        .order("id", { ascending: true })
        .limit(PAGE);
      if (error) fail(error);
      const rows = (data ?? []) as unknown as StrokeRow[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      after = Number(rows[rows.length - 1].id);
    }
    return out;
  }

  async tileManifest(canvasId: string) {
    const bucket = this.sb.storage.from(TILE_BUCKET);
    const url = bucket.getPublicUrl(manifestPath(canvasId)).data.publicUrl;
    try {
      const res = await fetch(`${url}?t=${Math.floor(Date.now() / 60000)}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!res.ok) return null;
      const manifest: unknown = await res.json();
      if (!isManifest(manifest)) return null;
      return {
        manifest,
        tileUrl: (lod: number, x: number, y: number) => {
          const rev = manifest.tiles[tileKey(lod, x, y)];
          return rev ? bucket.getPublicUrl(tilePath(canvasId, lod, x, y, rev)).data.publicUrl : null;
        },
      };
    } catch {
      return null;
    }
  }

  async artistBounds(canvasId: string, artist: number): Promise<BBox[]> {
    const { data, error } = await this.sb
      .from("strokes")
      .select("min_x,min_y,max_x,max_y")
      .eq("canvas_id", canvasId)
      .eq("artist_no", artist)
      .eq("erased", false)
      .eq("hidden", false)
      .limit(5000);
    if (error) fail(error);
    return (data ?? []).map((r) => ({ minX: r.min_x, minY: r.min_y, maxX: r.max_x, maxY: r.max_y }));
  }

  async drawStroke(canvasId: string, s: NewStroke): Promise<StrokeRow> {
    const { data, error } = await this.sb.rpc("draw_stroke", {
      p_canvas: canvasId,
      p_tool: s.tool,
      p_color: s.color,
      p_size: s.size,
      p_opacity: s.opacity,
      p_points: s.points,
      p_body: s.body ?? null,
      p_font: s.font ?? null,
    });
    if (error || !data) fail(error);
    return data as StrokeRow;
  }

  async setErased(strokeId: number, erased: boolean) {
    const { error } = await this.sb.rpc("set_stroke_erased", { p_stroke: strokeId, p_erased: erased });
    if (error) fail(error);
  }

  async artistNames(nos: number[]) {
    const map = new Map<number, string>();
    if (!nos.length) return map;
    const { data, error } = await this.sb.rpc("artist_names", { p_artists: nos });
    if (error) fail(error);
    for (const r of (data ?? []) as { artist_no: number; username: string }[]) map.set(Number(r.artist_no), r.username);
    return map;
  }

  async artistByUsername(username: string) {
    const { data, error } = await this.sb.rpc("artist_by_username", { p_username: username });
    if (error) fail(error);
    return data == null ? null : Number(data);
  }

  async stats(canvasId: string) {
    const { data, error } = await this.sb.rpc("canvas_stats", { p_canvas: canvasId });
    if (error) fail(error);
    return { strokes: Number(data?.strokes ?? 0), artists: Number(data?.artists ?? 0) };
  }

  async report(strokeId: number, reason: ReportReason) {
    const { error } = await this.sb.rpc("report_stroke", { p_stroke: strokeId, p_reason: reason });
    if (error) fail(error);
  }

  connect(canvasId: string, me: { artist: number; username: string } | null, h: Handlers): Connection {
    const presenceKey = me ? `a${me.artist}` : `v${Math.random().toString(36).slice(2)}`;
    let subscribedOnce = false;
    const channel = this.sb.channel(`canvas:${canvasId}`, {
      config: { presence: { key: presenceKey }, broadcast: { self: false, ack: false } },
    });
    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "strokes", filter: `canvas_id=eq.${canvasId}` },
        (payload) => h.onInsert(payload.new as StrokeRow),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "strokes", filter: `canvas_id=eq.${canvasId}` },
        (payload) => h.onUpdate(payload.new as StrokeRow),
      )
      .on("broadcast", { event: "live" }, ({ payload }) => h.onLive(payload as LiveMessage))
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, { painting?: boolean }[]>;
        h.onPresence(Object.keys(state).length);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void channel.track({ at: Date.now() });
          if (subscribedOnce) h.onResync();
          subscribedOnce = true;
        }
      });

    return {
      // The studio batches points (about 12 messages a second), well inside Supabase's broadcast limits.
      sendLive: (msg) => {
        void channel.send({ type: "broadcast", event: "live", payload: msg });
      },
      close: () => {
        void this.sb.removeChannel(channel);
      },
    };
  }

  admin = {
    openReports: async (): Promise<AdminReport[]> => {
      const { data, error } = await this.sb.rpc("admin_open_reports");
      if (error) fail(error);
      return (data ?? []) as AdminReport[];
    },
    setHidden: async (strokeId: number, hidden: boolean) => {
      const { error } = await this.sb.rpc("admin_set_hidden", { p_stroke: strokeId, p_hidden: hidden });
      if (error) fail(error);
    },
    banArtist: async (artist: number) => {
      const { data, error } = await this.sb.rpc("admin_ban_artist", { p_artist: artist });
      if (error) fail(error);
      return Number(data ?? 0);
    },
    dismiss: async (strokeId: number) => {
      const { error } = await this.sb.rpc("admin_dismiss_reports", { p_stroke: strokeId });
      if (error) fail(error);
    },
    listCanvases: async (): Promise<CanvasInfo[]> => {
      const { data, error } = await this.sb.from("canvases").select("*").order("opens_at", { ascending: false });
      if (error) fail(error);
      return ((data ?? []) as CanvasRow[]).map(toCanvas);
    },
    saveCanvas: async (c: Omit<CanvasInfo, "id" | "width" | "height"> & { id: string | null }) => {
      const { data, error } = await this.sb.rpc("admin_save_canvas", {
        p_id: c.id,
        p_slug: c.slug,
        p_title: c.title,
        p_opens_at: c.opensAt,
        p_closes_at: c.closesAt,
        p_ink_capacity: c.inkCapacity,
        p_ink_refill_seconds: c.inkRefillSeconds,
      });
      if (error || !data) fail(error);
      return toCanvas(data as CanvasRow);
    },
  };
}
