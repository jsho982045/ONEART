// Runs the real migrations against an in-memory Postgres (PGlite) and tries to break the rules.
// No Supabase project or network needed.
//
//   npm run test:db

import assert from "node:assert/strict";
import { asRole, createUser, encode, freshDb } from "./pglite-supabase.mjs";

const db = await freshDb();

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

async function expectError(promise, fragment) {
  try {
    await promise;
  } catch (err) {
    assert.ok(String(err.message).includes(fragment), `expected error containing "${fragment}", got "${err.message}"`);
    return;
  }
  assert.fail(`expected an error containing "${fragment}" but the call succeeded`);
}

const canvasId = (await db.query("select id from public.canvases where slug = 'first'")).rows[0].id;
const line = (x0, y0, x1, y1, n = 10) =>
  encode(Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1), 0.5]));
const draw = (args = {}) =>
  db.query(
    `select * from public.draw_stroke($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      args.canvas ?? canvasId,
      args.tool ?? "ink",
      args.color ?? "#1f3a93",
      args.size ?? 4,
      args.opacity ?? 1,
      args.points ?? line(100, 100, 200, 100),
      args.body ?? null,
      args.font ?? null,
    ],
  );

console.log("database tests");

// --- Signup and onboarding (unchanged from v1, still enforced) ----------------------------------

await test("rejects disposable email domains", async () => {
  await expectError(createUser(db, { email: "x@mailinator.com", username: "burner1" }), "disposable_email_not_allowed");
});

const alice = await createUser(db, { email: "alice@example.com", username: "Alice_1" });
const bob = await createUser(db, { email: "bob@example.com", username: "bob_b" });
const carol = await createUser(db, { email: "carol@example.com", username: "carol_c", verified: false });
const google = await createUser(db, { email: "g@example.com" });

await test("every profile gets a distinct public artist number", async () => {
  const { rows } = await db.query("select artist_no from public.profiles order by artist_no");
  assert.equal(new Set(rows.map((r) => String(r.artist_no))).size, rows.length);
  assert.ok(rows.every((r) => r.artist_no != null));
});

await test("Google signups still have to finish onboarding", async () => {
  const { rows } = await db.query("select onboarded, username from public.profiles where id = $1", [google]);
  assert.equal(rows[0].onboarded, false);
  assert.match(rows[0].username, /^artist_[0-9a-f]{8}$/);
});

// --- Who can paint ------------------------------------------------------------------------------

await test("logged-out visitors cannot paint", async () => {
  await asRole(db, "anon", null, () => expectError(draw(), "permission denied"));
});

await test("unverified email cannot paint", async () => {
  await asRole(db, "authenticated", carol, () => expectError(draw(), "email_not_verified"));
});

await test("non-onboarded account cannot paint", async () => {
  await asRole(db, "authenticated", google, () => expectError(draw(), "not_onboarded"));
});

await test("a verified, onboarded artist can paint, and the database computes the bounds", async () => {
  const { rows } = await asRole(db, "authenticated", alice, () => draw({ size: 4, points: line(100, 100, 200, 100) }));
  const s = rows[0];
  const me = (await db.query("select artist_no from public.profiles where id = $1", [alice])).rows[0];
  assert.equal(String(s.artist_no), String(me.artist_no));
  assert.equal(s.min_x, 96);
  assert.equal(s.max_x, 204);
  assert.equal(s.min_y, 96);
  assert.equal(s.max_y, 104);
  assert.ok(Math.abs(s.ink_cost - (100 + 4) * 4) < 0.01, `ink cost ${s.ink_cost}`);
});

await test("bad input is rejected", async () => {
  await asRole(db, "authenticated", alice, async () => {
    await expectError(draw({ tool: "spraycan" }), "invalid_tool");
    await expectError(draw({ color: "red" }), "invalid_color");
    await expectError(draw({ color: "#ABCDEF" }), "invalid_color");
    await expectError(draw({ size: 0 }), "invalid_size");
    await expectError(draw({ size: 401 }), "invalid_size");
    await expectError(draw({ size: "NaN" }), "invalid_size");
    await expectError(draw({ opacity: 0 }), "invalid_opacity");
    await expectError(draw({ points: "not base64!!" }), "invalid_points");
    await expectError(draw({ points: Buffer.from([2, 0, 0, 0, 0, 0]).toString("base64") }), "invalid_points");
    await expectError(draw({ points: Buffer.from([1, 0, 0, 0]).toString("base64") }), "invalid_points");
    await expectError(draw({ points: encode([[12500, 10]]) }), "out_of_bounds");
    await expectError(draw({ points: encode(Array.from({ length: 3001 }, (_, i) => [i % 1000, 10])) }), "stroke_too_long");
  });
});

await test("text needs one anchor point, words and a known font", async () => {
  await asRole(db, "authenticated", alice, async () => {
    await expectError(draw({ tool: "text", body: "hi", font: "comic", points: encode([[500, 500]]) }), "invalid_font");
    await expectError(draw({ tool: "text", body: "", font: "hand", points: encode([[500, 500]]) }), "invalid_text");
    await expectError(draw({ tool: "text", body: "a\nb", font: "hand", points: encode([[500, 500]]) }), "invalid_text");
    await expectError(draw({ tool: "text", body: "hi", font: "hand", points: line(1, 1, 5, 5) }), "invalid_points");
    await expectError(draw({ tool: "ink", body: "hi" }), "invalid_text");
    const { rows } = await draw({ tool: "text", body: "hello", font: "serif", size: 40, points: encode([[500, 500]]) });
    assert.equal(rows[0].body, "hello");
    assert.ok(rows[0].min_y < 500 && rows[0].max_x > 500 + 5 * 40 * 0.5);
  });
});

await test("the browser cannot write tables directly", async () => {
  await asRole(db, "authenticated", alice, async () => {
    await expectError(
      db.query(`insert into public.strokes (canvas_id, tool, color, size, opacity, points, min_x, min_y, max_x, max_y, ink_cost)
                values ($1, 'ink', '#000000', 1, 1, '', 0, 0, 1, 1, 0)`, [canvasId]),
      "permission denied",
    );
    await expectError(db.query("update public.strokes set color = '#ff0000'"), "permission denied");
    await expectError(db.query("delete from public.strokes"), "permission denied");
    await expectError(db.query("update public.profiles set ink = 1e12"), "permission denied");
    await expectError(db.query("select * from public.stroke_hidden"), "permission denied");
    await expectError(db.query("select * from public.reports"), "permission denied");
  });
});

await test("anyone can read the canvas and the strokes, but not who is behind an artist number", async () => {
  await asRole(db, "anon", null, async () => {
    const { rows } = await db.query("select * from public.strokes");
    assert.ok(rows.length >= 2);
    assert.ok(!("user_id" in rows[0]));
    await expectError(db.query("select * from public.profiles"), "permission denied");
    const names = await db.query("select * from public.artist_names(array[1,2,3]::bigint[])");
    assert.ok(names.rows.some((r) => r.username === "Alice_1"));
    assert.deepEqual(Object.keys(names.rows[0]).sort(), ["artist_no", "username"]);
  });
});

// --- Canvas window ------------------------------------------------------------------------------

await test("a closed (or not yet open) canvas cannot be painted on", async () => {
  await db.query("update public.canvases set opens_at = now() - interval '2 days', closes_at = now() - interval '1 day' where id = $1", [canvasId]);
  await asRole(db, "authenticated", alice, () => expectError(draw(), "canvas_closed"));
  await db.query("update public.canvases set opens_at = now() + interval '1 day', closes_at = now() + interval '2 days' where id = $1", [canvasId]);
  await asRole(db, "authenticated", alice, () => expectError(draw(), "canvas_closed"));
  await db.query("update public.canvases set opens_at = now() - interval '1 minute', closes_at = now() + interval '30 days' where id = $1", [canvasId]);
});

// --- Ink well and rate limit --------------------------------------------------------------------

await test("the ink well drains, may dip below zero once, then blocks until it refills", async () => {
  await db.query("update public.canvases set ink_capacity = 1000, ink_refill_seconds = 3600 where id = $1", [canvasId]);
  await db.query("update public.profiles set ink = null, ink_at = null where id = $1", [bob]);
  await asRole(db, "authenticated", bob, async () => {
    // cost = (length 600 + size 4) * 4 = 2416 > capacity: allowed because the well wasn't empty.
    await draw({ size: 4, points: line(100, 300, 700, 300, 40) });
    await expectError(draw(), "out_of_ink");
  });
  const { rows } = await db.query("select ink from public.profiles where id = $1", [bob]);
  assert.equal(Number(rows[0].ink), -500, "floor is half the capacity below zero");
  // Two hours later the well is part-full again (refills at 1000 per hour).
  await db.query("update public.profiles set ink_at = now() - interval '2 hours' where id = $1", [bob]);
  await asRole(db, "authenticated", bob, () => draw());
  await db.query("update public.canvases set ink_capacity = 800000, ink_refill_seconds = 7200 where id = $1", [canvasId]);
});

await test("more than 90 strokes a minute is throttled", async () => {
  await db.query("update public.profiles set rate_window = now(), rate_count = 90 where id = $1", [alice]);
  await asRole(db, "authenticated", alice, () => expectError(draw(), "slow_down"));
  await db.query("update public.profiles set rate_window = now() - interval '61 seconds' where id = $1", [alice]);
  await asRole(db, "authenticated", alice, () => draw());
});

// --- Undo / erase -------------------------------------------------------------------------------

await test("you can erase and restore only your own strokes", async () => {
  const mine = (await asRole(db, "authenticated", alice, () => draw())).rows[0].id;
  await asRole(db, "authenticated", bob, () => expectError(db.query("select public.set_stroke_erased($1, true)", [mine]), "not_yours"));
  await asRole(db, "anon", null, () => expectError(db.query("select public.set_stroke_erased($1, true)", [mine]), "permission denied"));
  await asRole(db, "authenticated", alice, async () => {
    await db.query("select public.set_stroke_erased($1, true)", [mine]);
    assert.equal((await db.query("select erased from public.strokes where id = $1", [mine])).rows[0].erased, true);
    await db.query("select public.set_stroke_erased($1, false)", [mine]);
    assert.equal((await db.query("select erased from public.strokes where id = $1", [mine])).rows[0].erased, false);
  });
});

// --- Reports and moderation ---------------------------------------------------------------------

let bad;
await test("anyone signed in can report a stroke once", async () => {
  bad = (await asRole(db, "authenticated", bob, () => draw({ color: "#ff0000" }))).rows[0].id;
  await asRole(db, "authenticated", alice, async () => {
    await db.query("select public.report_stroke($1, 'hate')", [bad]);
    await db.query("select public.report_stroke($1, 'hate')", [bad]); // duplicate is ignored
    await expectError(db.query("select public.report_stroke($1, 'boring')", [bad]), "invalid_reason");
  });
  await asRole(db, "anon", null, () => expectError(db.query("select public.report_stroke($1, 'hate')", [bad]), "permission denied"));
  assert.equal((await db.query("select count(*)::int as n from public.reports")).rows[0].n, 1);
});

await test("only admins can moderate", async () => {
  await asRole(db, "authenticated", alice, async () => {
    await expectError(db.query("select public.admin_set_hidden($1, true)", [bad]), "not_admin");
    await expectError(db.query("select public.admin_ban_artist(1)"), "not_admin");
    await expectError(db.query("select * from public.admin_open_reports()"), "not_admin");
  });
});

await test("hiding a stroke removes its geometry from public view, and it can be restored", async () => {
  await db.query("update public.profiles set is_admin = true where id = $1", [alice]);
  await asRole(db, "authenticated", alice, async () => {
    const reports = await db.query("select * from public.admin_open_reports()");
    assert.equal(reports.rows.length, 1);
    await db.query("select public.admin_set_hidden($1, true)", [bad]);
  });
  const pub = (await db.query("select hidden, points, body from public.strokes where id = $1", [bad])).rows[0];
  assert.equal(pub.hidden, true);
  assert.equal(pub.points, "");
  await asRole(db, "authenticated", bob, () => expectError(db.query("select public.set_stroke_erased($1, false)", [bad]), "not_allowed"));
  await asRole(db, "authenticated", alice, () => db.query("select public.admin_set_hidden($1, false)", [bad]));
  const back = (await db.query("select hidden, points from public.strokes where id = $1", [bad])).rows[0];
  assert.equal(back.hidden, false);
  assert.ok(back.points.length > 0);
  assert.equal((await db.query("select count(*)::int as n from public.reports where resolved_at is null")).rows[0].n, 0);
});

await test("banning an artist hides all their work and stops them painting", async () => {
  const bobNo = (await db.query("select artist_no from public.profiles where id = $1", [bob])).rows[0].artist_no;
  const hidden = await asRole(db, "authenticated", alice, () => db.query("select public.admin_ban_artist($1) as n", [bobNo]));
  assert.ok(Number(hidden.rows[0].n) >= 1);
  const left = (await db.query("select count(*)::int as n from public.strokes where artist_no = $1 and not hidden", [bobNo])).rows[0].n;
  assert.equal(left, 0);
  await asRole(db, "authenticated", bob, () => expectError(draw(), "banned"));
});

await test("my_state reports what the studio needs, and nothing for visitors", async () => {
  const s = await asRole(db, "authenticated", alice, () => db.query("select public.my_state() as s"));
  const st = s.rows[0].s;
  assert.equal(st.username, "Alice_1");
  assert.equal(st.is_admin, true);
  assert.equal(st.email_verified, true);
  assert.ok(st.artist_no != null);
  const v = await asRole(db, "anon", null, () => db.query("select public.my_state() as s"));
  assert.equal(v.rows[0].s, null);
});

await test("deleting an account keeps the painting, anonymously", async () => {
  const dave = await createUser(db, { email: "dave@example.com", username: "dave_d" });
  const id = (await asRole(db, "authenticated", dave, () => draw())).rows[0].id;
  await db.query("delete from auth.users where id = $1", [dave]);
  const row = (await db.query("select artist_no, hidden from public.strokes where id = $1", [id])).rows[0];
  assert.equal(row.artist_no, null);
  assert.equal(row.hidden, false);
});

// --- Worker support -----------------------------------------------------------------------------

await test("erasing or hiding a stroke stamps changed_at so the tile worker repaints it", async () => {
  const id = (await asRole(db, "authenticated", alice, () => draw())).rows[0].id;
  await db.query("update public.strokes set changed_at = now() - interval '1 hour' where id = $1", [id]);
  await asRole(db, "authenticated", alice, () => db.query("select public.set_stroke_erased($1, true)", [id]));
  const { rows } = await db.query("select changed_at > now() - interval '1 minute' as fresh from public.strokes where id = $1", [id]);
  assert.equal(rows[0].fresh, true);
});

await test("participant emails are never reachable from the browser", async () => {
  await asRole(db, "anon", null, () => expectError(db.query("select * from public.worker_participants($1)", [canvasId]), "permission denied"));
  await asRole(db, "authenticated", alice, () =>
    expectError(db.query("select * from public.worker_participants($1)", [canvasId]), "permission denied"),
  );
  await asRole(db, "authenticated", alice, () => expectError(db.query("select * from public.canvas_notices"), "permission denied"));
  const { rows } = await db.query("select * from public.worker_participants($1)", [canvasId]);
  assert.ok(rows.some((r) => r.email === "alice@example.com"));
  assert.ok(!rows.some((r) => r.email === "bob@example.com"), "banned artists are excluded");
});

await test("only admins can schedule canvases", async () => {
  const args = [null, "second", "The second canvas", new Date(Date.now() + 86400e3).toISOString(), new Date(Date.now() + 31 * 86400e3).toISOString(), 800000, 7200];
  const q = "select * from public.admin_save_canvas($1, $2, $3, $4, $5, $6, $7)";
  const carolV = await createUser(db, { email: "x2@example.com", username: "notadmin" });
  await asRole(db, "authenticated", carolV, () => expectError(db.query(q, args), "not_admin"));
  const made = (await asRole(db, "authenticated", alice, () => db.query(q, args))).rows[0];
  assert.equal(made.slug, "second");
  const moved = (await asRole(db, "authenticated", alice, () => db.query(q, [made.id, "second", "Renamed", args[3], args[4], 500000, 3600]))).rows[0];
  assert.equal(moved.title, "Renamed");
  await asRole(db, "authenticated", alice, () => expectError(db.query(q, [made.id, "second", "Bad", args[4], args[3], 1, 1]), "check"));
});

await test("names that impersonate the site are never available", async () => {
  await asRole(db, "anon", null, async () => {
    assert.equal((await db.query("select public.username_available('OneArt_Official') as ok")).rows[0].ok, false);
    assert.equal((await db.query("select public.username_available('the_admin') as ok")).rows[0].ok, false);
  });
  const sneaky = await createUser(db, { email: "s@example.com", username: "Admin_Jack" });
  const { rows } = await db.query("select username, onboarded from public.profiles where id = $1", [sneaky]);
  assert.match(rows[0].username, /^artist_/);
  assert.equal(rows[0].onboarded, false);
  await asRole(db, "authenticated", sneaky, () =>
    expectError(db.query("select public.complete_onboarding('mod_staff', true, true)"), "username_taken"),
  );
});

await test("only the server can record purchases; people can only ask about their own", async () => {
  await asRole(db, "authenticated", alice, async () => {
    await expectError(
      db.query("insert into public.purchases (user_id, canvas_id, stripe_session_id, amount_cents, currency) values ($1, $2, 'cs_x', 199, 'usd')", [alice, canvasId]),
      "permission denied",
    );
    await expectError(db.query("select * from public.purchases"), "permission denied");
    assert.equal((await db.query("select public.owns_copy($1) as ok", [canvasId])).rows[0].ok, false);
    assert.equal((await db.query("select public.has_painted($1) as ok", [canvasId])).rows[0].ok, true);
  });
  await db.query("insert into public.purchases (user_id, canvas_id, stripe_session_id, amount_cents, currency) values ($1, $2, 'cs_test_1', 199, 'usd')", [alice, canvasId]);
  await asRole(db, "authenticated", alice, async () => {
    assert.equal((await db.query("select public.owns_copy($1) as ok", [canvasId])).rows[0].ok, true);
  });
  const newbie = await createUser(db, { email: "n@example.com", username: "newbie" });
  await asRole(db, "authenticated", newbie, async () => {
    assert.equal((await db.query("select public.owns_copy($1) as ok", [canvasId])).rows[0].ok, false);
    assert.equal((await db.query("select public.has_painted($1) as ok", [canvasId])).rows[0].ok, false);
  });
  await db.query("update public.purchases set refunded_at = now() where stripe_session_id = 'cs_test_1'");
  await asRole(db, "authenticated", alice, async () => {
    assert.equal((await db.query("select public.owns_copy($1) as ok", [canvasId])).rows[0].ok, false, "refunds revoke access");
  });
  await asRole(db, "anon", null, () => expectError(db.query("select public.owns_copy($1)", [canvasId]), "permission denied"));
});

console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
