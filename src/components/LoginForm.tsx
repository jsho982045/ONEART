"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GoogleButton } from "@/components/GoogleButton";
import { safeNext } from "@/lib/safe-next";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const linkProblem = params.get("error") === "link";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    linkProblem ? "That link has expired or was already used. Log in, or request a new one." : null,
  );

  if (!isSupabaseConfigured) {
    return <p className="text-graphite">Supabase isn&apos;t configured yet. See the README.</p>;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: signInError } = await getSupabaseBrowser().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      setBusy(false);
      const m = signInError.message.toLowerCase();
      setError(
        m.includes("not confirmed")
          ? "Confirm your email first. Check your inbox for the link we sent."
          : "That email and password don't match.",
      );
      return;
    }
    router.push(next);
    router.refresh();
  };

  return (
    <div>
      <GoogleButton next={next} label="Log in with Google" />

      <div className="my-6 flex items-center gap-3 text-sm text-graphite" aria-hidden="true">
        <span className="h-px flex-1 bg-rule" />
        or use email
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form onSubmit={onSubmit} className="space-y-5">
        <div>
          <label htmlFor="email" className="field-label">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
          />
        </div>
        <div>
          <label htmlFor="password" className="field-label">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field-input"
          />
          <p className="field-hint">
            <Link href="/forgot-password" className="text-link">
              Forgot your password?
            </Link>
          </p>
        </div>

        {error && (
          <p role="alert" className="font-medium text-alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn btn-primary w-full">
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>

      <p className="mt-6 text-[15px] text-graphite">
        New here?{" "}
        <Link href="/signup" className="text-link font-semibold text-ink">
          Make an account
        </Link>
      </p>
    </div>
  );
}
