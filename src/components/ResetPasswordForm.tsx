"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return <p className="text-graphite">Supabase isn&apos;t configured yet. See the README.</p>;
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    setBusy(true);
    const { error: updateError } = await getSupabaseBrowser().auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError("Couldn't update your password. The link may have expired. Request a new one.");
      return;
    }
    router.push("/canvas");
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="password" className="field-label">
          New password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="field-input"
        />
        <p className="field-hint">At least 8 characters.</p>
      </div>
      {error && (
        <p role="alert" className="font-medium text-alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={busy} className="btn btn-primary w-full">
        {busy ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
