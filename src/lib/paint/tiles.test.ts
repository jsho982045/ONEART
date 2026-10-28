import { describe, expect, it } from "vitest";
import { MANIFEST_VERSION, isManifest, tileGrid, tileKey, tilePath } from "./tiles";

describe("tiles", () => {
  it("accepts a good manifest and rejects anything odd (it's fetched from storage)", () => {
    const good = { version: MANIFEST_VERSION, maxId: 10, bakedAt: "x", lods: [-7, -2], tiles: { "-2:0:0": "abc1" } };
    expect(isManifest(good)).toBe(true);
    expect(isManifest({ ...good, version: 1 })).toBe(false);
    expect(isManifest({ ...good, tiles: { "-2:0:0": "../../etc" } })).toBe(false);
    expect(isManifest({ ...good, lods: [1.5] })).toBe(false);
    expect(isManifest(null)).toBe(false);
  });

  it("covers the whole canvas at every level", () => {
    const w = { width: 12000, height: 8000 };
    expect(tileGrid(-2, w)).toEqual({ cw: 1024, nx: 12, ny: 8 });
    expect(tileGrid(-7, w)).toEqual({ cw: 32768, nx: 1, ny: 1 });
  });

  it("names tiles so a new revision never collides with a cached old one", () => {
    expect(tileKey(-3, 1, 2)).toBe("-3:1:2");
    expect(tilePath("c", -3, 1, 2, "r1")).not.toBe(tilePath("c", -3, 1, 2, "r2"));
  });
});
