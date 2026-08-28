# ONEART

A global collaborative artwork. Every registered person gets **exactly one click**,
ever, on a large shared digital canvas. The click drops a procedurally generated
"splat" — a randomized organic blob whose colour, shape, size, and rotation are
pure chance. The user controls only *where* it lands. After placing, the account
becomes permanently view-only.

## Stack

- **Next.js 15** (App Router) + TypeScript
- **Tailwind CSS v4**
- **Supabase** — Postgres, Auth, Realtime
- **Vercel** hosting
- Canvas rendered with the HTML5 Canvas API; pointer-event pan/zoom (no tiling in v1)

## Environments

Two fully separate Supabase projects:

| Purpose | Supabase project | Used by |
| --- | --- | --- |
| Development | `oneart-dev` | local dev, Vercel Preview deployments |
| Production | `oneart-prod` | Vercel Production (deploys from `main`) |

Environment selection is purely a matter of which `.env` file / Vercel scope is
loaded. No project reference is hardcoded in application code — everything reads
through `src/lib/config/env.ts`.

## Local setup

```bash
nvm use                     # Node 22 (see .nvmrc)
npm install
cp .env.local.example .env.local
# fill .env.local with the oneart-dev project's URL + keys
npm run dev
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (run once) |
| `npm run test:watch` | Vitest (watch) |

## Branching

- `main` — production, stable
- `dev` — integration
- `feature/*` — short-lived, cut from `dev`

_Detailed environment/deploy/migration runbook is added in a later phase._
