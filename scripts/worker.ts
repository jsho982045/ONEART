/**
 * ONEART background worker. Runs as its own Railway service (see railway.worker.json):
 *
 *   1. Bakes the far-zoom overview tiles of every open (or just-closed) canvas into Supabase Storage, so
 *      viewers looking at the whole canvas never have to download every stroke.
 *   2. Sends the two lifecycle emails once each: "3 days left" and "the canvas is finished".
 *
 *   npm run worker           # loop forever (Railway)
 *   npm run worker -- --once # one pass, then exit (handy locally)
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server only, never in the browser),
 *      optional RESEND_API_KEY + EMAIL_FROM + NEXT_PUBLIC_SITE_URL for emails, WORKER_INTERVAL_MINUTES (default 5).
 */

import path from "node:path";
import { DOMMatrix, GlobalFonts, Path2D, createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FINALS_BUCKET, PREVIEW_WIDTH, finalPath, previewPath } from "../src/lib/finished";
import { setCanvasFactory } from "../src/lib/paint/platform";
import { TEX_PX, TEX_WORLD, getTextures } from "../src/lib/paint/textures";
import { ChunkRenderer } from "../src/lib/paint/renderer";
import { STROKE_COLUMNS, StrokeStore, rowToStroke, type StrokeRow } from "../src/lib/paint/store";
import {
  BASE_LOD,
  MANIFEST_VERSION,
  TILE_BUCKET,
  TILE_LODS,
  isManifest,
  manifestPath,
  tileGrid,
  tileKey,
  tilePath,
  type TileManifest,
} from "../src/lib/paint/tiles";

// ---- Make the browser paint code run in Node -----------------------------------------------------

