/**
 * Baked overview tiles. The worker (scripts/worker.ts) renders the far-zoom levels of the canvas to
 * PNGs in Supabase Storage, so looking at the whole canvas never needs every stroke in the browser.
 *
 *   tiles/<canvas id>/manifest.json                    { version, maxId, bakedAt, lods, tiles }
 *   tiles/<canvas id>/<lod>/<x>_<y>.<rev>.png          256 px, immutable (cache forever)
 *
 * The finest baked level (BASE_LOD) is painted from strokes; every coarser level is downsampled from the
 * four tiles under it, so a bake only repaints the tiles that actually changed.
 */

export const BASE_LOD = -2;
export const TILE_LODS = [-7, -6, -5, -4, -3, -2] as const;
export const TILE_BUCKET = "tiles";
export const MANIFEST_VERSION = 2;

export type TileManifest = {
  version: number;
  /** Highest stroke id included in this bake. */
  maxId: number;
  bakedAt: string;
  lods: number[];
  /** "lod:x:y" -> revision. Missing = empty there. */
  tiles: Record<string, string>;
};

export const tileKey = (lod: number, x: number, y: number) => `${lod}:${x}:${y}`;
export const manifestPath = (canvasId: string) => `${canvasId}/manifest.json`;
export const tilePath = (canvasId: string, lod: number, x: number, y: number, rev: string) =>
  `${canvasId}/${lod}/${x}_${y}.${rev}.png`;

export function isManifest(m: unknown): m is TileManifest {
  const o = m as TileManifest;
  return (
    !!o &&
    o.version === MANIFEST_VERSION &&
    Number.isFinite(o.maxId) &&
    Array.isArray(o.lods) &&
    o.lods.every((l) => Number.isInteger(l)) &&
    typeof o.tiles === "object" &&
    o.tiles !== null &&
    Object.values(o.tiles).every((r) => typeof r === "string" && /^[a-z0-9]{1,16}$/.test(r))
  );
}

/** Tiles at `lod` covering a world of this size (CHUNK px tiles at 2^lod px per unit). */
export function tileGrid(lod: number, world: { width: number; height: number }, chunk = 256) {
  const cw = chunk / Math.pow(2, lod);
  return { cw, nx: Math.ceil(world.width / cw), ny: Math.ceil(world.height / cw) };
}
