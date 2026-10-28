import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[68ch] px-4 pb-24 pt-10">
        <h1 className="text-3xl font-display font-normal tracking-[-0.005em]">Terms of use</h1>
        <p className="mt-2 text-graphite">Last updated: October 2026</p>

        {/* TODO(owner): This is a plain-language draft, not legal advice. Have a lawyer review it before launch. */}
        <p role="note" className="mt-6 rounded-[4px] border border-rule p-4 text-[15px] text-graphite">
          Draft for review. These terms have not been reviewed by a lawyer yet.
        </p>

        <div className="prose-legal mt-8">
          <h2>What this is</h2>
          <p>
            {SITE.name} is one shared canvas that anyone with an account can paint, draw or write on, live, alongside everyone
            else. Each canvas is open for a fixed time (usually 30 days). When the time is up it closes for good and becomes a
            single finished artwork.
          </p>

          <h2>Who owns the artwork</h2>
          <p>
            The finished canvas, and everything painted on it, belongs to {SITE.owner} (&ldquo;we&rdquo;). By painting on it,
            you give us an irrevocable, worldwide, royalty-free right to display, reproduce, print, sell and adapt what you
            painted as part of the artwork, in any form. You won&apos;t be paid and you won&apos;t share in any proceeds. If
            we sell copies of the finished piece, participants may be offered a copy for a small fee.
          </p>

          <h2>Painting fairly</h2>
          <ul>
            <li>You can only paint next to other people&apos;s work, never over it, and only erase your own.</li>
            <li>
              Everyone has a paint well that refills by itself. It exists so no single person can cover the canvas. Using
              several accounts, scripts or bots to get around it isn&apos;t allowed.
            </li>
            <li>One person, one account.</li>
          </ul>

          <h2>What you can&apos;t paint</h2>
          <ul>
            <li>Hate, harassment or threats against anyone, or symbols of hate.</li>
            <li>Sexual content, or anything that sexualises minors.</li>
            <li>Someone else&apos;s personal information (addresses, phone numbers and so on).</li>
            <li>Ads, spam, links or anything illegal.</li>
            <li>Other people&apos;s copyrighted work, logos or characters.</li>
          </ul>
          <p>
            Anyone can report a painting. We may hide anything that breaks these rules, and suspend accounts that do, without
            notice. Hidden work is left out of the finished piece.
          </p>

          <h2>Your name</h2>
          <p>
            Your username is shown to anyone who taps or hovers over your work, with the date you painted it. Don&apos;t pick a
            username that impersonates someone or breaks the rules above.
          </p>

          <h2>Age</h2>
          <p>You need to be 18 or older to make an account.</p>

          <h2>Deleting your account</h2>
          <p>
            You can ask us to delete your account. What you painted stays on the canvas as part of the artwork, but it is no
            longer linked to your name.
          </p>

          <h2>No guarantees</h2>
          <p>
            {SITE.name} is provided as is. We try hard to keep it running and to keep every stroke safe, but we can&apos;t
            promise it will always be available or error-free.
          </p>

          <h2>Contact</h2>
          <p>
            Questions: <a className="text-link" href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. See also the{" "}
            <Link className="text-link" href="/privacy">
              privacy policy
            </Link>
            .
          </p>
        </div>
      </main>
    </>
  );
}
