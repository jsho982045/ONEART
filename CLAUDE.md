# oneart: rules for Claude

## Hard rules
- Never run `git add`, `git commit`, `git push`, or create PRs or merge. The owner does all of that manually.
- Never run `git init` here.
- This is a **personal** project (Skyline Avenue LLC). Never mix in work (UrbanLogic) accounts, repos or credentials.
- Never put real credentials in files that could be committed. Secrets go in `.env.local` only.
- Never run destructive database commands against prod. Dev project only (`oneart-dev`).

## Product rules that must not change
- Users never control how their mark looks. `place_splat(x, y)` takes position only. The seed is chosen in the database.
- One click per account, enforced in Postgres.
- Changing `src/lib/splat.ts` output requires bumping `ALGO_VERSION`; golden tests will fail otherwise.
- `splat_owners` stays unreadable by the API. Public info goes through the `splat_owner` function only.

## Commands
`npm run dev`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:db`

## Branches
`main` = production, `dev` = integration. Feature branches come from `dev`.
