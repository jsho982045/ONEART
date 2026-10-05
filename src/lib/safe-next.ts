/**
 * Only allow same-site relative redirects (prevents open redirects via ?next=).
 */
export function safeNext(value: string | null | undefined, fallback = "/canvas"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
