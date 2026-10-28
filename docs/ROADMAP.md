# ONEART roadmap

A shared, real-time freehand canvas for the world. Free to draw for 30 days. When it closes, participants can buy the finished high-resolution piece.

Each slice is **vertical**: it ships something a person can actually use end to end (database, server, UI, tests), not one layer at a time. Finish a slice, try it on `oneart-dev`, then start the next.

Owner tags: **[Jack]** = accounts, dashboards, money, git, decisions. **[Claude]** = code, tests, docs. Everything else is shared.

Hosting: Railway (East region). Database/auth/realtime/storage: Supabase. Payments: Stripe.

## Status (Oct 27, 2026)

All the **[Claude]** work in slices 0 to 13 is built, tested and in the working tree (not committed). Changes from the
original plan: work happens directly on `main` (Railway auto-deploys it), and the database stays on Supabase.

What is left is almost entirely yours, in roughly this order:

1. Review, then commit and push (`main`).
2. Supabase `oneart-dev`: run the migrations, check the two storage buckets, make yourself admin (README, "Set up Supabase").
3. Railway: set the web service health check, add the `worker` service, add variables (README, "Deploy on Railway").
4. Try the full flow on dev with two devices: sign up, paint, watch live, report, hide, undo, `/admin`.
5. Google OAuth client, custom SMTP, Turnstile keys, domain.
6. Stripe test mode end to end (README, "Stripe"), then live keys.
7. Lawyer review of `/terms` and `/privacy`; replace `contactEmail` in `src/lib/site.ts`.
8. Production: same migrations on `oneart-prod`, production variables, set the launch dates in `/admin`.

Not built yet (good next steps after launch): a personalised copy of the finished piece with your own work highlighted,
analytics, Sentry error tracking.

---

## Product rules (source of truth)

- Anyone with a verified account can draw anywhere, in any color.
- Drawing must feel smooth and simple enough for a professional artist, a child and a grandparent.
- You can never draw over or erase someone else's work. Your brush skips their ink. A few pixels of edge tolerance so it never feels strict. You can draw over and erase your own work.
- A generous **ink well** per person refills over time. No cooldowns, no numbers, no error popups.
- Hover or tap any drawing to see who made it (username and date only).
- The canvas is open for a fixed window (default 30 days), then freezes forever.
- After close: everyone can view a watermarked preview. The full-resolution file is paid ($1.99) and never sent to the browser before purchase.

---

## Slice 0: Foundations and environments
Done when: the app boots locally on port 3003 against `oneart-dev`, CI is green, and a Railway dev deploy is live.

- [ ] [Jack] Reset `dev` to match `main` (`git push --force-with-lease origin main:dev`), branch `feature/freehand-canvas` from it
- [ ] [Jack] Create Supabase `oneart-dev` (East US). Put URL + anon key in `.env.local` (never in chat or git)
- [ ] [Jack] Confirm `oneart-prod` exists in East US; leave it untouched until Slice 14
- [ ] [Jack] Railway: two environments. `dev` deploys branch `dev`, `production` deploys `main`. East region. Env vars per environment
- [ ] [Jack] Pick and buy a domain
- [ ] [Claude] Remove the old one-click idea: `splat.ts`, its tests, `/dev/splat-lab`, `place_splat` UI, one-click copy
- [ ] [Claude] Update `README.md` (Railway, not Vercel) and `CLAUDE.md` product rules to the new idea
- [x] [Claude] Health check route `/api/health`; Railway service settings documented in the README (Railway no longer reads config files)
- [ ] [Claude] GitHub Actions: typecheck, lint, unit tests, DB tests on every PR to `dev` and `main`

## Slice 1: Walking skeleton. Draw a line, reload, it's still there
Done when: a signed-in user draws a stroke, refreshes, and sees it.

- [ ] [Claude] Migration 2: replace `splats` / `splat_owners` / `has_clicked` with:
  - `canvases` (id, slug, title, width, height, starts_at, closes_at, status, ink settings) so future canvases are easy
  - `strokes` (id, canvas_id, kind brush|text, encoded points, color, size, opacity, bbox, created_at, hidden)
  - `stroke_owners` (stroke_id, user_id). Not readable by the API, same privacy model as today
- [ ] [Claude] `draw_stroke(canvas, data)` database function: signed in, email verified, onboarded, canvas open, point count / bounds / color / size validated
- [ ] [Claude] Compact point encoding (quantized, delta-encoded) with round-trip tests
- [ ] [Claude] Viewport loading by bounding box, paged
- [ ] [Claude] Minimal pointer-events drawing on the existing pan/zoom canvas, optimistic render, retry on failure
- [ ] [Claude] DB tests: permissions, validation, closed canvas, unverified user

