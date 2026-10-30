/**
 * The address people actually reached us on, for building redirects.
 *
 * Behind Railway's proxy, `request.url` is the container's own address (http://localhost:8080), so redirects built
 * from it send people to localhost. The proxy passes the real host in X-Forwarded-Host / Host instead.
 */
export function publicOrigin(request: Request): string {
  const h = request.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (host && !isInternal(host)) {
    const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim() || new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (site) return site.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

function isInternal(host: string): boolean {
  const name = host.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "0.0.0.0" || name === "127.0.0.1" || name === "::1" || name.endsWith(".railway.internal");
}
