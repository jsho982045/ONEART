import { pathLength, type InkPoint } from "./codec";
import type { ToolId } from "./tools";

/**
 * The ink well. Mirrors public.draw_stroke() and public._ink_balance(): the database is the authority,
 * this is only for showing the well filling and draining in real time.
 */

export type InkSettings = { capacity: number; refillSeconds: number };
export type InkLevel = { ink: number | null; at: number | null };

export function strokeCost(tool: ToolId, size: number, points: InkPoint[], body?: string): number {
  if (tool === "text") return (body?.length ?? 0) * size * size * 0.5;
  return (pathLength(points) + size) * size;
}

/** Balance at time `now` (ms). null ink means a full well. */
export function inkBalance(level: InkLevel, settings: InkSettings, now: number): number {
  if (level.ink == null || level.at == null) return settings.capacity;
  const elapsed = Math.max(0, (now - level.at) / 1000);
  return Math.min(settings.capacity, level.ink + (elapsed * settings.capacity) / settings.refillSeconds);
}

export function afterStroke(balance: number, cost: number, settings: InkSettings): number {
  return Math.max(balance - cost, -0.5 * settings.capacity);
}

/** Seconds until the well has any ink again (0 if it already does). */
export function secondsUntilPaint(balance: number, settings: InkSettings): number {
  if (balance > 0) return 0;
  return Math.ceil(((-balance + settings.capacity * 0.02) * settings.refillSeconds) / settings.capacity);
}

export function describeWait(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const m = Math.ceil(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}
