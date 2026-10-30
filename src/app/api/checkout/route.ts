import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/public-origin";
import { getStripe, stripeConfigured } from "@/lib/server/stripe";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Starts a Stripe Checkout for a copy of a finished canvas. Called by a plain form POST, so it works
 * without JavaScript. Who is buying comes from the session cookie, never from the form.
 */
export async function POST(req: NextRequest) {
  const origin = publicOrigin(req);
  const form = await req.formData();
  const slug = String(form.get("canvas") ?? "");
  const back = (q: string) => NextResponse.redirect(`${origin}/piece?c=${encodeURIComponent(slug)}&${q}`, 303);

  if (!stripeConfigured()) return back("error=unavailable");
  const supabase = createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(`/piece?c=${slug}`)}`, 303);

  const { data: canvas } = await supabase
    .from("canvases")
    .select("id,slug,title,final_ready_at,price_cents,currency")
    .eq("slug", slug)
    .single();
  if (!canvas?.final_ready_at) return back("error=notready");

  const [{ data: painted }, { data: owned }] = await Promise.all([
    supabase.rpc("has_painted", { p_canvas: canvas.id }),
    supabase.rpc("owns_copy", { p_canvas: canvas.id }),
  ]);
  if (owned) return back("bought=1");
  if (!painted) return back("error=participants");

  const session = await getStripe().checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: canvas.currency,
          unit_amount: canvas.price_cents,
          product_data: {
            name: `${canvas.title}: the finished piece`,
            description: "Full-resolution digital copy of the finished oneart canvas, including your work.",
          },
        },
      },
    ],
    customer_email: auth.user.email ?? undefined,
    client_reference_id: auth.user.id,
    metadata: { user_id: auth.user.id, canvas_id: canvas.id },
    payment_intent_data: { metadata: { user_id: auth.user.id, canvas_id: canvas.id } },
    success_url: `${origin}/piece?c=${encodeURIComponent(slug)}&bought=1`,
    cancel_url: `${origin}/piece?c=${encodeURIComponent(slug)}`,
  });
  if (!session.url) return back("error=checkout");
  return NextResponse.redirect(session.url, 303);
}
