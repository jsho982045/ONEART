"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GoogleButton } from "@/components/GoogleButton";
import { Turnstile, turnstileEnabled } from "@/components/Turnstile";
import { isDisposableEmail, USERNAME_PATTERN } from "@/lib/disposable";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SITE } from "@/lib/site";

export function SignupForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [age, setAge] = useState(false);
  const [terms, setTerms] = useState(false);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaReset, setCaptchaReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!isSupabaseConfigured) {
    return <p className="text-graphite">Supabase isn&apos;t configured yet. See the README.</p>;
  }

  if (sentTo) {
    return (
      <div role="status">
        <p className="text-[17px] leading-[1.5]">
          Check <strong>{sentTo}</strong> for a link to confirm your address. After that you can start painting.
        </p>
        <p className="mt-3 text-graphite">
          Nothing there after a few minutes? Check spam, or{" "}
          <button type="button" className="text-link" onClick={() => setSentTo(null)}>
            try a different address
          </button>
          .
        </p>
      </div>
    );
  }

  const fail = (message: string) => {
    setError(message);
    setBusy(false);
    if (turnstileEnabled) setCaptchaReset((n) => n + 1);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim();
    const cleanName = username.trim();
    if (!USERNAME_PATTERN.test(cleanName)) {
      return setError("Usernames are 3 to 20 characters: letters, numbers and underscores.");
    }
    if (password.length < 8) return setError("Use a password of at least 8 characters.");
    if (isDisposableEmail(cleanEmail)) {
      return setError("That looks like a throwaway email address. Use one you check regularly.");
    }
    if (!age || !terms) return setError("Please confirm your age and accept the terms to continue.");
    if (turnstileEnabled && !captcha) return setError("Complete the check below first.");

    setBusy(true);
    const supabase = getSupabaseBrowser();

    const { data: free, error: availError } = await supabase.rpc("username_available", { p_username: cleanName });
    if (availError) return fail("Couldn't check that username. Try again.");
    if (!free) return fail("That username is taken. Try another.");

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/canvas`,
        captchaToken: captcha ?? undefined,
        data: { username: cleanName, terms_accepted: true, age_confirmed: true },
      },
    });

    if (signUpError) {
      const m = signUpError.message.toLowerCase();
      if (m.includes("disposable")) return fail("That looks like a throwaway email address. Use another.");
      if (m.includes("password")) return fail("That password isn't strong enough. Try a longer one.");
      if (m.includes("captcha")) return fail("The bot check failed. Try again.");
      if (m.includes("rate")) return fail("Too many attempts. Wait a few minutes and try again.");
      return fail("Couldn't create your account. Check the details and try again.");
    }

    // Email confirmation off (local dev): we already have a session.
    if (data.session) {
      router.push("/canvas");
      router.refresh();
      return;
    }
    setBusy(false);
    setSentTo(cleanEmail);
  };

  return (
    <div>
      <GoogleButton label="Sign up with Google" />
      <p className="field-hint">You&apos;ll choose a username and accept the terms on the next step.</p>

      <div className="my-6 flex items-center gap-3 text-sm text-graphite" aria-hidden="true">
        <span className="h-px flex-1 bg-rule" />
        or use email
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form onSubmit={onSubmit} noValidate className="space-y-5">
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
            Signs everything you paint. Letters, numbers and underscores.
          </p>
        </div>

        <div>
          <label htmlFor="password" className="field-label">
            Password
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
            aria-describedby="password-hint"
          />
          <p id="password-hint" className="field-hint">
            At least 8 characters.
          </p>
        </div>

        <div className="rounded-[4px] border border-rule p-4 text-[15px] leading-[1.55] text-graphite">
          We ask for these three things for two reasons only: so every stroke is signed by a real person, and so we can
          email you when the canvas is about to close and when the finished piece is ready. No marketing.
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
              . What I paint becomes part of one artwork owned by {SITE.owner}, which may be sold.
            </span>
          </label>
        </div>

        <Turnstile onToken={setCaptcha} resetKey={captchaReset} />

        {error && (
          <p role="alert" className="font-medium text-alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="btn btn-primary w-full">
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>

      <p className="mt-6 text-[15px] text-graphite">
        Already have an account?{" "}
        <Link href="/login" className="text-link font-semibold text-ink">
          Log in
        </Link>
      </p>
    </div>
  );
}
