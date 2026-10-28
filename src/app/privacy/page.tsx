import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[68ch] px-4 pb-24 pt-10">
        <h1 className="text-3xl font-display font-normal tracking-[-0.005em]">Privacy policy</h1>
        <p className="mt-2 text-graphite">Last updated: October 2026</p>

        {/* TODO(owner): This is a plain-language draft, not legal advice. Have a lawyer review it before launch. */}
        <p role="note" className="mt-6 rounded-[4px] border border-rule p-4 text-[15px] text-graphite">
          Draft for review. This policy has not been reviewed by a lawyer yet.
        </p>

        <div className="prose-legal mt-8">
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Email address and password</strong> (or your Google sign-in), so every painting is signed by a real
              person, and so we can tell you when the canvas is closing and when the finished piece is ready.
            </li>
            <li>
              <strong>Username</strong>, shown publicly with your work.
            </li>
            <li>
              <strong>What you paint</strong>: every stroke, its colour, tool and where and when you painted it. This is public,
              because it is the artwork.
            </li>
            <li>
              <strong>Basic technical data</strong> our hosting providers keep automatically (such as IP addresses in server
              logs) to keep the site secure.
            </li>
          </ul>

          <h2>Who can see what</h2>
          <p>
            Anyone can see the whole canvas. Tapping or hovering over a painting shows the username and the date. Your email
            address is never shown to anyone.
          </p>

          <h2>How we use it</h2>
          <ul>
            <li>To run the canvas and sign your work.</li>
            <li>To stop abuse: rate limits, bot checks and moderation.</li>
            <li>To email you about the canvas you painted on (it&apos;s closing soon, it&apos;s finished).</li>
          </ul>
          <p>We don&apos;t send marketing email and we don&apos;t sell your data.</p>

          <h2>Who processes it</h2>
          <p>
            Supabase (database and sign-in), Railway (hosting), our email provider, and Cloudflare Turnstile (bot checks). If
            you buy the finished piece, Stripe processes the payment; we never see your card details.
          </p>

          <h2>Deleting your data</h2>
          <p>
            Email <a className="text-link" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> to delete your account.
            Your paintings stay on the canvas as part of the artwork, but are no longer linked to you.
          </p>

          <p className="mt-10">
            See also the{" "}
            <Link className="text-link" href="/terms">
              terms of use
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  );
}
