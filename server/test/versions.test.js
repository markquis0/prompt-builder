import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createScratchDb, startApp, signupUser, createPrompt } from "./helpers.js";

let db;
let app;
let alice;

before(async () => {
  db = await createScratchDb();
  app = await startApp(db);
  alice = await signupUser(app.base, "Alice");
});

after(async () => {
  await app.stop();
  await db.drop();
});

const versionsOf = async (promptId) => (await alice.api("GET", `/api/prompts/${promptId}/versions`)).body.versions;

describe("creating a prompt from a generation", () => {
  test("becomes a prompt with v1, current, and a readable default title", async () => {
    const { status, body } = await alice.api("POST", "/api/sessions", {
      originalPrompt: "Write me a LinkedIn post about our new product launch. Make it punchy and short.",
      rawAssembled: "<task>x</task>",
    });
    assert.equal(status, 201);
    assert.equal(body.prompt.versionNumber, 1);
    assert.equal(body.prompt.title, "Write me a LinkedIn post about our new product launch");

    const v = (await alice.api("GET", `/api/prompts/${body.prompt.id}/versions`)).body.versions;
    assert.equal(v.length, 1);
    assert.equal(v[0].isCurrent, true);
    assert.equal(v[0].source, "generated");
  });

  test("a half-finished intake is saved as a session but never becomes a prompt", async () => {
    const { status, body } = await alice.api("POST", "/api/sessions", { originalPrompt: "just typing", rawAssembled: "" });
    assert.equal(status, 201);
    assert.equal(body.prompt, null);
  });
});

describe("creating versions", () => {
  test("increments the number, keeps old versions, sets the parent, moves current, stores the note", async () => {
    const { promptId } = await createPrompt(alice);

    const r2 = await alice.api("POST", `/api/prompts/${promptId}/versions`, {
      content: "<task>\nv2 text\n</task>",
      changeNote: "  Tighter wording  ",
    });
    assert.equal(r2.status, 201);
    assert.equal(r2.body.version.versionNumber, 2);
    assert.equal(r2.body.version.changeNote, "Tighter wording");
    assert.equal(r2.body.version.source, "edited");
    assert.equal(r2.body.version.isCurrent, true);

    const r3 = await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv3 text\n</task>" });
    assert.equal(r3.body.version.versionNumber, 3);
    assert.equal(r3.body.version.changeNote, null);

    const list = await versionsOf(promptId);
    assert.deepEqual(list.map((v) => [v.versionNumber, v.isCurrent]), [[3, true], [2, false], [1, false]]);

    // parent chain: v3 -> v2 -> v1 -> none
    const byNumber = Object.fromEntries(list.map((v) => [v.versionNumber, v]));
    assert.equal(byNumber[3].parentVersionId, byNumber[2].id);
    assert.equal(byNumber[2].parentVersionId, byNumber[1].id);
    assert.equal(byNumber[1].parentVersionId, null);

    // the old versions' content is untouched
    const v1 = (await alice.api("GET", `/api/prompts/${promptId}/versions/1`)).body.version;
    assert.equal(v1.content, "<task>\nWrite a refund email\n</task>");
    const { rows } = await db.query("SELECT current_version_id FROM prompts WHERE id = $1", [promptId]);
    assert.equal(rows[0].current_version_id, byNumber[3].id);
  });

  test("an edited version re-derives its sections and carries the generation inputs forward", async () => {
    const { promptId } = await createPrompt(alice, "Carry inputs");
    const { body } = await alice.api("POST", `/api/prompts/${promptId}/versions`, {
      content: "<task>\nnew task\n</task>\n\n<tone>\nwarm\n</tone>",
    });
    assert.equal(body.version.promptObject.task, "new task");
    assert.equal(body.version.promptObject.tone, "warm");
    assert.equal(body.version.originalPrompt, "Carry inputs");
    assert.equal(body.version.supportingContext, "internal policy notes");
  });

  test("rejects identical content, empty content, and over-long notes", async () => {
    const { promptId } = await createPrompt(alice, "Reject cases");
    const same = await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nReject cases\n</task>" });
    assert.equal(same.status, 409);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "   " })).status, 400);
    const longNote = await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>x</task>", changeNote: "n".repeat(501) });
    assert.equal(longNote.status, 400);
    assert.equal((await versionsOf(promptId)).length, 1, "failed saves leave no trace");
  });
});

describe("immutability (enforced by the database, not just the API)", () => {
  test("a saved version cannot be updated by any statement", async () => {
    const { promptId } = await createPrompt(alice, "Immutable");
    await assert.rejects(
      db.query("UPDATE prompt_versions SET content = 'tampered' WHERE prompt_id = $1", [promptId]),
      /immutable/
    );
    await assert.rejects(
      db.query("UPDATE prompt_versions SET change_note = 'x' WHERE prompt_id = $1", [promptId]),
      /immutable/
    );
    const { rows } = await db.query("SELECT content FROM prompt_versions WHERE prompt_id = $1", [promptId]);
    assert.equal(rows[0].content, "<task>\nImmutable\n</task>");
  });
});

