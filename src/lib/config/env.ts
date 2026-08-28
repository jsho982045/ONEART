/**
 * Typed, centralised access to environment variables.
 *
 * Application code must import from here rather than reading `process.env`
 * directly. This keeps environment selection (oneart-dev vs oneart-prod) a
 * pure matter of which `.env` file / Vercel scope is loaded — never something
 * branched on inside the codebase.
 *
 * - `NEXT_PUBLIC_*` values are inlined at build time and safe for the browser.
 * - Server-only values are read lazily and must never be imported into a
 *   Client Component.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.local.example to .env.local and fill it in (see the file for guidance).`,
    );
  }
  return value;
}

/** Values safe to use in both server and client bundles. */
export const publicEnv = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
  siteUrl: required(
    "NEXT_PUBLIC_SITE_URL",
    process.env.NEXT_PUBLIC_SITE_URL,
  ).replace(/\/$/, ""),
} as const;

/**
 * Server-only secrets. Calling this from a Client Component will throw at
 * build/runtime because the variables are undefined in the browser bundle.
 */
export function getServerEnv() {
  return {
    supabaseServiceRoleKey: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  } as const;
}
