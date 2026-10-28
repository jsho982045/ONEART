import { shade } from "./color";
import { bristleTracks, footprintOutline, isDab, strokeOutline, wobble, type Vec } from "./geometry";
import { seeded } from "./rng";
import type { Stroke } from "./stroke";
import { TEX_PX, TEX_WORLD, getTextures } from "./textures";
import { FONTS } from "./tools";

/**
 * Paints one stroke onto a 2D context whose current transform maps canvas (world) units to pixels.
 * The context must be an isolated, transparent layer holding only this stroke: brushes use
 * compositing tricks (watercolor rims, tooth masks) that would otherwise affect paint underneath.
 * `density` is pixels per world unit at that transform; fine texture is skipped when it would only alias.
 */
export type PaintEnv = { density: number };

type Paintable = Pick<Stroke, "tool" | "color" | "size" | "opacity" | "points" | "body" | "font" | "seed" | "bbox">;

export function paintStroke(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv): void {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (s.tool) {
    case "pencil":
      paintPencil(ctx, s, env);
      break;
    case "ink":
      paintInk(ctx, s);
      break;
    case "charcoal":
      paintCharcoal(ctx, s, env);
      break;
    case "watercolor":
      paintWatercolor(ctx, s, env);
      break;
    case "oil":
      paintOil(ctx, s, env);
      break;
    case "text":
      paintText(ctx, s, env);
      break;
  }
  ctx.restore();
}

/** Solid silhouette of the canvas this stroke claims (used for the no-overpainting rule). */
export function paintFootprint(ctx: CanvasRenderingContext2D, s: Paintable): void {
  if (s.points.length === 0) return;
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.globalAlpha = 1;
  if (s.tool === "text") {
    const p = s.points[0];
    withFittedText(ctx, s, () => ctx.fillText(s.body ?? "", p.x, p.y));
  } else {
    ctx.fill(polyPath(footprintOutline(s.points, s.tool, s.size)));
  }
  ctx.restore();
}

