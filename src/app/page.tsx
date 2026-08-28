import { createClient } from "@/lib/supabase/server";

// Reads live project state from oneart-dev on every request. Also serves as the
// end-to-end smoke test for the Supabase server client + env wiring until the
// real landing page is built.
export default async function Home() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("canvas_meta")
    .select("total_clicks, status")
    .single();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-mono text-2xl font-semibold tracking-tight">ONEART</h1>
      <p className="max-w-md text-sm text-foreground/70">
        A global collaborative artwork. Every person gets exactly one click — you
        choose only where it lands.
      </p>
      {error ? (
        <p className="font-mono text-xs text-red-500">
          canvas_meta read failed: {error.message}
        </p>
      ) : (
        <p className="font-mono text-xs text-foreground/50">
          {data.total_clicks.toLocaleString()} splats placed · canvas {data.status}
        </p>
      )}
    </main>
  );
}
