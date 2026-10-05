// Runs the real migration against an in-memory Postgres (PGlite) with a stub of Supabase's `auth` schema,
// then tries to break the one-click rule. No Supabase project or network needed.
//
//   npm run test:db

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");

const db = new PGlite();

// --- Minimal stand-in for what Supabase provides -------------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`);

for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
}

// --- Helpers -------------------------------------------------------------------------------------
let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

async function asRole(role, uid, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

async function expectError(promise, fragment) {
  try {
    await promise;
  } catch (err) {
    assert.ok(
      String(err.message).includes(fragment),
      `expected error containing "${fragment}", got "${err.message}"`,
    );
    return;
  }
  assert.fail(`expected an error containing "${fragment}" but the call succeeded`);
}

async function createUser({ email, verified = true, meta = {} }) {
  const { rows } = await db.query(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     values ($1, ${verified ? "now()" : "null"}, $2::jsonb) returning id`,
    [email, JSON.stringify(meta)],
  );
  return rows[0].id;
}

const fullMeta = (username) => ({ username, terms_accepted: "true", age_confirmed: "true" });
const place = (x, y) => db.query("select * from public.place_splat($1, $2)", [x, y]);

console.log("database tests");

// --- Signup --------------------------------------------------------------------------------------
await test("rejects disposable email domains", async () => {
  await expectError(createUser({ email: "x@mailinator.com", meta: fullMeta("burner1") }), "disposable_email_not_allowed");
});

let alice, bob, carol;

await test("email signup with consent is onboarded straight away", async () => {
  alice = await createUser({ email: "alice@example.com", meta: fullMeta("Alice_1") });
  const { rows } = await db.query("select * from public.profiles where id = $1", [alice]);
  assert.equal(rows[0].onboarded, true);
  assert.equal(rows[0].username, "Alice_1");
  assert.ok(rows[0].accepted_terms_at && rows[0].age_confirmed_at);
});

await test("signup without consent metadata (e.g. Google) is NOT onboarded and gets a placeholder name", async () => {
  bob = await createUser({ email: "bob@example.com" });
  const { rows } = await db.query("select * from public.profiles where id = $1", [bob]);
  assert.equal(rows[0].onboarded, false);
  assert.match(rows[0].username, /^artist_[0-9a-f]{8}$/);
});

await test("a taken username (any case) falls back to a placeholder instead of failing signup", async () => {
  const dup = await createUser({ email: "dup@example.com", meta: fullMeta("alice_1") });
  const { rows } = await db.query("select * from public.profiles where id = $1", [dup]);
  assert.equal(rows[0].onboarded, false);
});

// --- Onboarding ----------------------------------------------------------------------------------
await test("complete_onboarding requires login, consent, a valid and free username", async () => {
  await asRole("anon", null, () =>
    expectError(db.query("select public.complete_onboarding('bobby', true, true)"), "permission denied"),
  );
  await asRole("authenticated", bob, async () => {
    await expectError(db.query("select public.complete_onboarding('bobby', false, true)"), "consent_required");
    await expectError(db.query("select public.complete_onboarding('bobby', true, false)"), "consent_required");
    await expectError(db.query("select public.complete_onboarding('no spaces!', true, true)"), "invalid_username");
    await expectError(db.query("select public.complete_onboarding('ALICE_1', true, true)"), "username_taken");
    await db.query("select public.complete_onboarding('bobby', true, true)");
    await expectError(db.query("select public.complete_onboarding('bobby2', true, true)"), "already_onboarded");
  });
});

await test("username_available works for anonymous visitors", async () => {
  await asRole("anon", null, async () => {
    assert.equal((await db.query("select public.username_available('alice_1') as ok")).rows[0].ok, false);
    assert.equal((await db.query("select public.username_available('fresh_name') as ok")).rows[0].ok, true);
    assert.equal((await db.query("select public.username_available('x') as ok")).rows[0].ok, false);
  });
});

// --- The one-click rule --------------------------------------------------------------------------
await test("logged-out visitors cannot place a splat", async () => {
  await asRole("anon", null, () => expectError(place(10, 10), "permission denied"));
});

await test("unverified email cannot place a splat", async () => {
  carol = await createUser({ email: "carol@example.com", verified: false, meta: fullMeta("carol_c") });
  await asRole("authenticated", carol, () => expectError(place(10, 10), "email_not_verified"));
});

await test("non-onboarded user cannot place a splat", async () => {
  const dave = await createUser({ email: "dave@example.com" });
  await asRole("authenticated", dave, () => expectError(place(10, 10), "not_onboarded"));
});

await test("out-of-bounds and NaN positions are rejected", async () => {
  await asRole("authenticated", alice, async () => {
    await expectError(place(-1, 10), "out_of_bounds");
    await expectError(place(10, 5001), "out_of_bounds");
    await expectError(place(NaN, 10), "out_of_bounds");
  });
  const { rows } = await db.query("select count(*)::int as n from public.splats");
  assert.equal(rows[0].n, 0, "failed attempts must not leave splats behind");
});

await test("a verified, onboarded user places exactly one splat, with a server-chosen seed", async () => {
  const { rows } = await asRole("authenticated", alice, () => place(1234.5, 4321.25));
  const s = rows[0];
  assert.equal(s.x, 1234.5);
  assert.equal(s.y, 4321.25);
  assert.ok(Number(s.seed) >= 0 && Number(s.seed) < 4294967296);
  const meta = (await db.query("select total_clicks::int as n from public.canvas_meta")).rows[0];
  assert.equal(meta.n, 1);
  const profile = (await db.query("select has_clicked from public.profiles where id = $1", [alice])).rows[0];
  assert.equal(profile.has_clicked, true);
});

await test("a second click is refused and changes nothing", async () => {
  await asRole("authenticated", alice, () => expectError(place(5, 5), "already_placed"));
  assert.equal((await db.query("select count(*)::int as n from public.splats")).rows[0].n, 1);
  assert.equal((await db.query("select total_clicks::int as n from public.canvas_meta")).rows[0].n, 1);
});

await test("many parallel attempts by one user still yield one splat", async () => {
  const erin = await createUser({ email: "erin@example.com", meta: fullMeta("erin_e") });
  // PGlite serialises queries, but this still exercises the lock + has_clicked path repeatedly.
  const results = await asRole("authenticated", erin, () =>
    Promise.allSettled(Array.from({ length: 10 }, (_, i) => place(100 + i, 100 + i))),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});

await test("clients cannot choose appearance: place_splat only accepts (x, y)", async () => {
  const { rows } = await db.query(
    `select pg_get_function_identity_arguments(p.oid) as args
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'place_splat'`,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].args, "p_x double precision, p_y double precision");
});

// --- Direct table access is closed ---------------------------------------------------------------
await test("the API roles cannot write to any table directly", async () => {
  await asRole("authenticated", alice, async () => {
    await expectError(db.query("insert into public.splats (x, y, seed) values (1, 1, 1)"), "permission denied");
    await expectError(db.query("update public.canvas_meta set total_clicks = 0"), "permission denied");
    await expectError(db.query("update public.profiles set has_clicked = false"), "permission denied");
    await expectError(db.query("delete from public.splats"), "permission denied");
  });
  await asRole("anon", null, async () => {
    await expectError(db.query("insert into public.splats (x, y, seed) values (1, 1, 1)"), "permission denied");
  });
});

await test("the API roles cannot read profiles, owners or the blocklist; public art + meta are readable", async () => {
  for (const role of ["anon", "authenticated"]) {
    await asRole(role, alice, async () => {
      await expectError(db.query("select * from public.profiles"), "permission denied");
      await expectError(db.query("select * from public.splat_owners"), "permission denied");
      await expectError(db.query("select * from public.blocked_email_domains"), "permission denied");
      const splats = await db.query("select id, x, y, seed from public.splats");
      assert.ok(splats.rows.length >= 1);
      const meta = await db.query("select total_clicks from public.canvas_meta");
      assert.equal(meta.rows.length, 1);
    });
  }
});

// --- Reading state -------------------------------------------------------------------------------
await test("my_state returns the caller's own data, and null when logged out", async () => {
  const mine = await asRole("authenticated", alice, async () => (await db.query("select public.my_state() as s")).rows[0].s);
  assert.equal(mine.username, "Alice_1");
  assert.equal(mine.has_clicked, true);
  assert.equal(mine.email_verified, true);
  assert.equal(mine.splat.x, 1234.5);
  const anon = await asRole("anon", null, async () => (await db.query("select public.my_state() as s")).rows[0].s);
  assert.equal(anon, null);
});

await test("splat_owner and splat_by_username expose only username + date", async () => {
  const id = (await db.query("select id from public.splats limit 1")).rows[0].id;
  await asRole("anon", null, async () => {
    const owner = (await db.query("select public.splat_owner($1) as o", [id])).rows[0].o;
    assert.deepEqual(Object.keys(owner).sort(), ["created_at", "username"]);
    assert.equal(owner.username, "Alice_1");
    const found = (await db.query("select public.splat_by_username('alice_1') as s")).rows[0].s;
    assert.equal(found.id, id);
    assert.equal(Object.hasOwn(found, "user_id"), false);
    const missing = (await db.query("select public.splat_by_username('nobody_here') as s")).rows[0].s;
    assert.equal(missing, null);
  });
});

await test("deleting an account keeps the splat but makes it anonymous (and frees nothing)", async () => {
  const frank = await createUser({ email: "frank@example.com", meta: fullMeta("frank_f") });
  const { rows } = await asRole("authenticated", frank, () => place(3000, 3000));
  await db.query("delete from auth.users where id = $1", [frank]);
  const owner = (await db.query("select public.splat_owner($1) as o", [rows[0].id])).rows[0].o;
  assert.equal(owner.username, null);
  assert.equal((await db.query("select count(*)::int as n from public.splats where id = $1", [rows[0].id])).rows[0].n, 1);
});

// --- Closing the canvas --------------------------------------------------------------------------
await test("closed, expired and full canvases refuse new splats without leaving junk behind", async () => {
  const gina = await createUser({ email: "gina@example.com", meta: fullMeta("gina_g") });
  const before = (await db.query("select count(*)::int as n from public.splats")).rows[0].n;

  await db.exec("update public.canvas_meta set status = 'closed'");
  await asRole("authenticated", gina, () => expectError(place(1, 1), "canvas_closed"));
  await db.exec("update public.canvas_meta set status = 'active', closes_at = now() - interval '1 minute'");
  await asRole("authenticated", gina, () => expectError(place(1, 1), "canvas_closed"));
  await db.exec("update public.canvas_meta set closes_at = null, max_splats = total_clicks");
  await asRole("authenticated", gina, () => expectError(place(1, 1), "canvas_closed"));

  assert.equal((await db.query("select count(*)::int as n from public.splats")).rows[0].n, before);
  assert.equal((await db.query("select has_clicked from public.profiles where id = $1", [gina])).rows[0].has_clicked, false);

  await db.exec("update public.canvas_meta set max_splats = null");
  await asRole("authenticated", gina, () => place(1, 1));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
await db.close();