const g = globalThis as unknown as Record<string, unknown>;
g.Path2D = Path2D;
g.DOMMatrix = DOMMatrix;
setCanvasFactory((w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement);

function registerFont(pkg: string, file: string, family: string) {
  try {
    const dir = path.dirname(require.resolve(`${pkg}/package.json`));
    GlobalFonts.registerFromPath(path.join(dir, "files", file), family);
  } catch (err) {
    console.warn(`font ${family} not registered:`, (err as Error).message);
  }
}
// The same lettering faces the browser uses (src/lib/paint/tools.ts FONTS), so text bakes identically.
registerFont("@fontsource/mrs-saint-delafield", "mrs-saint-delafield-latin-400-normal.woff2", "Mrs Saint Delafield");
registerFont("@fontsource/im-fell-english", "im-fell-english-latin-400-italic.woff2", "IM Fell English");
registerFont("@fontsource/im-fell-english", "im-fell-english-latin-400-normal.woff2", "IM Fell English");
registerFont("@fontsource-variable/cinzel", "cinzel-latin-wght-normal.woff2", "Cinzel Variable");
registerFont("@fontsource/im-fell-english-sc", "im-fell-english-sc-latin-400-normal.woff2", "IM Fell English SC");

// ---- Setup ---------------------------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const intervalMin = Number(process.env.WORKER_INTERVAL_MINUTES ?? 5);

type CanvasRow = {
  id: string;
  slug: string;
  title: string;
  width: number;
  height: number;
  opens_at: string;
  closes_at: string;
  final_ready_at: string | null;
};

const PAGE = 1000;
const CHUNK = 256;

// ---- Tiles ---------------------------------------------------------------------------------------

async function readManifest(sb: SupabaseClient, canvasId: string): Promise<TileManifest | null> {
  const { data } = await sb.storage.from(TILE_BUCKET).download(manifestPath(canvasId));
  if (!data) return null;
  try {
    const m: unknown = JSON.parse(await data.text());
    return isManifest(m) ? m : null;
  } catch {
    return null;
  }
}

async function strokesIn(sb: SupabaseClient, canvasId: string, b: { minX: number; minY: number; maxX: number; maxY: number }) {
  const out: StrokeRow[] = [];
  let after = 0;
  for (;;) {
    const { data, error } = await sb
      .from("strokes")
      .select(STROKE_COLUMNS)
      .eq("canvas_id", canvasId)
      .lte("min_x", b.maxX)
      .gte("max_x", b.minX)
      .lte("min_y", b.maxY)
      .gte("max_y", b.minY)
      .gt("id", after)
      .order("id")
      .limit(PAGE);
    if (error) throw error;
    const rows = (data ?? []) as unknown as StrokeRow[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    after = Number(rows[rows.length - 1].id);
  }
}

/** Bounds of everything that changed since the last bake: new strokes, and erased/hidden/restored ones. */
async function dirtyAreas(sb: SupabaseClient, canvasId: string, prev: TileManifest | null) {
  const boxes: { minX: number; minY: number; maxX: number; maxY: number }[] = [];
  let maxId = prev?.maxId ?? 0;
  const pull = async (build: (after: number) => PromiseLike<{ data: unknown; error: unknown }>) => {
    let after = 0;
    for (;;) {
      const { data, error } = await build(after);
      if (error) throw error;
      const rows = (data ?? []) as { id: number; min_x: number; min_y: number; max_x: number; max_y: number }[];
      for (const r of rows) {
        boxes.push({ minX: r.min_x, minY: r.min_y, maxX: r.max_x, maxY: r.max_y });
        maxId = Math.max(maxId, Number(r.id));
      }
      if (rows.length < PAGE) return;
      after = Number(rows[rows.length - 1].id);
    }
  };
  const cols = "id,min_x,min_y,max_x,max_y";
  await pull((after) =>
    sb.from("strokes").select(cols).eq("canvas_id", canvasId).gt("id", Math.max(after, prev?.maxId ?? 0)).order("id").limit(PAGE),
  );
  if (prev) {
    await pull((after) =>
      sb.from("strokes").select(cols).eq("canvas_id", canvasId).gt("changed_at", prev.bakedAt).gt("id", after).order("id").limit(PAGE),
    );
  }
  return { boxes, maxId };
}

function isEmpty(c: Canvas) {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

async function bakeCanvas(sb: SupabaseClient, canvas: CanvasRow) {
  const started = new Date().toISOString();
  const prev = await readManifest(sb, canvas.id);
  const world = { width: canvas.width, height: canvas.height };
  const { boxes, maxId } = await dirtyAreas(sb, canvas.id, prev);
  if (prev && boxes.length === 0) return { canvas: canvas.slug, changed: 0 };

  const rev = Date.now().toString(36);
  const tiles: Record<string, string> = prev ? { ...prev.tiles } : {};
  const bucket = sb.storage.from(TILE_BUCKET);

  // 1. Repaint the base level where something changed (everything, on the first bake).
  const base = tileGrid(BASE_LOD, world, CHUNK);
  let dirty = new Set<string>();
  if (!prev) {
    for (let y = 0; y < base.ny; y++) for (let x = 0; x < base.nx; x++) dirty.add(`${x}:${y}`);
  } else {
    for (const b of boxes) {
      for (let y = Math.max(0, Math.floor(b.minY / base.cw)); y <= Math.min(base.ny - 1, Math.floor(b.maxY / base.cw)); y++)
        for (let x = Math.max(0, Math.floor(b.minX / base.cw)); x <= Math.min(base.nx - 1, Math.floor(b.maxX / base.cw)); x++)
          dirty.add(`${x}:${y}`);
    }
  }

  const images = new Map<string, Canvas | null>();
  let changed = 0;
  for (const cell of dirty) {
    const [x, y] = cell.split(":").map(Number);
    const box = { minX: x * base.cw - 8, minY: y * base.cw - 8, maxX: (x + 1) * base.cw + 8, maxY: (y + 1) * base.cw + 8 };
    const store = new StrokeStore();
    for (const row of await strokesIn(sb, canvas.id, box)) store.put(rowToStroke(row));
    const renderer = new ChunkRenderer(store, world, () => true);
    const img = renderer.renderChunk(BASE_LOD, x, y) as unknown as Canvas;
    const key = tileKey(BASE_LOD, x, y);
    images.set(key, isEmpty(img) ? null : img);
    await putTile(bucket, canvas.id, BASE_LOD, x, y, images.get(key) ?? null, rev, tiles);
    changed++;
  }

  // 2. Every coarser level is the four tiles under it, downsampled.
  for (let lod = BASE_LOD - 1; lod >= Math.min(...TILE_LODS); lod--) {
    const grid = tileGrid(lod, world, CHUNK);
    const next = new Set<string>();
    for (const cell of dirty) {
      const [x, y] = cell.split(":").map(Number);
      next.add(`${Math.floor(x / 2)}:${Math.floor(y / 2)}`);
    }
    for (const cell of next) {
      const [x, y] = cell.split(":").map(Number);
      if (x >= grid.nx || y >= grid.ny) continue;
      const out = createCanvas(CHUNK, CHUNK);
      const ctx = out.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const child = await childTile(bucket, canvas.id, lod + 1, x * 2 + dx, y * 2 + dy, images, tiles);
          if (child) ctx.drawImage(child, dx * (CHUNK / 2), dy * (CHUNK / 2), CHUNK / 2, CHUNK / 2);
        }
      }
      const key = tileKey(lod, x, y);
      images.set(key, isEmpty(out) ? null : out);
      await putTile(bucket, canvas.id, lod, x, y, images.get(key) ?? null, rev, tiles);
    }
    dirty = next;
  }

  const manifest: TileManifest = { version: MANIFEST_VERSION, maxId, bakedAt: started, lods: [...TILE_LODS], tiles };
  const { error } = await bucket.upload(manifestPath(canvas.id), JSON.stringify(manifest), {
    contentType: "application/json",
    cacheControl: "30",
    upsert: true,
  });
  if (error) throw error;
  return { canvas: canvas.slug, changed };
}

async function putTile(
  bucket: ReturnType<SupabaseClient["storage"]["from"]>,
  canvasId: string,
  lod: number,
  x: number,
  y: number,
  img: Canvas | null,
  rev: string,
  tiles: Record<string, string>,
) {
  const key = tileKey(lod, x, y);
  if (!img) {
    delete tiles[key];
    return;
  }
  const { error } = await bucket.upload(tilePath(canvasId, lod, x, y, rev), await img.encode("png"), {
    contentType: "image/png",
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw error;
  tiles[key] = rev;
}

async function childTile(
  bucket: ReturnType<SupabaseClient["storage"]["from"]>,
  canvasId: string,
  lod: number,
  x: number,
  y: number,
  images: Map<string, Canvas | null>,
  tiles: Record<string, string>,
) {
  const key = tileKey(lod, x, y);
  if (images.has(key)) return images.get(key) ?? null;
  const rev = tiles[key];
  if (!rev) return null;
  const { data } = await bucket.download(tilePath(canvasId, lod, x, y, rev));
  if (!data) return null;
  const img = await loadImage(Buffer.from(await data.arrayBuffer()));
  const c = createCanvas(CHUNK, CHUNK);
  c.getContext("2d").drawImage(img, 0, 0);
  images.set(key, c);
  return c;
}

// ---- The finished piece -------------------------------------------------------------------------

/** Renders a closed canvas at full resolution (one pixel per canvas unit) on the woven canvas surface. */
async function renderFinal(sb: SupabaseClient, canvas: CanvasRow) {
  const W = canvas.width;
  const H = canvas.height;
  const world = { width: W, height: H };
  const out = createCanvas(W, H);
  const ctx = out.getContext("2d");

  // The primed canvas itself, exactly as it looks in the studio.
  const tex = getTextures();
  const pattern = ctx.createPattern(tex.surface as unknown as Parameters<typeof ctx.createPattern>[0], "repeat");
  pattern.setTransform(new DOMMatrix().scaleSelf(TEX_WORLD / TEX_PX, TEX_WORLD / TEX_PX));
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);

  // Paint, one band at a time so memory stays flat however busy the canvas is.
  const grid = tileGrid(0, world, CHUNK);
  for (let y = 0; y < grid.ny; y++) {
    const band = { minX: 0, minY: y * grid.cw - 8, maxX: W, maxY: (y + 1) * grid.cw + 8 };
    const store = new StrokeStore();
    for (const row of await strokesIn(sb, canvas.id, band)) store.put(rowToStroke(row));
    if (store.size === 0) continue;
    const renderer = new ChunkRenderer(store, world, () => true);
    for (let x = 0; x < grid.nx; x++) {
      const tile = renderer.renderChunk(0, x, y) as unknown as Canvas;
      ctx.drawImage(tile, x * grid.cw, y * grid.cw);
    }
  }

  // The weave shows through the paint, exactly as in the studio.
  const relief = ctx.createPattern(tex.relief as unknown as Parameters<typeof ctx.createPattern>[0], "repeat");
  relief.setTransform(new DOMMatrix().scaleSelf(TEX_WORLD / TEX_PX, TEX_WORLD / TEX_PX));
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = relief;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  const full = await out.encode("jpeg", 92);
  let { error } = await sb.storage.from(FINALS_BUCKET).upload(finalPath(canvas.id), full, {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: true,
  });
  if (error) throw error;

  // Public preview: reduced, and watermarked so a screenshot is never as good as the real thing.
  const pw = PREVIEW_WIDTH;
  const ph = Math.round((PREVIEW_WIDTH * H) / W);
  const prev = createCanvas(pw, ph);
  const p = prev.getContext("2d");
  p.imageSmoothingEnabled = true;
  p.imageSmoothingQuality = "high";
  p.drawImage(out, 0, 0, pw, ph);
  p.save();
  p.translate(pw / 2, ph / 2);
  p.rotate(-Math.PI / 7);
  p.font = `400 ${Math.round(pw / 30)}px "IM Fell English SC", serif`;
  p.textAlign = "center";
  p.textBaseline = "middle";
  const step = pw / 5;
  for (let yy = -ph; yy <= ph; yy += step * 0.55) {
    for (let xx = -pw; xx <= pw; xx += step * 1.4) {
      const off = (Math.round(yy / (step * 0.55)) % 2) * step * 0.7;
      p.fillStyle = "rgba(255, 255, 255, 0.34)";
      p.fillText("oneart · preview", xx + off, yy);
      p.fillStyle = "rgba(30, 20, 10, 0.12)";
      p.fillText("oneart · preview", xx + off + 2, yy + 2);
    }
  }
  p.restore();
  ({ error } = await sb.storage.from(TILE_BUCKET).upload(previewPath(canvas.id), await prev.encode("jpeg", 82), {
    contentType: "image/jpeg",
    cacheControl: "3600",
    upsert: true,
  }));
  if (error) throw error;

  const { error: upErr } = await sb
    .from("canvases")
    .update({ final_ready_at: new Date().toISOString(), final_width: W, final_height: H })
    .eq("id", canvas.id);
  if (upErr) throw upErr;
  console.log(`[final] ${canvas.slug}: ${W}x${H}, ${(full.length / 1e6).toFixed(1)} MB`);
}

// ---- Lifecycle emails ----------------------------------------------------------------------------

async function sendNotices(sb: SupabaseClient, canvas: CanvasRow) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  if (!key || !from) return;
  const now = Date.now();
  const closes = Date.parse(canvas.closes_at);
  const kinds: ("three_days_left" | "closed")[] = [];
  if (now >= closes) kinds.push("closed");
  else if (closes - now <= 3 * 86400_000 && now >= Date.parse(canvas.opens_at)) kinds.push("three_days_left");

  for (const kind of kinds) {
    // Claim the notice first, so two workers can never send it twice.
    const { error: claimErr } = await sb.from("canvas_notices").insert({ canvas_id: canvas.id, kind });
    if (claimErr) continue; // already sent (primary key) or not allowed
    const { data, error } = await sb.rpc("worker_participants", { p_canvas: canvas.id });
    if (error) throw error;
    const people = (data ?? []) as { email: string; username: string }[];
    const subject = kind === "closed" ? `"${canvas.title}" is finished` : `3 days left to paint on "${canvas.title}"`;
    let sent = 0;
    for (const p of people) {
      const body =
        kind === "closed"
          ? `Hi ${p.username},\n\nThe canvas you painted on is finished. Every stroke is final, including yours.\nCome and see the whole piece, and get your own copy: ${site}/piece\n\noneart`
          : `Hi ${p.username},\n\nThere are 3 days left on "${canvas.title}". If you want to add anything, now's the time: ${site}/canvas\n\noneart`;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: p.email, subject, text: body }),
      });
      if (res.ok) sent++;
      await new Promise((r) => setTimeout(r, 120)); // stay under the provider's rate limit
    }
    await sb.from("canvas_notices").update({ recipients: sent }).eq("canvas_id", canvas.id).eq("kind", kind);
    console.log(`[notices] ${canvas.slug} ${kind}: ${sent}/${people.length}`);
  }
}

