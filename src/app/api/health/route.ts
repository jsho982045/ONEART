import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Railway health check: the web server is up and answering. */
export function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
