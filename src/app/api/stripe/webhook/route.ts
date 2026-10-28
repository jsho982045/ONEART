import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { serviceClient } from "@/lib/server/service";
import { getStripe } from "@/lib/server/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe tells us about payments here. Signatures are verified, and every write is idempotent (Stripe
 * retries), so a purchase is recorded exactly once.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return NextResponse.json({ error: "not configured" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const db = serviceClient();

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const s = event.data.object as Stripe.Checkout.Session;
    if (s.payment_status !== "paid") return NextResponse.json({ ok: true, pending: true });
    const userId = s.metadata?.user_id;
    const canvasId = s.metadata?.canvas_id;
    if (!userId || !canvasId) return NextResponse.json({ error: "missing metadata" }, { status: 400 });
    const { error } = await db.from("purchases").upsert(
      {
        user_id: userId,
        canvas_id: canvasId,
        stripe_session_id: s.id,
        stripe_payment_intent: typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
        amount_cents: s.amount_total ?? 0,
        currency: s.currency ?? "usd",
      },
      { onConflict: "stripe_session_id", ignoreDuplicates: true },
    );
    if (error) return NextResponse.json({ error: "db" }, { status: 500 }); // Stripe will retry
  }

  if (event.type === "charge.refunded") {
    const charge = event.data.object as Stripe.Charge;
    const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    if (pi && charge.refunded) {
      const { error } = await db
        .from("purchases")
        .update({ refunded_at: new Date().toISOString() })
        .eq("stripe_payment_intent", pi)
        .is("refunded_at", null);
      if (error) return NextResponse.json({ error: "db" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
