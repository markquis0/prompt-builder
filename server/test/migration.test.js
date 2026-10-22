import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { createScratchDb, FIXTURES, CURRENT_SCHEMA } from "./helpers.js";

const BEFORE_VERSIONING = join(FIXTURES, "schema_before_versioning.sql");
const VERSIONING_V1 = join(FIXTURES, "schema_versioning_v1.sql");

const USER = "11111111-1111-1111-1111-111111111111";

// The state production was actually in before prompt version control:
// users and sessions, no prompts tables. Applying the current schema to it
// IS the migration being tested.
describe("migration: sessions -> prompts + v1", () => {
  let db;

  before(async () => {
    db = await createScratchDb([BEFORE_VERSIONING]);
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name)
       VALUES ($1, 'a@example.com', 'x', 'A', 'B')`,
      [USER]
    );
    await db.query(
      `INSERT INTO sessions (user_id, original_prompt, qa_pairs, supporting_context, prompt_object, raw_assembled, category, created_at)
       VALUES
        ($1, 'Write a refund email', '[{"question":"q","answer":"a"}]', 'ctx', '{"task":"t"}', '<task>t</task>', 'Writing', now() - interval '2 days'),
        ($1, 'Second prompt', '[]', '', NULL, '<task>second</task>', NULL, now() - interval '1 day'),
        ($1, 'Half-finished intake', '[]', '', NULL, '', NULL, now()),
        ($1, '   ', '[]', '', NULL, '<task>blank original</task>', NULL, now())`,
      [USER]
    );
    await db.applySchemaFile(CURRENT_SCHEMA);
  });
  after(() => db.drop());

  test("completed sessions become prompts with a v1", async () => {
    const { rows } = await db.query(
      `SELECT p.name, p.prompt_type, v.version_number, v.content, v.original_prompt, v.supporting_context, v.session_id
       FROM prompts p JOIN prompt_versions v ON v.prompt_id = p.id ORDER BY p.created_at`
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.name, r.prompt_type, r.version_number, r.content]),
      [
        ["Write a refund email", "Writing", 1, "<task>t</task>"],
        ["Second prompt", null, 1, "<task>second</task>"],
      ]
    );
    assert.equal(rows[0].original_prompt, "Write a refund email");
    assert.equal(rows[0].supporting_context, "ctx");
    assert.ok(rows[0].session_id, "version keeps a link back to its generation");
  });

  test("sessions with no assembled text or no original prompt are ignored", async () => {
    const { rows } = await db.query("SELECT original_prompt FROM prompt_versions");
    const originals = rows.map((r) => r.original_prompt);
    assert.ok(!originals.includes("Half-finished intake"));
    assert.ok(!originals.some((o) => o.trim() === ""));
    // ...but the sessions themselves are untouched.
    const { rows: sessions } = await db.query("SELECT count(*)::int AS n FROM sessions");
    assert.equal(sessions[0].n, 4);
  });

  test("each prompt's current version pointer is its v1", async () => {
    const { rows } = await db.query(
      `SELECT p.current_version_id = v.id AS is_current
       FROM prompts p JOIN prompt_versions v ON v.prompt_id = p.id`
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.is_current));
  });

  test("running the migration again creates no duplicates", async () => {
    await db.applySchemaFile(CURRENT_SCHEMA);
    await db.applySchemaFile(CURRENT_SCHEMA);
    const { rows } = await db.query(
      "SELECT (SELECT count(*)::int FROM prompts) AS prompts, (SELECT count(*)::int FROM prompt_versions) AS versions"
    );
    assert.deepEqual(rows[0], { prompts: 2, versions: 2 });
  });
});

// Production's state after the first version-control release: prompts with
// several versions already. The sharing/provenance migration must leave all
// of it exactly as it was.
describe("migration: versioning v1 -> sharing schema", () => {
  let db;
  const PROMPT = "22222222-2222-2222-2222-222222222222";
  const V1 = "33333333-3333-3333-3333-333333333331";
  const V2 = "33333333-3333-3333-3333-333333333332";
  const V3 = "33333333-3333-3333-3333-333333333333";

  before(async () => {
    db = await createScratchDb([VERSIONING_V1]);
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name)
       VALUES ($1, 'a@example.com', 'x', 'A', 'B')`,
      [USER]
    );
    await db.query(`INSERT INTO prompts (id, user_id, name) VALUES ($1, $2, 'Existing title')`, [PROMPT, USER]);
    await db.query(
      `INSERT INTO prompt_versions (id, prompt_id, version_number, content, change_note, parent_version_id, created_by)
       VALUES ($1, $4, 1, 'one', NULL, NULL, $5),
              ($2, $4, 2, 'two', 'tweak', $1, $5),
              ($3, $4, 3, 'three', NULL, $2, $5)`,
      [V1, V2, V3, PROMPT, USER]
    );
    await db.query("UPDATE prompts SET current_version_id = $1 WHERE id = $2", [V3, PROMPT]);
    await db.applySchemaFile(CURRENT_SCHEMA);
  });
  after(() => db.drop());

  test("existing prompts keep their titles, versions, parents and current pointer", async () => {
    const { rows: prompts } = await db.query("SELECT name, current_version_id, copied_from_prompt_id FROM prompts");
    assert.deepEqual(prompts, [{ name: "Existing title", current_version_id: V3, copied_from_prompt_id: null }]);

    const { rows } = await db.query(
      "SELECT version_number, content, change_note, parent_version_id, source FROM prompt_versions ORDER BY version_number"
    );
    assert.deepEqual(
      rows.map((r) => [r.version_number, r.content, r.change_note, r.parent_version_id]),
      [
        [1, "one", null, null],
        [2, "two", "tweak", V1],
        [3, "three", null, V2],
      ]
    );
    // Old versions can't be backfilled (they're immutable); NULL means unknown.
    assert.ok(rows.every((r) => r.source === null));
  });

  test("the sharing table exists, with one share per person per prompt", async () => {
    await db.query(
      `INSERT INTO users (id, email, password_hash, first_name, last_name)
       VALUES ('44444444-4444-4444-4444-444444444444', 'b@example.com', 'x', 'B', 'B')`
    );
    await db.query("INSERT INTO prompt_shares (prompt_id, shared_with_user_id) VALUES ($1, '44444444-4444-4444-4444-444444444444')", [PROMPT]);
    await assert.rejects(
      db.query("INSERT INTO prompt_shares (prompt_id, shared_with_user_id) VALUES ($1, '44444444-4444-4444-4444-444444444444')", [PROMPT]),
      /unique/i
    );
  });

  test("only the 'viewer' permission is allowed", async () => {
    await assert.rejects(
      db.query(
        "INSERT INTO prompt_shares (prompt_id, shared_with_user_id, permission) VALUES ($1, $2, 'editor')",
        [PROMPT, USER]
      ),
      /check/i
    );
  });

  test("re-running the migration is harmless", async () => {
    await db.applySchemaFile(CURRENT_SCHEMA);
    const { rows } = await db.query("SELECT count(*)::int AS n FROM prompt_versions");
    assert.equal(rows[0].n, 3);
  });
});
