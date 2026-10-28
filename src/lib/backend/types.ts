import type { BBox } from "@/lib/paint/stroke";
import type { StrokeRow } from "@/lib/paint/store";
import type { TileManifest } from "@/lib/paint/tiles";
import type { FontId, ToolId } from "@/lib/paint/tools";

export type CanvasInfo = {
  id: string;
  slug: string;
  title: string;
  width: number;
  height: number;
  opensAt: string;
  closesAt: string;
  inkCapacity: number;
  inkRefillSeconds: number;
};

export type Me = {
  userId: string;
  username: string;
  artistNo: number;
  onboarded: boolean;
  emailVerified: boolean;
  isAdmin: boolean;
  banned: boolean;
  ink: number | null;
  /** ms since epoch */
  inkAt: number | null;
};

export type NewStroke = {
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  /** codec.ts encoding */
  points: string;
  body?: string;
  font?: FontId;
};

/** A stroke being painted right now, streamed to everyone else as it happens. */
export type LiveMessage = {
  key: string;
  artist: number;
  username: string;
  tool: ToolId;
  color: string;
  size: number;
  opacity: number;
  /** Index of the first point in `pts` within the whole stroke. */
  from: number;
  /** New points since the last message (codec.ts encoding), or "" */
  pts: string;
  done?: boolean;
};

export type Handlers = {
  onInsert: (row: StrokeRow) => void;
  onUpdate: (row: StrokeRow) => void;
  onLive: (msg: LiveMessage) => void;
  onPresence: (painting: number) => void;
  /** The connection dropped and came back: anything could have been missed. */
  onResync: () => void;
};

export type Connection = { sendLive: (msg: LiveMessage) => void; close: () => void };

export type ReportReason = "hate" | "sexual" | "violence" | "spam" | "personal_info" | "other";

export type AdminReport = {
  stroke_id: number;
  artist_no: number | null;
  username: string | null;
  tool: string;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
  hidden: boolean;
  reports: number;
  reasons: string[];
  last_report: string;
};

export interface Backend {
  readonly mode: "supabase" | "local";
  getCanvas(slug?: string): Promise<CanvasInfo | null>;
  getMe(): Promise<Me | null>;
  loadStrokes(canvasId: string, b: BBox): Promise<StrokeRow[]>;
  /** Every stroke (anywhere) with id > afterId, oldest first. Used on top of baked tiles. */
  loadSince(canvasId: string, afterId: number): Promise<StrokeRow[]>;
  /** Baked overview tiles, if the tile worker has run. */
  tileManifest(canvasId: string): Promise<{ manifest: TileManifest; tileUrl: (lod: number, x: number, y: number) => string | null } | null>;
  artistBounds(canvasId: string, artist: number): Promise<BBox[]>;
  drawStroke(canvasId: string, s: NewStroke): Promise<StrokeRow>;
  setErased(strokeId: number, erased: boolean): Promise<void>;
  artistNames(nos: number[]): Promise<Map<number, string>>;
  artistByUsername(username: string): Promise<number | null>;
  stats(canvasId: string): Promise<{ strokes: number; artists: number }>;
  report(strokeId: number, reason: ReportReason): Promise<void>;
  connect(canvasId: string, me: { artist: number; username: string } | null, h: Handlers): Connection;
  admin: {
    openReports(): Promise<AdminReport[]>;
    setHidden(strokeId: number, hidden: boolean): Promise<void>;
    banArtist(artist: number): Promise<number>;
    dismiss(strokeId: number): Promise<void>;
    listCanvases(): Promise<CanvasInfo[]>;
    saveCanvas(c: Omit<CanvasInfo, "id" | "width" | "height"> & { id: string | null }): Promise<CanvasInfo>;
  };
}

/** Friendly words for database error codes. Nothing here should ever sound like a computer. */
export function friendlyError(code: string | undefined): string {
  const c = code ?? "";
  if (c.includes("out_of_ink")) return "Your paint is drying. It refills by itself in a little while.";
  if (c.includes("canvas_closed")) return "This canvas is closed. Every stroke on it is final.";
  if (c.includes("email_not_verified")) return "Confirm your email first. The link is in your inbox.";
  if (c.includes("not_onboarded")) return "Pick a username first, then you can paint.";
  if (c.includes("not_authenticated")) return "Sign in to paint.";
  if (c.includes("banned")) return "This account can no longer paint here.";
  if (c.includes("slow_down")) return "That was a lot of strokes very fast. Take a breath and keep going.";
  if (c.includes("stroke_too_long")) return "That stroke was too long to save. Try shorter strokes.";
  if (c.includes("not_yours")) return "You can only erase your own work.";
  if (c.includes("Failed to fetch") || c.includes("NetworkError") || c.includes("network"))
    return "You seem to be offline. Your stroke wasn't saved.";
  return "That stroke didn't save. Please try again.";
}
