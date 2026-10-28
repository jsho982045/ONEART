# oneart

One canvas for the whole world. Anyone can paint, draw or write anything, live, alongside everyone else, with pencil,
dip-pen ink, charcoal, watercolor, an oil bristle brush and hand lettering on a woven cotton canvas. Each canvas is open for
a fixed time (30 days by default), then it's finished forever. Everyone who painted on it can buy the full-resolution piece.

The artwork and project belong to Skyline Avenue LLC.

Stack: Next.js 14 (App Router, TypeScript), Tailwind, Supabase (Postgres, Auth, Realtime, Storage), Stripe, Railway.

## Try it in two minutes (no accounts, no database)

```bash
npm install
npm run dev:local        # http://localhost:3003
```

Local test mode keeps everything in your browser. Open the canvas in two tabs (or two windows side by side): each tab is a
different artist, and you'll see each other paint live. Wipe it from the account menu ("Wipe local test canvas").

## How it works

| Piece | Where |
|---|---|
| Brushes, canvas texture, sound | `src/lib/paint/brushes.ts`, `geometry.ts`, `textures.ts`, `sound.ts` |
| Rendering (zoom levels, chunks, the no-overpainting rule) | `src/lib/paint/renderer.ts`, `ownership.ts` |
| The studio (input, camera, realtime, undo) | `src/lib/studio/engine.ts`, `src/components/studio/*` |
| Data access (Supabase or local test mode) | `src/lib/backend/*` |
| Database rules | `supabase/migrations/*.sql` |
| Background worker (overview tiles, finished piece, emails) | `scripts/worker.ts` |
| Buying the finished piece | `src/app/api/checkout`, `src/app/api/stripe/webhook`, `src/app/api/download`, `src/app/piece` |
| Moderation and scheduling canvases | `/admin` (`src/components/AdminConsole.tsx`) |

- **Painting.** Strokes are stored as compact points (`src/lib/paint/codec.ts`). The database decodes them itself to work out
  bounds and ink cost, so a modified browser can't lie about either.
- **No painting over other people.** Every screen (and the final render) paints strokes in order and clips each stroke against
  earlier strokes by other artists, with a few pixels of edge tolerance. You can always paint over your own work.
- **The paint well.** Everyone has a generous well that refills continuously (per-canvas settings). A stroke is never cut off
  mid-line; the well may dip below empty and simply takes longer to refill. 90 strokes a minute is the hard rate limit.
- **Who painted what.** Tap the loupe, then any painting. Usernames and dates only; emails never leave the database.
- **Far zoom.** The worker bakes overview tiles to Supabase Storage every few minutes, so seeing the whole canvas never means
  downloading every stroke. Strokes newer than the last bake are painted on top live.
- **The finished piece.** Ten minutes after a canvas closes, the worker renders it at one pixel per canvas unit (12000 × 8000 by
  default) into a private bucket, plus a watermarked, reduced public preview. The real file is only ever handed out as a
  one-minute signed link, after the server has checked the purchase.

## Set up Supabase (dev first)

Use two projects: `oneart-dev` and `oneart-prod` (East US). Never point local development at prod.

1. Create `oneart-dev`. In **SQL Editor** run every file in `supabase/migrations/` **in order** (or `supabase link` +
   `supabase db push`). The first file is the original schema; the later ones replace the one-click model.
2. **Project Settings → API**: put the URL and anon key in `.env.local`. The service role key goes only where the README says.
3. **Authentication → URL Configuration**: Site URL `http://localhost:3003`, redirect URL `http://localhost:3003/auth/callback`.
4. **Authentication → Providers → Email**: keep "Confirm email" on.
5. **Database → Replication**: check `strokes` is in the `supabase_realtime` publication (the migration adds it).
6. **Storage**: the migrations create two buckets: `tiles` (public) and `finals` (private). Check they exist; if your project
   didn't allow it, create them by hand with those names and visibility. Raise the per-file limit on `finals` to 100 MB.
7. Make yourself a moderator: `update public.profiles set is_admin = true where lower(username) = lower('your_name');`
8. Set the real dates of the first canvas in `/admin` (or `update public.canvases set opens_at = ..., closes_at = ...`).

Google sign-in: Google Cloud Console → OAuth client (Web) → redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`
→ paste into Supabase → Authentication → Providers → Google. First-time Google users pick a username on `/welcome`.

Before launch: custom SMTP (Resend/Postmark) under Authentication → SMTP Settings, and Turnstile (see `.env.local.example`).

## Deploy on Railway

Railway project **OneArt**, environment `production`, region US East (Virginia). Railway no longer reads config files
(Config-as-code is deprecated), so these are set in each service's **Settings** tab:

| | **web** (existing `ONEART` service) | **worker** (second service, same repo) |
|---|---|---|
| Source | `jsho982045/ONEART`, branch `main`, auto-deploy on | same |
| Build | Railpack default (`npm run build`) | Railpack default |
| Start command | default (`npm run start`, listens on `$PORT`) | `npm run worker` |
| Healthcheck path | `/api/health` | none |
| Public networking | `drawoneart.com` | none |
| Restart policy | On failure | Always |
| Memory | default | at least 2 GB (renders the finished piece) |

Variables:

| Variable | web | worker |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | ✓ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | |
| `NEXT_PUBLIC_SITE_URL` (`https://drawoneart.com`) | ✓ | ✓ |
| `SUPABASE_SERVICE_ROLE_KEY` | ✓ (Stripe webhook, downloads) | ✓ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | optional | |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | when selling | |
| `RESEND_API_KEY`, `EMAIL_FROM` | | optional |

`NEXT_PUBLIC_*` values are baked in at build time, so redeploy after changing them.

## Stripe

1. Stripe account under Skyline Avenue LLC (test mode first).
2. Put the secret key in `STRIPE_SECRET_KEY`.
3. Locally: `stripe listen --forward-to localhost:3003/api/stripe/webhook` and copy the `whsec_...` into
   `STRIPE_WEBHOOK_SECRET`. In production: Dashboard → Webhooks → endpoint `https://<domain>/api/stripe/webhook` with events
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`.
4. Price per canvas is `canvases.price_cents` (default 199) and `currency` (default usd). Only people who painted on a canvas
   can buy it (`has_painted`).

## Tests

```bash
npm run check      # typecheck, lint, unit tests, database tests
npm run build
```

- `npm run test` covers the codec, geometry (golden determinism), ownership rule, ink well, camera, stroke store, local mode,
  and **TypeScript ↔ SQL parity** (the browser's predicted bounds and ink cost against the real migration).
- `npm run test:db` loads every migration into PGlite (Postgres in WebAssembly) with a stub of Supabase's auth and tries to
  break the rules: who can paint, validation, the canvas window, ink, rate limits, erasing, reports, moderation, bans,
  purchases, admin tools, usernames. It is not a replacement for trying the flow on `oneart-dev`.
- CI (`.github/workflows/ci.yml`) runs all of it on every pull request and push to `main`.

## Known limits

- Supabase Realtime broadcast carries live "ghost" strokes; under heavy load some ghost updates can drop. Finished strokes always
  arrive through the database.
- Overview tiles lag up to one worker interval (5 min) behind erasures and moderation at far zoom. Zoomed in, changes are live.
- Deleting an account keeps the paintings but anonymises them.
