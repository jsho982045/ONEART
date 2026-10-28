// In-memory Postgres (PGlite) with just enough of Supabase (roles, auth schema, auth.uid()) to run the
// real migrations. Shared by `npm run test:db` and the TypeScript/SQL parity tests.

import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");

export async function freshDb() {
  const db = new PGlite();
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
  return db;
}

export async function asRole(db, role, uid, fn) {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? ""]);
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}

export async function createUser(db, { email, verified = true, username }) {
  const meta = username ? { username, terms_accepted: "true", age_confirmed: "true" } : {};
  const { rows } = await db.query(
    `insert into auth.users (email, email_confirmed_at, raw_user_meta_data)
     values ($1, ${verified ? "now()" : "null"}, $2::jsonb) returning id`,
    [email, JSON.stringify(meta)],
  );
  return rows[0].id;
}

/** Same wire format as src/lib/paint/codec.ts (kept tiny on purpose: the parity test checks they agree). */
export function encode(points) {
  const bytes = Buffer.alloc(1 + points.length * 5);
  bytes[0] = 1;
  let o = 1;
  for (const [x, y, p = 0.5] of points) {
    const qx = Math.round(x * 4);
    const qy = Math.round(y * 4);
    bytes.writeUInt16LE(qx, o);
    bytes.writeUInt16LE(qy, o + 2);
    bytes[o + 4] = Math.round(p * 255);
    o += 5;
  }
  return bytes.toString("base64");
}