## Slice 2: Real time. Watch other people draw
Done when: two browsers see each other's finished strokes in under a second, and in-progress strokes as live "ghost" lines.

- [ ] [Claude] Realtime subscription to new strokes for the open canvas
- [ ] [Claude] Live in-progress strokes over a Realtime broadcast channel (throttled), shown as they're drawn
- [ ] [Claude] Presence: "N people drawing now"
- [ ] [Claude] Reconnect + backfill strokes missed while offline / tab asleep
- [ ] Two-browser and phone-plus-laptop manual test

## Slice 3: The brush. Smooth enough for Michelangelo
Done when: drawing feels great with a mouse, trackpad, iPhone finger and iPad + Apple Pencil.

- [ ] [Claude] Variable-width stroke outlines (pressure from pen; simulated from speed otherwise), smoothing and streamline, tapered ends
- [ ] [Claude] Use coalesced/predicted pointer events for low latency; render the live stroke on its own layer
- [ ] [Claude] Toolbar (one small bar, same on every device): brush, size, opacity, color, text, undo, redo, move
- [ ] [Claude] Color: curated palettes, full picker, eyedropper from canvas, recent colors
- [ ] [Claude] Text tool: click to type, a few good fonts, size and color, rendered crisply at every zoom
- [ ] [Claude] Undo / redo / erase **own** strokes only (soft delete, enforced in the database)
- [ ] [Claude] Touch: one finger draws, two fingers pan and zoom, palm rejection with a pencil
- [ ] [Claude] Keyboard shortcuts for power users (B, T, E, space-drag, Cmd/Ctrl+Z)
- [ ] [Claude] Golden tests on stroke geometry so rendering never silently changes
- [ ] [Jack] Feel test on your devices; collect "this feels off" notes

## Slice 4: No covering other people's work
Done when: your ink skips others' drawings, you can draw right up to their edge, and the server enforces the same rule.

- [ ] [Claude] Coverage map: a fine grid per canvas recording which user's ink occupies each cell (stored server side, cached client side)
- [ ] [Claude] Client masks the live stroke so ink simply doesn't appear on others' cells. No popups
- [ ] [Claude] Edge tolerance (a few pixels) so touching and outlining feels natural
- [ ] [Claude] `draw_stroke` re-checks coverage and trims or rejects, so the rule can't be bypassed
- [ ] [Claude] Same rule for text
- [ ] [Claude] Tests: overlap, tolerance, own-work overdraw, concurrent strokes on the same spot

## Slice 5: The ink well
Done when: one person or bot can't flood the canvas, and normal users never notice a limit.

- [ ] [Claude] Ink cost = stroke length x size; balance refills continuously, computed in the database
- [ ] [Claude] Settings per canvas so we can tune generosity without a deploy
- [ ] [Claude] UI: quiet fill ring on the brush button; when low, "Refilling, ready in 12 min". Never cuts off a stroke mid-line
- [ ] [Claude] Tests for refill math and limits
- [ ] Tune numbers on dev with real drawing sessions

## Slice 6: Who drew what
Done when: hovering or tapping any drawing shows its artist, and you can find your own work instantly.

- [ ] [Claude] Hit-testing strokes and text; tooltip with username and date
- [ ] [Claude] "My drawings" button: fly to and highlight your work
- [ ] [Claude] Spotlight an artist: dim everyone else (`/canvas?u=username` share link)
- [ ] [Claude] Privacy tests: no user ids or emails ever leave the database

## Slice 7: Scale. Tiles
Done when: a canvas with 100,000+ strokes opens fast fully zoomed out.

- [ ] [Claude] Railway worker (cron) that bakes strokes into image tiles at several zoom levels in Supabase Storage
- [ ] [Claude] Viewer: tiles when zoomed out, vector strokes when zoomed in, plus anything newer than the last bake
- [ ] [Claude] Re-bake affected tiles when moderation hides strokes
- [ ] [Claude] Cache headers so tiles are served from CDN
- [ ] [Claude] Synthetic load script (100k strokes, many simultaneous drawers)
- [ ] [Jack] Supabase plan check (Realtime connection and storage limits); upgrade to Pro before launch if needed

## Slice 8: First impression, accounts and onboarding
Done when: a first-time visitor understands it in five seconds and draws within a minute.