export function polyPath(poly: Vec[]): Path2D {
  const p = new Path2D();
  const n = poly.length;
  if (n < 3) return p;
  p.moveTo((poly[0][0] + poly[1][0]) / 2, (poly[0][1] + poly[1][1]) / 2);
  for (let i = 1; i <= n; i++) {
    const a = poly[i % n];
    const b = poly[(i + 1) % n];
    p.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  p.closePath();
  return p;
}

// ---- Canvas tooth: dry media and pigment granules settle into the weave --------------------------

const patternCache = new WeakMap<CanvasRenderingContext2D, { hard: CanvasPattern; soft: CanvasPattern }>();

function tooth(ctx: CanvasRenderingContext2D, kind: "hard" | "soft"): CanvasPattern | null {
  let p = patternCache.get(ctx);
  if (!p) {
    const t = getTextures();
    const hard = ctx.createPattern(t.toothHard, "repeat");
    const soft = ctx.createPattern(t.toothSoft, "repeat");
    if (!hard || !soft) return null;
    const m = new DOMMatrix().scaleSelf(TEX_WORLD / TEX_PX, TEX_WORLD / TEX_PX);
    hard.setTransform(m);
    soft.setTransform(m);
    p = { hard, soft };
    patternCache.set(ctx, p);
  }
  return p[kind];
}

/** Keeps only the pigment that lands on raised threads. Skipped when zoomed out (it would just shimmer). */
function applyTooth(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv, kind: "hard" | "soft") {
  if (env.density < 0.55) return;
  const pat = tooth(ctx, kind);
  if (!pat) return;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = pat;
  const b = s.bbox;
  ctx.fillRect(b.minX - 2, b.minY - 2, b.maxX - b.minX + 4, b.maxY - b.minY + 4);
  ctx.restore();
}

/** When the weave can't be shown, dry media still read lighter, as they do from across a room. */
function farAlpha(env: PaintEnv, kind: "hard" | "soft") {
  if (env.density >= 0.55) return 1;
  return kind === "hard" ? 0.72 : 0.9;
}

// ---- Media ---------------------------------------------------------------------------------------

function paintPencil(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv) {
  const path = polyPath(strokeOutline(s.points, "pencil", s.size));
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.opacity * 0.95 * farAlpha(env, "hard");
  ctx.fill(path);
  // A second, tighter pass where pressure is high: graphite builds up and gets glossier.
  ctx.globalAlpha = s.opacity * 0.35 * farAlpha(env, "hard");
  ctx.fill(polyPath(strokeOutline(s.points, "pencil", s.size * 0.55)));
  applyTooth(ctx, s, env, "hard");
}

function paintInk(ctx: CanvasRenderingContext2D, s: Paintable) {
  const path = polyPath(strokeOutline(s.points, "ink", s.size));
  ctx.fillStyle = s.color;
  ctx.globalAlpha = s.opacity;
  ctx.fill(path);
  // Ink pools at the edges as it dries.
  ctx.strokeStyle = shade(s.color, -0.35);
  ctx.lineWidth = Math.max(0.35, s.size * 0.09);
  ctx.globalAlpha = s.opacity * 0.4;
  ctx.stroke(path);
}

function paintCharcoal(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv) {
  ctx.fillStyle = s.color;
  for (let k = 0; k < 3; k++) {
    const poly = wobble(strokeOutline(s.points, "charcoal", s.size * (0.8 + 0.14 * k)), s.size * 0.1, s.seed + k * 101);
    ctx.globalAlpha = s.opacity * 0.4 * farAlpha(env, "hard");
    ctx.fill(polyPath(poly));
  }
  applyTooth(ctx, s, env, "hard");
  // Fine dust that falls off the stick and settles beside the line.
  if (env.density < 0.8) return;
  const rand = seeded(s.seed ^ 0xc0ffee);
  const n = Math.min(900, Math.round(s.points.length * 3 + 12));
  ctx.globalAlpha = s.opacity * 0.22;
  for (let i = 0; i < n; i++) {
    const p = s.points[Math.floor(rand() * s.points.length)];
    const a = rand() * Math.PI * 2;
    const r = s.size * (0.35 + 0.75 * Math.sqrt(rand()));
    const d = Math.max(0.12, s.size * (0.008 + rand() * 0.022));
    ctx.fillRect(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, d, d);
  }
}

/**
 * Watercolor, painted in an isolated layer (every caller paints a stroke on its own transparent layer):
 * a dark drying rim, then several translucent washes slipped in behind it, and a faint bloom.
 */
function paintWatercolor(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv) {
  const outer = polyPath(wobble(strokeOutline(s.points, "watercolor", s.size), s.size * 0.05, s.seed));
  const inner = polyPath(wobble(strokeOutline(s.points, "watercolor", Math.max(1, s.size * 0.9)), s.size * 0.05, s.seed + 3));
  // 1. The rim: pigment that migrated to the drying edge.
  ctx.fillStyle = shade(s.color, -0.18);
  ctx.globalAlpha = s.opacity * 0.42;
  ctx.fill(outer);
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 0.82;
  ctx.fill(inner);
  // 2. Washes behind the rim, each with its own wandering edge.
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = shade(s.color, 0.05);
  for (let k = 0; k < 4; k++) {
    const poly = wobble(strokeOutline(s.points, "watercolor", s.size * (0.8 + 0.07 * k)), s.size * 0.05, s.seed + k * 37);
    ctx.globalAlpha = s.opacity * 0.16;
    ctx.fill(polyPath(poly));
  }
  // 3. A faint bloom where the water spread past the brush.
  ctx.globalAlpha = s.opacity * 0.06;
  ctx.fill(polyPath(wobble(strokeOutline(s.points, "watercolor", s.size * 1.12), s.size * 0.08, s.seed + 9)));
  ctx.globalCompositeOperation = "source-over";
  applyTooth(ctx, s, env, "soft");
}

function paintOil(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv) {
  if (isDab(s.points, s.size)) {
    // A single press of a loaded brush: a thick dab with a wet highlight.
    const dab = polyPath(wobble(strokeOutline(s.points, "oil", s.size), s.size * 0.06, s.seed));
    ctx.fillStyle = s.color;
    ctx.globalAlpha = s.opacity;
    ctx.fill(dab);
    if (env.density > 0.35) {
      ctx.strokeStyle = shade(s.color, -0.3);
      ctx.lineWidth = Math.max(0.5, s.size * 0.06);
      ctx.globalAlpha = s.opacity * 0.35;
      ctx.stroke(dab);
      const p = s.points[0];
      ctx.fillStyle = shade(s.color, 0.6);
      ctx.globalAlpha = s.opacity * 0.35;
      ctx.beginPath();
      ctx.ellipse(p.x - s.size * 0.14, p.y - s.size * 0.16, s.size * 0.16, s.size * 0.07, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const bristles = bristleTracks(s.points, s.size, s.opacity, s.seed);
  // 0. Impasto: thick paint stands off the canvas, so the lamp (top left) throws a soft shadow down-right.
  if (env.density > 0.35) {
    ctx.save();
    ctx.filter = `blur(${Math.max(0.6, s.size * 0.05 * env.density)}px)`;
    for (const b of bristles) {
      ctx.strokeStyle = shade(s.color, -0.75);
      ctx.lineWidth = b.width * 1.9;
      strokeByLoad(ctx, b.pts, b.load, s.size * 0.06, s.size * 0.09, s.opacity * 0.16);
    }
    ctx.restore();
  }
  // 1. The body of paint: overlapping bristle tracks merge into one stroke that thins out as it dries.
  for (const b of bristles) {
    ctx.strokeStyle = shade(s.color, b.tone * 0.06);
    ctx.lineWidth = b.width * 1.9;
    strokeByLoad(ctx, b.pts, b.load, 0, 0, s.opacity);
  }
  if (env.density <= 0.35) return;
  // 2. Ridges: the valleys a few stiff bristles combed through the paint, and the light catching the crests.
  const rand = seeded(s.seed ^ 0x51ed);
  for (const b of bristles) {
    const r = rand();
    if (r < 0.3) {
      ctx.strokeStyle = shade(s.color, -0.28);
      ctx.lineWidth = Math.max(0.3, b.width * 0.35);
      strokeByLoad(ctx, b.pts, b.load, b.width * 0.5, b.width * 0.6, s.opacity * 0.4);
    } else if (r > 0.72) {
      ctx.strokeStyle = shade(s.color, 0.5);
      ctx.lineWidth = Math.max(0.3, b.width * 0.3);
      strokeByLoad(ctx, b.pts, b.load, -b.width * 0.35, -b.width * 0.45, s.opacity * 0.33);
    }
  }
}

/** Draws a polyline whose alpha follows the bristle's remaining paint, batching equal-alpha runs. */
function strokeByLoad(ctx: CanvasRenderingContext2D, pts: Vec[], load: number[], ox: number, oy: number, alpha: number) {
  if (pts.length === 1) {
    ctx.globalAlpha = alpha * load[0];
    ctx.beginPath();
    ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
    ctx.lineTo(pts[0][0] + ox + 0.01, pts[0][1] + oy);
    ctx.stroke();
    return;
  }
  let level = -1;
  let path: Path2D | null = null;
  const flush = () => {
    if (path && level > 0) {
      ctx.globalAlpha = alpha * level;
      ctx.stroke(path);
    }
  };
  for (let i = 1; i < pts.length; i++) {
    const l = Math.round(Math.min(load[i - 1], load[i]) * 8) / 8;
    if (l !== level) {
      flush();
      level = l;
      path = new Path2D();
      path.moveTo(pts[i - 1][0] + ox, pts[i - 1][1] + oy);
    }
    path!.lineTo(pts[i][0] + ox, pts[i][1] + oy);
  }
  flush();
}

function setFont(ctx: CanvasRenderingContext2D, s: Paintable) {
  const f = FONTS[s.font ?? "hand"];
  ctx.font = `${f.css} ${s.size * f.scale}px ${f.family}`;
  ctx.textBaseline = "alphabetic";
}

/**
 * Lettering must stay inside the box the database stores for it (that box decides which parts of the canvas
 * repaint). Flourishing script faces can run long, so the words are scaled down to fit when they would not.
 */
function fitText(ctx: CanvasRenderingContext2D, s: Paintable) {
  const p = s.points[0];
  const body = s.body ?? "";
  const m = ctx.measureText(body);
  const left = m.actualBoundingBoxLeft || 0;
  const right = m.actualBoundingBoxRight || m.width;
  const asc = m.actualBoundingBoxAscent || s.size;
  const desc = m.actualBoundingBoxDescent || 0;
  const roomL = p.x - s.bbox.minX - 1;
  const roomR = s.bbox.maxX - p.x - 1;
  const roomUp = p.y - s.bbox.minY - 1;
  const roomDown = s.bbox.maxY - p.y - 1;
  return Math.min(1, roomR / Math.max(1, right), roomL / Math.max(0.01, left), roomUp / Math.max(1, asc), roomDown / Math.max(0.01, desc));
}

function withFittedText(ctx: CanvasRenderingContext2D, s: Paintable, draw: () => void) {
  setFont(ctx, s);
  const k = fitText(ctx, s);
  const p = s.points[0];
  ctx.save();
  if (k < 1) {
    ctx.translate(p.x, p.y);
    ctx.scale(k, k);
    ctx.translate(-p.x, -p.y);
  }
  draw();
  ctx.restore();
}

/** Lettering is brushed on with a sign-writer's brush: solid paint, slightly heavier at the edges. */
function paintText(ctx: CanvasRenderingContext2D, s: Paintable, env: PaintEnv) {
  const p = s.points[0];
  const body = s.body ?? "";
  withFittedText(ctx, s, () => {
    // The paint stands slightly proud of the canvas: a soft shadow first, then the letters, then a
    // little light catching their top edges.
    if (env.density > 0.5) {
      ctx.fillStyle = shade(s.color, -0.65);
      ctx.globalAlpha = s.opacity * 0.22;
      ctx.fillText(body, p.x + s.size * 0.025, p.y + s.size * 0.035);
    }
    ctx.fillStyle = s.color;
    ctx.globalAlpha = s.opacity;
    ctx.fillText(body, p.x, p.y);
    if (env.density > 0.5) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = shade(s.color, 0.55);
      ctx.globalAlpha = s.opacity * 0.22;
      ctx.fillText(body, p.x - s.size * 0.012, p.y - s.size * 0.018);
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = shade(s.color, -0.3);
      ctx.lineWidth = Math.max(0.3, s.size * 0.012);
      ctx.globalAlpha = s.opacity * 0.35;
      ctx.strokeText(body, p.x, p.y);
    }
  });
}
