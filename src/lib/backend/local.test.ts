import { beforeEach, describe, expect, it } from "vitest";
import { encodePoints } from "@/lib/paint/codec";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const g = globalThis as unknown as { localStorage: MemoryStorage; sessionStorage: MemoryStorage };

beforeEach(() => {
  g.localStorage = new MemoryStorage();
  g.sessionStorage = new MemoryStorage();
});

const stroke = (x = 100) => ({
  tool: "ink" as const,
  color: "#112233",
  size: 4,
  opacity: 1,
  points: encodePoints([
    { x, y: 100, p: 0.5 },
    { x: x + 50, y: 100, p: 0.5 },
  ]),
});

describe("local test mode", () => {
  it("paints, persists and loads by region", async () => {
    const { LocalBackend } = await import("./local");
    const b = new LocalBackend();
    const c = (await b.getCanvas())!;
    const row = await b.drawStroke(c.id, stroke());
    expect(row.id).toBe(1);
    expect(await b.loadStrokes(c.id, { minX: 0, minY: 0, maxX: 500, maxY: 500 })).toHaveLength(1);
    expect(await b.loadStrokes(c.id, { minX: 5000, minY: 5000, maxX: 6000, maxY: 6000 })).toHaveLength(0);
  });

  it("each tab is a different artist, and you can only erase your own work", async () => {
    const { LocalBackend } = await import("./local");
    const a = new LocalBackend();
    const row = await a.drawStroke("local", stroke());
    g.sessionStorage = new MemoryStorage(); // a second tab
    const other = new LocalBackend();
    const me = await other.getMe();
    expect(me.artistNo).not.toBe(row.artist_no);
    await expect(other.setErased(row.id, true)).rejects.toThrow("not_yours");
  });

  it("enforces the ink well like the database", async () => {
    const { LocalBackend } = await import("./local");
    const b = new LocalBackend();
    const huge = {
      ...stroke(),
      size: 200,
      points: encodePoints(Array.from({ length: 50 }, (_, i) => ({ x: 100 + i * 200, y: 4000, p: 0.5 }))),
    };
    await b.drawStroke("local", huge);
    await expect(b.drawStroke("local", stroke())).rejects.toThrow("out_of_ink");
  });
});
