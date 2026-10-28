/** Where the finished piece lives. Shared by the worker, the server routes and the /piece page. */
export const FINALS_BUCKET = "finals";
export const finalPath = (canvasId: string) => `${canvasId}/final.jpg`;
/** Watermarked, reduced preview, in the public tiles bucket. */
export const previewPath = (canvasId: string) => `${canvasId}/final-preview.jpg`;
export const PREVIEW_WIDTH = 2400;

export function formatPrice(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}