describe("restore", () => {
  test("restoring v4 while on v10 creates v11 and leaves v1-v10 alone", async () => {
    const { promptId } = await createPrompt(alice, "Restore me");
    for (let n = 2; n <= 10; n++) {
      const r = await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: `<task>\ncontent of v${n}\n</task>` });
      assert.equal(r.body.version.versionNumber, n);
    }
    const before = (await db.query("SELECT version_number, content, change_note FROM prompt_versions WHERE prompt_id = $1 ORDER BY version_number", [promptId])).rows;
    assert.equal(before.length, 10);

    const restored = await alice.api("POST", `/api/prompts/${promptId}/versions/4/restore`, {});
    assert.equal(restored.status, 201);
    const v11 = restored.body.version;
    assert.equal(v11.versionNumber, 11);
    assert.equal(v11.content, "<task>\ncontent of v4\n</task>");
    assert.equal(v11.restoredFromVersionNumber, 4);
    assert.equal(v11.changeNote, "Restored from v4");
    assert.equal(v11.source, "restored");
    assert.equal(v11.isCurrent, true);

    const after = (await db.query("SELECT version_number, content, change_note FROM prompt_versions WHERE prompt_id = $1 AND version_number <= 10 ORDER BY version_number", [promptId])).rows;
    assert.deepEqual(after, before, "v1-v10 are exactly as they were");
    const list = await versionsOf(promptId);
    assert.equal(list.filter((v) => v.isCurrent).length, 1);
    assert.equal(list[0].versionNumber, 11);
  });

  test("restoring the current version, or one that doesn't exist, is refused", async () => {
    const { promptId } = await createPrompt(alice, "Restore refusals");
    await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>2</task>" });
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/versions/2/restore`, {})).status, 409);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/versions/99/restore`, {})).status, 404);
    assert.equal((await versionsOf(promptId)).length, 2);
  });
});

describe("concurrency", () => {
  test("simultaneous saves on one prompt get unique, sequential version numbers", async () => {
    const { promptId } = await createPrompt(alice, "Race");
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        alice.api("POST", `/api/prompts/${promptId}/versions`, { content: `<task>\nconcurrent ${i}\n</task>` })
      )
    );
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.status)));
    const numbers = (await versionsOf(promptId)).map((v) => v.versionNumber).sort((a, b) => a - b);
    assert.deepEqual(numbers, Array.from({ length: N + 1 }, (_, i) => i + 1));
    // each version's parent is the one before it: no forks in the chain
    const { rows } = await db.query(
      `SELECT v.version_number, p.version_number AS parent_number
       FROM prompt_versions v LEFT JOIN prompt_versions p ON p.id = v.parent_version_id
       WHERE v.prompt_id = $1 ORDER BY v.version_number`,
      [promptId]
    );
    for (const r of rows.slice(1)) assert.equal(r.parent_number, r.version_number - 1);
  });
});

describe("renaming", () => {
  test("changes the title without creating a version or touching the content", async () => {
    const { promptId } = await createPrompt(alice, "Original idea");
    const before = (await alice.api("GET", `/api/prompts/${promptId}`)).body;

    const r = await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "  Customer   Refund\nResponse " });
    assert.equal(r.status, 200);
    assert.equal(r.body.prompt.title, "Customer Refund Response");

    const after = (await alice.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(after.prompt.title, "Customer Refund Response");
    assert.equal(after.currentVersion.versionNumber, 1);
    assert.equal(after.currentVersion.content, before.currentVersion.content);
    assert.equal(after.prompt.updatedAt, before.prompt.updatedAt, "a rename isn't a content update");
    assert.equal((await versionsOf(promptId)).length, 1);
  });

  test("validates the title", async () => {
    const { promptId } = await createPrompt(alice, "Validate title");
    assert.equal((await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "   " })).status, 400);
    assert.equal((await alice.api("PATCH", `/api/prompts/${promptId}`, {})).status, 400);
    assert.equal((await alice.api("PATCH", `/api/prompts/${promptId}`, { title: 5 })).status, 400);
    assert.equal((await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "x".repeat(121) })).status, 400);
    assert.equal((await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "x".repeat(120) })).status, 200);
  });

  test("list and detail show the new title", async () => {
    const { promptId } = await createPrompt(alice, "Listed");
    await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "Weekly Sales Analysis" });
    const { body } = await alice.api("GET", "/api/prompts");
    assert.equal(body.prompts.find((p) => p.id === promptId).title, "Weekly Sales Analysis");
  });
});

describe("regenerating from answers", () => {
  test("adds the next version to the same prompt instead of a new one", async () => {
    const { promptId } = await createPrompt(alice, "Regenerate");
    const r = await alice.api("POST", "/api/sessions", {
      originalPrompt: "Regenerate",
      rawAssembled: "<task>regenerated</task>",
      promptId,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.prompt.id, promptId);
    assert.equal(r.body.prompt.versionNumber, 2);
    const v = (await versionsOf(promptId))[0];
    assert.equal(v.source, "regenerated");
  });

  test("a promptId this user can't see is a 404 and leaves nothing behind", async () => {
    const before = (await db.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n;
    const r = await alice.api("POST", "/api/sessions", {
      originalPrompt: "x",
      rawAssembled: "<task>y</task>",
      promptId: "00000000-0000-0000-0000-000000000000",
    });
    assert.equal(r.status, 404);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sessions")).rows[0].n, before, "transaction rolled back");
  });
});
