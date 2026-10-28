export type ToolId = "pencil" | "ink" | "oil" | "watercolor" | "charcoal" | "text";
export type FontId = "hand" | "serif" | "sans";

export type ToolSpec = {
  id: ToolId;
  name: string;
  /** One line shown under the tool name. */
  hint: string;
  /** Size in canvas units (a brush keeps its physical size when you zoom, like a real one). */
  minSize: number;
  maxSize: number;
  defaultSize: number;
  defaultOpacity: number;
  /** perfect-freehand thinning: how much pressure changes width. */
  thinning: number;
  /** Fraction of the size that counts as "claimed" canvas for the no-overpainting rule. */
  footprint: number;
};

export const TOOLS: Record<ToolId, ToolSpec> = {
  pencil: {
    id: "pencil",
    name: "Pencil",
    hint: "Graphite. Catches the weave.",
    minSize: 1,
    maxSize: 24,
    defaultSize: 3,
    defaultOpacity: 0.9,
    thinning: 0.35,
    footprint: 0.7,
  },
  ink: {
    id: "ink",
    name: "Ink",
    hint: "Dip pen. Crisp and dark.",
    minSize: 1,
    maxSize: 40,
    defaultSize: 4,
    defaultOpacity: 1,
    thinning: 0.65,
    footprint: 0.75,
  },
  oil: {
    id: "oil",
    name: "Oil",
    hint: "Bristle brush. Thick paint.",
    minSize: 4,
    maxSize: 220,
    defaultSize: 28,
    defaultOpacity: 1,
    thinning: 0.25,
    footprint: 0.72,
  },
  watercolor: {
    id: "watercolor",
    name: "Watercolor",
    hint: "Wet wash. Layers glow.",
    minSize: 6,
    maxSize: 300,
    defaultSize: 46,
    defaultOpacity: 0.85,
    thinning: 0.2,
    footprint: 0.68,
  },
  charcoal: {
    id: "charcoal",
    name: "Charcoal",
    hint: "Soft, smoky, dramatic.",
    minSize: 3,
    maxSize: 90,
    defaultSize: 14,
    defaultOpacity: 0.85,
    thinning: 0.4,
    footprint: 0.65,
  },
  text: {
    id: "text",
    name: "Letters",
    hint: "Sign it, title it, say something.",
    minSize: 12,
    maxSize: 400,
    defaultSize: 36,
    defaultOpacity: 1,
    thinning: 0,
    footprint: 0.8,
  },
};

export const BRUSH_ORDER: ToolId[] = ["pencil", "ink", "charcoal", "watercolor", "oil", "text"];

/**
 * Lettering styles. The ids are stored with every text stroke (database check constraint), so they stay
 * fixed; the faces behind them are a copperplate signature hand, Fell italic (17th-century book type) and
 * Roman inscriptional capitals.
 */
export const FONTS: Record<FontId, { name: string; family: string; css: string; scale: number }> = {
  hand: { name: "Signature", family: '"Mrs Saint Delafield", cursive', css: "400", scale: 1.5 },
  serif: { name: "Folio", family: '"IM Fell English", Georgia, serif', css: "italic 400", scale: 1.05 },
  sans: { name: "Roman", family: '"Cinzel Variable", "Cinzel", Georgia, serif', css: "500", scale: 0.92 },
};

/** Named pigments: real paint names, so the palette feels like a paint box, not a color picker. */
export const PIGMENTS: { name: string; hex: string }[] = [
  { name: "Ivory Black", hex: "#1f1d1b" },
  { name: "Payne's Grey", hex: "#3b4552" },
  { name: "Titanium White", hex: "#f7f5ef" },
  { name: "Naples Yellow", hex: "#f1d38b" },
  { name: "Cadmium Yellow", hex: "#f2b705" },
  { name: "Yellow Ochre", hex: "#c99a3b" },
  { name: "Cadmium Orange", hex: "#e8731a" },
  { name: "Cadmium Red", hex: "#c8261d" },
  { name: "Alizarin Crimson", hex: "#8e1b2c" },
  { name: "Quinacridone Rose", hex: "#cf3f74" },
  { name: "Dioxazine Violet", hex: "#4b2a6b" },
  { name: "Ultramarine", hex: "#1f3a93" },
  { name: "Cerulean", hex: "#2f7fbf" },
  { name: "Phthalo Turquoise", hex: "#0f7c7a" },
  { name: "Viridian", hex: "#2e6b4f" },
  { name: "Sap Green", hex: "#4f7a28" },
  { name: "Burnt Sienna", hex: "#9a4a25" },
  { name: "Raw Umber", hex: "#6a5236" },
  { name: "Burnt Umber", hex: "#4a3021" },
  { name: "Flesh Tint", hex: "#e9b99a" },
];

export function isHexColor(s: string): boolean {
  return /^#[0-9a-f]{6}$/.test(s);
}
