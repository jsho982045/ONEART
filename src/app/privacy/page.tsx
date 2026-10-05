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
        <h1 className="text-3xl font-bold tracking-tight">Privacy policy</h1>
        <p className="mt-2 text-graphite">Last updated: October 2026</p>

        {/* TODO(owner): Plain-language draft, not legal advice. Have a lawyer review it, especially for GDPR/CCPA. */}
        <p role="note" className="mt-6 rounded-[4px] border border-rule p-4 text-[15px] text-graphite">
          Draft for review. This policy has not been reviewed by a lawyer yet.
        </p>

        <div className="prose-legal mt-8">
          <h2>What we collect</h2>
          <ul>
            <li>
              <strong>Email address and password</strong> (or your Google sign-in), so each person gets one click and
              so we can tell you when the finished piece is ready. Passwords are stored hashed by our auth provider.
            </li>
            <li>
              <strong>Username</strong>, shown publicly with your mark.
            </li>
            <li>
              <strong>Where and when you placed your mark.</strong> The position is public, since it is the artwork.
            </li>
            <li>
              <strong>Confirmations</strong> that you&apos;re 18 or older and accepted the terms.
            </li>
          </ul>

          <h2>What other people can see</h2>
          <p>
            Anyone can see every mark on the canvas. Hovering over or tapping a mark shows the username and the date it
            was placed. Your email address is never shown.
          </p>

          <h2>How we use it</h2>
          <ul>
            <li>To check that you only place one mark.</li>
            <li>To email you once when the finished piece is ready, and for account messages such as password resets.</li>
            <li>To prevent abuse of the site.</li>
          </ul>
          <p>We don&apos;t send marketing email and we don&apos;t sell your email address.</p>

          <h2>Who handles your data</h2>
          <p>
            We use Supabase for accounts and the database, Vercel for hosting, and optionally Cloudflare Turnstile to
            block bots. Google handles sign-in if you choose Google. These providers process data on our behalf.
          </p>

          <h2>Keeping and deleting data</h2>
          <p>
            We keep your account until you ask us to delete it. When you do, we remove your email, username and password.
            Your mark stays on the canvas as part of the artwork, but is no longer linked to you.
          </p>

          <h2>Your choices</h2>
          <p>
            You can ask to see, correct or delete your data at any time by emailing{" "}
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
          </p>

          <h2>Who runs this</h2>
          <p>
            {SITE.owner}. Read the <Link href="/terms">terms of use</Link> for ownership of the artwork.
          </p>
        </div>
      </main>
    </>
  );
}
