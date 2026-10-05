# oneart

One click each. One canvas. Every registered person places exactly one randomly generated mark (random color, shape, size and rotation) and chooses only where. After that their account is view-only. The finished artwork is owned by Skyline Avenue LLC.

Stack: Next.js 14 (App Router, TypeScript), Tailwind, Supabase (Postgres, Auth, Realtime), Vercel.

## How it works

- The database stores only `x`, `y` and a random `seed` per mark. The seed is picked **server-side** inside the `place_splat` function, so nobody can influence what their mark looks like.
- `src/lib/splat.ts` turns a seed into a shape. Same seed gives the same splat everywhere, forever. The order of `rand()` calls is part of the data format. Change output and you must bump `ALGO_VERSION`.
- One click per account is enforced in Postgres (row lock, unique constraint, verified email required), not in the UI.
- Who made which mark lives in `splat_owners`, which the API cannot read. Hover and tap info comes from the `splat_owner` function, which returns only username and date.
- Canvas rendering is HTML canvas with pan, pinch, wheel zoom and keyboard controls. The live counter and new marks arrive through Supabase Realtime.

## Run it locally

```bash
npm install
cp .env.local.example .env.local   # then fill it in
npm run dev
```

Without Supabase keys the app still runs and shows a setup notice.

## Set up Supabase (do dev first)

Use two separate projects: `oneart-dev` and `oneart-prod`. Never point local development at prod.

1. Create `oneart-dev` at supabase.com.
2. Open **SQL Editor**, paste `supabase/migrations/20261004000000_init.sql`, run it. (Or use the Supabase CLI: `supabase link` then `supabase db push`.)
3. **Project Settings → API**: copy the Project URL and the anon key into `.env.local`. Use only the anon key in this app. Never the service role key.
4. **Authentication → URL Configuration**: Site URL `http://localhost:3000`, add redirect URL `http://localhost:3000/auth/callback`.
5. **Authentication → Providers → Email**: keep "Confirm email" on. `place_splat` requires a verified email.
6. Check that **Database → Replication** includes `splats` and `canvas_meta` (the migration adds them).
7. When dev works, repeat for `oneart-prod` with your real domain, and apply the same migration there.

### Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web application).
2. Authorized redirect URI: `https://<your-project-ref>.supabase.co/auth/v1/callback` (one per Supabase project).
3. Supabase → Authentication → Providers → Google: paste the client ID and secret, enable.
4. First-time Google users land on `/welcome` to choose a username and accept the terms.

### Email and bots

- Supabase's built-in email is rate limited and meant for testing. Before launch, set up custom SMTP (Resend, Postmark, SES) under Authentication → SMTP Settings, with SPF/DKIM on your domain.
- Optional bot check: create a Cloudflare Turnstile widget, put the site key in `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and put the secret key in Supabase → Authentication → Attack Protection → CAPTCHA.

## Deploy on Vercel

1. Import the repo in Vercel.
2. Production Branch: `main`. Preview deployments for `dev` and feature branches.
3. Environment variables:
   - Production: the `oneart-prod` URL and anon key.
   - Preview and Development: the `oneart-dev` URL and anon key.
4. Add your domain, then add it to Supabase redirect URLs (Site URL and `/auth/callback`).

## Git workflow

`main` is production. `dev` is integration. Cut feature branches from `dev`, merge them into `dev`, and promote `dev` to `main` when ready.

## Tests

```bash
npm run test       # splat generator, including golden values
npm run test:db    # database rules, in an in-memory Postgres (PGlite)
npm run typecheck
npm run lint
```

`test:db` loads the real migration into PGlite (Postgres compiled to WebAssembly) with a stubbed `auth` schema. It checks the one-click rule, bounds, privacy and grants. It is not a replacement for trying the flow against `oneart-dev`. The "parallel attempts" test is serialized by PGlite, so it does not prove behavior under real concurrency. The row lock in `place_splat` is what protects against that in Supabase.

`/dev/splat-lab` shows a gallery of generated marks. It returns 404 in production.

## Before you launch (TODO)

- [ ] Replace `contactEmail` in `src/lib/site.ts`.
- [ ] Have a lawyer review `/terms` and `/privacy`. They are plain-language drafts.
- [ ] Set up custom SMTP and email templates.
- [ ] Enable Turnstile.
- [ ] Add your domain to Supabase redirect URLs and Google OAuth.
- [ ] Try the full flow on dev: sign up, confirm, place, hover, share link, Google, password reset.
- [ ] Decide how and when "the finished piece is ready" emails go out. This app collects the addresses but does not send them.

## Known limits

- **No tiling.** The viewer loads marks for the visible area, up to `MAX_LOAD` (10,000). A fully zoomed-out view of a very large canvas shows only part of it. Add pre-rendered tiles before you expect tens of thousands of marks.
- **Deleting an account** keeps the mark but anonymizes it. Someone who deletes their account and registers again with the same email could get another click. If that matters, store a hash of deleted emails and block them in `handle_new_user`.
- **Throwaway emails:** the blocklist in `src/lib/disposable.ts` is short and static. It slows casual abuse and nothing more. Real defense is email verification plus Turnstile.
- Owned by Skyline Avenue LLC. Contributors are not paid. This is stated at signup, in the terms and in the privacy policy.
