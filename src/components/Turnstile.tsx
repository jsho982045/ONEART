"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export const turnstileEnabled = Boolean(SITE_KEY);

/**
 * Cloudflare Turnstile widget. Renders nothing unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set.
 * The token is passed to supabase.auth.signUp({ options: { captchaToken } }); Supabase verifies it
 * when Captcha protection is enabled in the dashboard.
 */
export function Turnstile({ onToken, resetKey }: { onToken: (token: string | null) => void; resetKey?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY || !hostRef.current) return;
    let cancelled = false;

    const mount = () => {
      if (cancelled || !window.turnstile || !hostRef.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(hostRef.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onTokenRef.current(token),
        "expired-callback": () => onTokenRef.current(null),
        "error-callback": () => onTokenRef.current(null),
      });
    };

    if (window.turnstile) {
      mount();
    } else {
      let script = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      if (!script) {
        script = document.createElement("script");
        script.src = SCRIPT_SRC;
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("load", mount);
    }

    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (resetKey && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onTokenRef.current(null);
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div ref={hostRef} className="min-h-[65px]" />;
}
