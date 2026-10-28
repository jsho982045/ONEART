import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asRole, createUser, encode, freshDb } from "../../../scripts/pglite-supabase.mjs";
import { encodePoints, quantize } from "./codec";
import { strokeCost } from "./ink";
import { strokeBounds } from "./stroke";

/**
 * The browser predicts bounds and ink cost so the studio feels instant; the database is the authority.
 * These tests run the real migration and make sure the two can never drift apart.
 */
let db: PGlite;
let uid: string;
let canvas: string;

beforeAll(async () => {
  db = await freshDb();
  uid = await createUser(db, { email: "p@example.com", username: "parity" });
  canvas = ((await db.query("select id from public.canvases limit 1")).rows[0] as { id: string }).id;
}, 60_000);

const pts = quantize(
  Array.from({ length: 120 }, (_, i) => ({ x: 400 + i * 7.3, y: 900 + Math.cos(i / 9) * 60, p: 0.3 + (i % 10) / 15 })),
);

describe("TypeScript and SQL agree", () => {
  it("the test helper and the app encode identically", () => {
    expect(encode(pts.map((p) => [p.x, p.y, p.p]))).toBe(encodePoints(pts));
  });

  for (const tool of ["pencil", "oil", "watercolor"] as const) {
    it(`bounds and ink cost for ${tool}`, async () => {
      const size = 18;
      const { rows } = await asRole(db, "authenticated", uid, () =>
        db.query("select * from public.draw_stroke($1, $2, '#123456', $3, 1, $4)", [canvas, tool, size, encodePoints(pts)]),
      );
      const r = rows[0] as { min_x: number; min_y: number; max_x: number; max_y: number; ink_cost: number };
      const b = strokeBounds(tool, size, pts);
      expect(r.min_x).toBeCloseTo(b.minX, 2);
      expect(r.min_y).toBeCloseTo(b.minY, 2);
      expect(r.max_x).toBeCloseTo(b.maxX, 2);
      expect(r.max_y).toBeCloseTo(b.maxY, 2);
      expect(r.ink_cost / strokeCost(tool, size, pts)).toBeCloseTo(1, 4);
    });
  }

  it("bounds and ink cost for text", async () => {
    const anchor = quantize([{ x: 2000, y: 3000, p: 0.5 }]);
    const { rows } = await asRole(db, "authenticated", uid, () =>
      db.query("select * from public.draw_stroke($1, 'text', '#123456', 64, 1, $2, 'Hello world', 'hand')", [canvas, encodePoints(anchor)]),
    );
    const r = rows[0] as { min_x: number; min_y: number; max_x: number; max_y: number; ink_cost: number };
    const b = strokeBounds("text", 64, anchor, "Hello world");
    expect(r.min_x).toBeCloseTo(b.minX, 2);
    expect(r.min_y).toBeCloseTo(b.minY, 2);
    expect(r.max_x).toBeCloseTo(b.maxX, 2);
    expect(r.max_y).toBeCloseTo(b.maxY, 2);
    expect(r.ink_cost).toBeCloseTo(strokeCost("text", 64, anchor, "Hello world"), 1);
  });
});
