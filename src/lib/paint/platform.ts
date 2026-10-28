/**
 * Where canvases come from. The browser uses <canvas>; the tile-baking worker on the server swaps in
 * @napi-rs/canvas so the exact same brush code paints the overview tiles.
 */
export type AnyCanvas = HTMLCanvasElement;

type Factory = (w: number, h: number) => AnyCanvas;

let factory: Factory = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

export function createCanvas(w: number, h: number): AnyCanvas {
  return factory(w, h);
}

export function setCanvasFactory(f: Factory) {
  factory = f;
}

export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
