import "server-only";
import Stripe from "stripe";

let stripe: Stripe | null = null;

export const stripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  stripe ??= new Stripe(key, { typescript: true });
  return stripe;
}
