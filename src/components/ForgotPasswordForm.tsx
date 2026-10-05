"use client";

import Link from "next/link";
import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return <p className="text-graphite">Supabase isn&apos;t configured yet. See the README.</p>;
  }

  if (sent) {
    return (
      <p role="status" className="text-[17px] leading-[1.5]">
        If an account exists for <strong>{email.trim()}</strong>, a reset link is on its way.
      </p>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error: resetError } = await getSupabaseBrowser().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });
    setBusy(false);
    // Same message whether or not the address exists, so this can't be used to check who has an account.
    if (resetError && resetError.message.toLowerCase().includes("rate")) {
      setError("Too many requests. Wait a few minutes and try again.");
      return;
    }
    setSent(true);
  };

  return (
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
      {error && (
        <p role="alert" className="font-medium text-alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <p className="text-[15px] text-graphite">
        <Link href="/login" className="text-link">
          Back to log in
        </Link>
      </p>
    </form>
  );
}