// ---- Loop ----------------------------------------------------------------------------------------

async function pass(sb: SupabaseClient) {
  // Canvases that are open, or closed in the last two days (one last bake after closing).
  const since = new Date(Date.now() - 2 * 86400_000).toISOString();
  const { data, error } = await sb
    .from("canvases")
    .select("id,slug,title,width,height,opens_at,closes_at,final_ready_at")
    .lte("opens_at", new Date().toISOString())
    .gte("closes_at", since);
  if (error) throw error;
  for (const c of (data ?? []) as CanvasRow[]) {
    try {
      const r = await bakeCanvas(sb, c);
      if (r.changed) console.log(`[tiles] ${r.canvas}: repainted ${r.changed} tiles`);
    } catch (err) {
      console.error(`[tiles] ${c.slug} failed:`, err);
    }
    // Ten minutes after closing (so the last strokes and moderation have settled), render the final piece.
    if (!c.final_ready_at && Date.now() > Date.parse(c.closes_at) + 10 * 60_000) {
      try {
        await renderFinal(sb, c);
      } catch (err) {
        console.error(`[final] ${c.slug} failed:`, err);
      }
    }
    try {
      await sendNotices(sb, c);
    } catch (err) {
      console.error(`[notices] ${c.slug} failed:`, err);
    }
  }
}

async function main() {
  if (!url || !serviceKey) {
    console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the worker.");
    process.exit(1);
  }
  const sb = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const once = process.argv.includes("--once");
  for (;;) {
    const t0 = Date.now();
    try {
      await pass(sb);
    } catch (err) {
      console.error("[worker] pass failed:", err);
    }
    if (once) return;
    await new Promise((r) => setTimeout(r, Math.max(10_000, intervalMin * 60_000 - (Date.now() - t0))));
  }
}

// Run when started directly (npm run worker), not when imported by a test.
if (require.main === module) void main();

export { bakeCanvas, renderFinal };
