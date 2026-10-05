"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { USERNAME_PATTERN } from "@/lib/disposable";
import { SITE } from "@/lib/site";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/** Finishing signup for people who came in with Google: pick a username, confirm age and terms. */
export function WelcomeForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const clean = username.trim();
    if (!USERNAME_PATTERN.test(clean)) {
      return setError("Usernames are 3 to 20 characters: letters, numbers and underscores.");
    }
    if (!age || !terms) return setError("Please confirm your age and accept the terms to continue.");

    setBusy(true);
    const { error: rpcError } = await getSupabaseBrowser().rpc("complete_onboarding", {
      p_username: clean,
      p_accept_terms: terms,
      p_confirm_age: age,
    });
    if (rpcError) {
      setBusy(false);
      const m = rpcError.message;
      if (m.includes("username_taken")) return setError("That username is taken. Try another.");
      if (m.includes("already_onboarded")) {
        router.replace(next);
        return;
      }
      return setError("Couldn't save that. Try again.");
    }
    router.replace(next);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div>
        <label htmlFor="username" className="field-label">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={20}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="field-input"
          aria-describedby="username-hint"
        />
        <p id="username-hint" className="field-hint">
          Shown when someone hovers over your mark. Letters, numbers and underscores.
        </p>
      </div>

      <div className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-snug">
          <input
            type="checkbox"
            checked={age}
            onChange={(e) => setAge(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ink)]"
          />
          <span>I&apos;m 18 or older.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 text-[15px] leading-snug">
          <input
            type="checkbox"
            checked={terms}
            onChange={(e) => setTerms(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--ink)]"
          />
          <span>
            I accept the{" "}
            <Link href="/terms" target="_blank" className="text-link">
              terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" className="text-link">
              privacy policy
            </Link>
            . My mark becomes part of one artwork owned by {SITE.owner}, which may be sold. I won&apos;t be paid or
            share in the proceeds.
          </span>
        </label>
      </div>

      {error && (
        <p role="alert" className="font-medium text-alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
