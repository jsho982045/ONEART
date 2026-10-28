/**
 * The "you can't paint over someone else" rule, as pure array maths so it can be unit tested.
 *
 * Every chunk of the canvas keeps an owner buffer: one entry per pixel holding the owner key of the
 * first stroke whose footprint covered that pixel (0 = bare canvas). Strokes are applied in paint order:
 *
 *   - Footprint pixels on bare canvas are claimed by the stroke's owner.
 *   - The stroke's paint is kept only where the pixel is bare or already belongs to the same owner.
 *
 * Because the footprint is a little thinner than the visible stroke, the soft edge of a stroke never
 * claims anything: that margin is the tolerance that lets people paint right up to each other.
 */

/**
 * @param owners   owner buffer for the whole chunk (width `stride`)
 * @param footprint RGBA of the footprint for the region (any alpha > 0 = covered)
 * @param allow    RGBA output for the region: alpha 255 where paint may land, 0 where it is blocked
 * @returns number of pixels where paint was blocked
 */
export function applyOwnership(
  owners: Int32Array,
  stride: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  owner: number,
  footprint: Uint8ClampedArray,
  allow: Uint8ClampedArray,
): number {
  let blocked = 0;
  for (let y = 0; y < rh; y++) {
    let oi = (ry + y) * stride + rx;
    let pi = y * rw * 4;
    for (let x = 0; x < rw; x++, oi++, pi += 4) {
      const cur = owners[oi];
      const ok = cur === 0 || cur === owner;
      if (cur === 0 && footprint[pi + 3] > 0) owners[oi] = owner;
      allow[pi] = allow[pi + 1] = allow[pi + 2] = 0;
      allow[pi + 3] = ok ? 255 : 0;
      if (!ok) blocked++;
    }
  }
  return blocked;
}

/** Mask of pixels a given artist may NOT paint on (alpha 255 = blocked). Used for the live stroke preview. */
export function blockedMask(owners: Int32Array, me: number, out: Uint8ClampedArray): void {
  for (let i = 0, o = 0; i < owners.length; i++, o += 4) {
    const cur = owners[i];
    out[o] = out[o + 1] = out[o + 2] = 0;
    out[o + 3] = cur !== 0 && cur !== me ? 255 : 0;
  }
}
