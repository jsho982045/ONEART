import { afterEach, describe, expect, it, vi } from "vitest";
import { publicOrigin } from "./public-origin";

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

describe("publicOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the forwarded host behind Railway's proxy, not the container address", () => {
    const r = req("http://localhost:8080/auth/callback", { "x-forwarded-host": "drawoneart.com", "x-forwarded-proto": "https" });
    expect(publicOrigin(r)).toBe("https://drawoneart.com");
  });

  it("falls back to the Host header", () => {
    expect(publicOrigin(req("https://localhost:8080/x", { host: "oneart-production.up.railway.app" }))).toBe(
      "https://oneart-production.up.railway.app",
    );
  });

  it("never returns an internal address when the site URL is known", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://drawoneart.com/");
    expect(publicOrigin(req("http://localhost:8080/x", { host: "localhost:8080" }))).toBe("https://drawoneart.com");
  });

  it("keeps working on a phone on the local network", () => {
    expect(publicOrigin(req("http://192.168.1.20:3003/x", { host: "192.168.1.20:3003" }))).toBe(
      "http://192.168.1.20:3003",
    );
  });
});
