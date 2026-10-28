# oneart: rules for Claude

## Hard rules
- Never run `git add`, `git commit`, `git push`, `git stash`, or create PRs or merge. The owner does all of that manually.
- Never run `git init` here.
- Before touching git or GitHub, confirm the active account is **jsho982045** (`gh auth status`) and the repo email is personal. If `jshomer@urbanlogic.io` or `Jshomer-urbanlogic` shows up anywhere, stop and tell the owner.
- This is a **personal** project (Skyline Avenue LLC). Never mix in work (UrbanLogic) accounts, repos or credentials.
- Never put real credentials in files that could be committed. Secrets go in `.env.local` (local) or Railway variables.
- `SUPABASE_SERVICE_ROLE_KEY` and Stripe secrets are server-only. Never import `src/lib/server/*` from a client component.
- Never run destructive database commands against prod. Dev project only (`oneart-dev`).

## Product rules that must not change
- Anyone verified can paint anywhere, any colour. Free to paint.
- **Nobody can paint over or erase someone else's work.** The renderer replays strokes in id order and clips each one against
  earlier strokes by other artists (`src/lib/paint/ownership.ts`). Erasing is own-strokes-only, enforced in `set_stroke_erased`.
- Every write goes through a SECURITY DEFINER function. The browser can't write tables directly.
- The database decodes stroke geometry itself (bounds, ink cost). `src/lib/paint/codec.ts` and `draw_stroke()` must agree;
  `parity.test.ts` proves it.
- Stroke rendering is deterministic (seeded). Changing how a brush paints changes every existing painting: do it on purpose.
- The full-resolution finished piece never reaches a browser unless that person bought it (signed links, private bucket).

## Commands
`npm run dev` (port 3003), `npm run dev:local` (no database needed), `npm run check` (typecheck + lint + unit + db tests),
`npm run build`, `npm run worker -- --once`.

## Branches
Work happens on `main`; Railway auto-deploys pushes to `main`. The owner reviews and commits everything.
