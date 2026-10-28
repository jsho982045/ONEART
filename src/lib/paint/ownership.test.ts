import { describe, expect, it } from "vitest";
import { applyOwnership, blockedMask } from "./ownership";

/** 1-row helpers: footprint alpha per pixel -> RGBA. */
const rgba = (alphas: number[]) => {
  const out = new Uint8ClampedArray(alphas.length * 4);
  alphas.forEach((a, i) => (out[i * 4 + 3] = a));
  return out;
};
const allowed = (allow: Uint8ClampedArray) => Array.from({ length: allow.length / 4 }, (_, i) => allow[i * 4 + 3] === 255);

describe("no painting over other people", () => {
  it("bare canvas: paint lands and the footprint is claimed", () => {
    const owners = new Int32Array(4);
    const allow = new Uint8ClampedArray(16);
    const blocked = applyOwnership(owners, 4, 0, 0, 4, 1, 7, rgba([255, 255, 0, 0]), allow);
    expect(blocked).toBe(0);
    expect(Array.from(owners)).toEqual([7, 7, 0, 0]);
    expect(allowed(allow)).toEqual([true, true, true, true]);
  });

  it("someone else's paint blocks yours, pixel for pixel", () => {
    const owners = Int32Array.from([7, 7, 0, 0]);
    const allow = new Uint8ClampedArray(16);
    const blocked = applyOwnership(owners, 4, 0, 0, 4, 1, 9, rgba([255, 255, 255, 255]), allow);
    expect(blocked).toBe(2);
    expect(allowed(allow)).toEqual([false, false, true, true]);
    expect(Array.from(owners)).toEqual([7, 7, 9, 9]);
  });

  it("you can always paint over your own work", () => {
    const owners = Int32Array.from([7, 7, 7, 0]);
    const allow = new Uint8ClampedArray(16);
    expect(applyOwnership(owners, 4, 0, 0, 4, 1, 7, rgba([255, 255, 255, 255]), allow)).toBe(0);
    expect(allowed(allow)).toEqual([true, true, true, true]);
  });

  it("soft edges outside the footprint never claim canvas (the tolerance)", () => {
    const owners = new Int32Array(4);
    applyOwnership(owners, 4, 0, 0, 4, 1, 7, rgba([0, 255, 255, 0]), new Uint8ClampedArray(16));
    const allow = new Uint8ClampedArray(16);
    applyOwnership(owners, 4, 0, 0, 4, 1, 9, rgba([255, 0, 0, 255]), allow);
    // Pixel 0 and 3 were only touched by 7's soft edge, so 9 may paint there.
    expect(allowed(allow)).toEqual([true, false, false, true]);
  });

  it("works on a sub-rectangle of a bigger chunk", () => {
    const stride = 3;
    const owners = new Int32Array(9);
    owners[4] = 5; // centre pixel
    const allow = new Uint8ClampedArray(4 * 4);
    const blocked = applyOwnership(owners, stride, 1, 1, 2, 2, 8, rgba([255, 255, 255, 255]), allow);
    expect(blocked).toBe(1);
    expect(allowed(allow)).toEqual([false, true, true, true]);
    expect(owners[5]).toBe(8);
    expect(owners[7]).toBe(8);
    expect(owners[8]).toBe(8);
  });

  it("the live-preview mask marks exactly other people's pixels", () => {
    const out = new Uint8ClampedArray(16);
    blockedMask(Int32Array.from([0, 3, 7, 3]), 3, out);
    expect(allowed(out)).toEqual([false, false, true, false]);
  });
});
