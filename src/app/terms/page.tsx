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
        <h1 className="text-3xl font-bold tracking-tight">Terms of use</h1>
        <p className="mt-2 text-graphite">Last updated: October 2026</p>

        {/* TODO(owner): This is a plain-language draft, not legal advice. Have a lawyer review it before launch. */}
        <p role="note" className="mt-6 rounded-[4px] border border-rule p-4 text-[15px] text-graphite">
          Draft for review. These terms have not been reviewed by a lawyer yet.
        </p>

        <div className="prose-legal mt-8">
          <h2>What this is</h2>
          <p>
            {SITE.name} is a single collaborative artwork. Each person who registers gets one click. The click places one
            mark on the canvas. You choose where. The color, shape, size and rotation are generated automatically and you
            can&apos;t change them. After you place your mark, your account can look at the canvas but can&apos;t add to it.
          </p>

          <h2>Who owns the artwork</h2>
          <p>
            The finished canvas, and every mark on it, belongs to {SITE.owner} (&ldquo;we&rdquo;). By placing a mark you
            agree that we own the artwork as a whole and that we may display, reproduce, license and sell it, or any part
            of it, in any form. You won&apos;t be paid and you won&apos;t share in any proceeds. Your mark is generated
            by the site, and you keep no rights in it.
          </p>

          <h2>Your account</h2>
          <ul>
            <li>You must be 18 or older.</li>
            <li>One person, one account, one click. Creating extra accounts to place more marks isn&apos;t allowed, and we may remove them.</li>
            <li>Give a real email address you check. Throwaway addresses are blocked.</li>
            <li>Keep your password private. You&apos;re responsible for what happens under your account.</li>
          </ul>

          <h2>Usernames</h2>
          <p>
            Your username is shown to anyone who hovers over or taps your mark, along with the date you placed it. Don&apos;t
            use a name that is hateful, harassing, or someone else&apos;s. We may change or remove usernames that break
            this rule.
          </p>

          <h2>Fair use of the site</h2>
          <p>
            Don&apos;t try to break, overload, or get around the site, including its one-click limit. We may suspend
            accounts that do.
          </p>

          <h2>Deleting your account</h2>
          <p>
            You can ask us to delete your account. Your mark stays on the canvas, but it is no longer linked to your
            username or email.
          </p>

          <h2>Changes and availability</h2>
          <p>
            We may change these terms or the site, and we may close the canvas when it&apos;s finished. The site is
            provided as is, with no promises that it will always be available.
          </p>

          <h2>Contact</h2>
          <p>
            Questions: <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. See also the{" "}
            <Link href="/privacy">privacy policy</Link>.
          </p>
        </div>
      </main>
    </>
  );
}