- [ ] [Claude] Landing page: live canvas, countdown, "N artists, M people drawing now", one clear button
- [ ] [Claude] Browse without an account. On first draw attempt, inline sign-up that keeps their stroke waiting
- [ ] [Claude] Refresh existing auth (email + Google, username, terms) with new copy
- [ ] [Claude] Three-hint first-run overlay (draw, move, see who drew it), dismissible forever
- [ ] [Claude] Accessibility: keyboard navigation, contrast, screen-reader labels, reduced motion
- [ ] [Claude] Mobile polish: safe areas, no accidental page zoom or scroll, large touch targets
- [ ] [Jack] Google OAuth client for dev (and later prod)

## Slice 9: The 30-day lifecycle
Done when: a canvas opens, counts down, closes on time and becomes read-only.

- [ ] [Claude] Countdown in the header; "closing soon" state for the final 48 hours
- [ ] [Claude] Close enforced in `draw_stroke` and flipped by a scheduled job
- [ ] [Claude] Closed view: read-only, "the piece is being finished" message
- [ ] [Claude] Admin: create and schedule the next canvas
- [ ] [Claude] Emails: welcome, "3 days left", "the canvas has closed", "your piece is ready"
- [ ] [Jack] Custom SMTP (Resend or Postmark) with SPF/DKIM on the domain

## Slice 10: Moderation and safety
Done when: anything bad can be found, hidden and its author banned within minutes.

- [ ] [Claude] Report button on any drawing (reason picker)
- [ ] [Claude] Admin page (admin role in the database): report queue, hide stroke, hide all of a user's strokes, ban, area review
- [ ] [Claude] Hidden strokes disappear from tiles, realtime and the final render
- [ ] [Claude] Username filter for slurs and impersonation
- [ ] [Claude] Extra rate limits: strokes per minute, new-account warm-up
- [ ] [Jack] Turnstile: create the widget, add keys
- [ ] [Jack] Decide who moderates during launch week and how fast

## Slice 11: The finished artwork
Done when: after close, everyone can admire the piece but nobody can download the full-resolution file for free.

- [ ] [Claude] Final render job: very high resolution PNG plus a print-ready PDF, stored privately
- [ ] [Claude] Personalized version per participant with their own contribution highlighted (generated on demand)
- [ ] [Claude] Public preview: tiled, capped resolution, subtle watermark, right-click and drag-save disabled
- [ ] [Claude] "Your piece is ready" page per participant

## Slice 12: Purchase (Stripe)
Done when: a participant pays $1.99 in live mode and downloads their file; refunds and failures behave.

- [ ] [Jack] Stripe account under Skyline Avenue LLC: business details, bank, payouts
- [ ] [Jack] Decide: Stripe Tax, or a merchant-of-record service (Lemon Squeezy / Paddle). Check the fee share on $1.99
- [ ] [Jack] Decide: participants only, or anyone can buy
- [ ] [Claude] `purchases` table, Checkout session endpoint, webhook with signature verification and idempotency
- [ ] [Claude] Download page with short-lived signed links; re-download anytime from the account
- [ ] [Claude] Receipt email; refund webhook revokes access
- [ ] [Claude] Tests with Stripe test mode and Stripe CLI webhook forwarding
- [ ] [Jack] Live keys and webhook secret in Railway production

## Slice 13: Legal and content
- [ ] [Claude] Rewrite Terms and Privacy for the new idea: contributors license their drawings to Skyline Avenue LLC, content rules, sale of the final piece, refunds, minimum age
- [ ] [Claude] Replace the placeholder contact email
- [ ] [Jack] Lawyer review of Terms and Privacy
- [ ] [Jack] Decide analytics (cookie-free like Plausible avoids a cookie banner)

## Slice 14: Launch
- [ ] [Jack] Apply migrations to `oneart-prod` (after a dry run on dev)
- [ ] [Jack] Production env vars in Railway, domain + SSL, Supabase auth URLs, Google OAuth prod redirect
- [ ] [Claude] Sentry error tracking, uptime check, health dashboard
- [ ] [Jack] Supabase backups (point-in-time recovery on Pro)
- [ ] Full end-to-end run on dev: sign up, verify, draw, watch live, report, hide, close, preview, buy, download
- [ ] Device QA: iPhone Safari, Android Chrome, iPad + Pencil, Mac Safari/Chrome, Windows Chrome/Edge
- [ ] Load test on dev at expected launch traffic x5
- [ ] [Jack] Promote `dev` to `main`
- [ ] [Jack] Launch plan: where you post, who moderates, how you watch errors on day one

---

## Order

Slices 0 to 7 make the core experience. Slices 8 to 10 must be done before launch. Slices 11 and 12 must be done before day 30 of the first canvas (Stripe account setup can start any time). 13 and 14 finish the launch.
