// Shared by the *.test.js files. Not itself a test (the npm script only runs
// *.test.js), and deliberately dependency-free: node:test + pg + fetch.
//
// These tests need a real Postgres — the guarantees being tested (the
// immutability trigger, row locking, ON DELETE cascades, the migration
// itself) live in the database, so mocking it would test nothing. Point
// TEST_DATABASE_URL at any Postgres you can CREATE DATABASE on, e.g.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test
// Each test file creates (and drops) its own scratch database, so nothing
// here ever touches a real database.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES = join(here, "fixtures");
export const CURRENT_SCHEMA = join(here, "..", "src", "db", "schema.sql");

export const TEST_ORIGIN = "http://localhost:5173";

function adminUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set. These tests need a Postgres server they can CREATE DATABASE on, e.g.\n" +
        "  TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres npm test"
    );
  }
  return url;
}

// Creates a fresh, empty scratch database and applies each SQL file in
// order. Returns { url, query, drop }.
export async function createScratchDb(schemaFiles = [CURRENT_SCHEMA]) {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  const name = `pb_test_${randomBytes(6).toString("hex")}`;
  await admin.query(`CREATE DATABASE ${name}`);

  const u = new URL(adminUrl());
  u.pathname = `/${name}`;
  const url = u.toString();

  const db = new pg.Client({ connectionString: url });
  await db.connect();
  for (const file of schemaFiles) {
    await db.query(readFileSync(file, "utf8"));
  }

  return {
    url,
    // Applies another SQL file to this same database (e.g. the current
    // schema on top of an old one — that is the migration under test).
    applySchemaFile: (file) => db.query(readFileSync(file, "utf8")),
    query: (text, params) => db.query(text, params),
    async drop() {
      await db.end().catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

// Boots the real Express app (src/app.js) against a scratch database on an
// ephemeral port. Env must be set BEFORE the app is imported — pool.js and
// allowedOrigins.js read it at import time — which is why this imports
// dynamically and why each test file gets its own process.
export async function startApp(scratchDb) {
  process.env.DATABASE_URL = scratchDb.url;
  process.env.JWT_SECRET = "test-secret";
  process.env.ALLOWED_ORIGIN = TEST_ORIGIN;
  const { default: app } = await import("../src/app.js");
  const { pool } = await import("../src/db/pool.js");

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://localhost:${server.address().port}`;

  return {
    base,
    pool,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
    },
  };
}

// A logged-in test user, created through the real signup endpoint (so the
// real cookie/JWT path is exercised). api(method, path, body) returns
// { status, body }.
export async function signupUser(base, label) {
  const email = `${label.toLowerCase()}@example.com`;
  const res = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
    body: JSON.stringify({ email, password: "password123!", firstName: label, lastName: "Tester" }),
  });
  if (res.status !== 201) {
    throw new Error(`signup failed for ${label}: ${res.status} ${await res.text()}`);
  }
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("session=")).split(";")[0];
  const { user } = await res.json();

  async function api(method, path, body) {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try {
      json = await r.json();
    } catch {
      // empty body
    }
    return { status: r.status, body: json };
  }

  return { id: user.id, email, api };
}

// Creates a prompt the way the product does: a completed generation saved
// through POST /api/sessions. Returns { promptId, versionNumber }.
export async function createPrompt(user, originalPrompt = "Write a refund email", rawAssembled) {
  const { status, body } = await user.api("POST", "/api/sessions", {
    originalPrompt,
    qaPairs: [{ question: "Who is it for?", answer: "customers" }],
    supportingContext: "internal policy notes",
    promptObject: { task: "t" },
    rawAssembled: rawAssembled ?? `<task>\n${originalPrompt}\n</task>`,
  });
  if (status !== 201 || !body.prompt) {
    throw new Error(`createPrompt failed: ${status} ${JSON.stringify(body)}`);
  }
  return { promptId: body.prompt.id, versionNumber: body.prompt.versionNumber, title: body.prompt.title };
}
