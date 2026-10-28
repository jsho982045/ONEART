import { describe, expect, it } from "vitest";
import { encodePoints } from "./codec";
import { StrokeStore, rowToStroke, type StrokeRow } from "./store";
import { ownerKey, seedFor, strokeBounds } from "./stroke";

function row(id: number, x: number, y: number, extra: Partial<StrokeRow> = {}): StrokeRow {
  const pts = [{ x, y, p: 0.5 }, { x: x + 10, y, p: 0.5 }];
  const b = strokeBounds("ink", 4, pts);
  return {
    id,
    canvas_id: "c",
    artist_no: 1,
    tool: "ink",
    color: "#000000",
    size: 4,
    opacity: 1,
    points: encodePoints(pts),
    body: null,
    font: null,
    min_x: b.minX,
    min_y: b.minY,
    max_x: b.maxX,
    max_y: b.maxY,
    erased: false,
    hidden: false,
    created_at: new Date().toISOString(),
    ...extra,
  };
}

describe("stroke store", () => {
  it("returns strokes that touch a region, in paint order", () => {
    const s = new StrokeStore();
    s.put(rowToStroke(row(3, 100, 100)));
    s.put(rowToStroke(row(1, 105, 100)));
    s.put(rowToStroke(row(2, 5000, 5000)));
    const hit = s.query({ minX: 90, minY: 90, maxX: 130, maxY: 110 });
    expect(hit.map((x) => x.id)).toEqual([1, 3]);
    expect(s.maxConfirmedId).toBe(3);
  });

  it("finds strokes that span index cells only once", () => {
    const s = new StrokeStore();
    const wide = row(9, 500, 500);
    wide.max_x = 2000;
    s.put(rowToStroke(wide));
    expect(s.query({ minX: 0, minY: 0, maxX: 3000, maxY: 3000 })).toHaveLength(1);
  });

  it("updates and removals re-index correctly", () => {
    const s = new StrokeStore();
    s.put(rowToStroke(row(1, 100, 100)));
    s.put(rowToStroke(row(1, 4000, 4000)));
    expect(s.query({ minX: 0, minY: 0, maxX: 300, maxY: 300 })).toHaveLength(0);
    expect(s.query({ minX: 3900, minY: 3900, maxX: 4100, maxY: 4100 })).toHaveLength(1);
    s.remove(1);
    expect(s.size).toBe(0);
  });

  it("hidden strokes arrive without geometry", () => {
    const st = rowToStroke(row(5, 10, 10, { hidden: true, points: "" }));
    expect(st.points).toEqual([]);
    expect(st.hidden).toBe(true);
  });
});

describe("strokes", () => {
  it("the texture seed is the same while painting and after saving", () => {
    const raw = [
      { x: 10.11, y: 20.07, p: 0.512 },
      { x: 30.6, y: 40.33, p: 0.7 },
      { x: 31, y: 41, p: 0.7 },
      { x: 33, y: 42, p: 0.7 },
    ];
    const saved = rowToStroke(row(1, 0, 0, { points: encodePoints([...raw, { x: 99, y: 99, p: 1 }]) }));
    expect(seedFor(raw)).toBe(saved.seed);
  });

  it("deleted accounts keep their ink protected under a unique owner", () => {
    expect(ownerKey({ artist: 4, id: 10 })).toBe(4);
    expect(ownerKey({ artist: null, id: 10 })).toBe(-11);
    expect(ownerKey({ artist: null, id: 10 })).not.toBe(ownerKey({ artist: null, id: 11 }));
  });
});
