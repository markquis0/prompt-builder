import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createScratchDb, startApp, signupUser, createPrompt, TEST_ORIGIN } from "./helpers.js";

let db;
let app;
let alice; // owns the prompts
let bob; // gets shares
let carol; // never gets anything
let dave; // for deletion tests

before(async () => {
  db = await createScratchDb();
  app = await startApp(db);
  alice = await signupUser(app.base, "Alice");
  bob = await signupUser(app.base, "Bob");
  carol = await signupUser(app.base, "Carol");
  dave = await signupUser(app.base, "Dave");
});

after(async () => {
  await app.stop();
  await db.drop();
});

// Every endpoint a user could use to read or change a prompt.
const writes = (id) => [
  ["POST", `/api/prompts/${id}/versions`, { content: "<task>hijack</task>" }],
  ["POST", `/api/prompts/${id}/versions/1/restore`, {}],
  ["PATCH", `/api/prompts/${id}`, { title: "hijacked" }],
  ["GET", `/api/prompts/${id}/shares`],
  ["POST", `/api/prompts/${id}/shares`, { email: "carol@example.com" }],
];
const reads = (id) => [
  ["GET", `/api/prompts/${id}`],
  ["GET", `/api/prompts/${id}/versions`],
  ["GET", `/api/prompts/${id}/versions/1`],
];

async function statuses(user, calls) {
  const out = [];
  for (const [m, path, body] of calls) out.push((await user.api(m, path, body)).status);
  return out;
}

describe("owner", () => {
  test("can read, create versions, restore, rename and manage sharing", async () => {
    const { promptId } = await createPrompt(alice, "Owner abilities");
    assert.deepEqual(await statuses(alice, reads(promptId)), [200, 200, 200]);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>2</task>" })).status, 201);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/versions/1/restore`, {})).status, 201);
    assert.equal((await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "Mine" })).status, 200);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}/shares`)).status, 200);
    const detail = (await alice.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(detail.access.role, "owner");
  });
});

describe("a user with no access", () => {
  test("gets 404 everywhere, indistinguishable from a prompt that doesn't exist", async () => {
    const { promptId } = await createPrompt(alice, "Private to Alice");
    const everything = [...reads(promptId), ...writes(promptId), ["POST", `/api/prompts/${promptId}/copy`, {}]];
    const real = await statuses(carol, everything);
    const fake = await statuses(carol, everything.map(([m, p, b]) => [m, p.replace(promptId, "00000000-0000-4000-8000-000000000000"), b]));
    assert.ok(real.every((s) => s === 404), `expected all 404, got ${real}`);
    assert.deepEqual(real, fake);
  });

  test("a version id or number alone grants nothing", async () => {
    const { promptId } = await createPrompt(alice, "Guessable numbers");
    // Carol's own prompt has a v1 too — asking for Alice's prompt id + that number must not work.
    const { promptId: carolsPrompt } = await createPrompt(carol, "Carol's own");
    assert.equal((await carol.api("GET", `/api/prompts/${promptId}/versions/1`)).status, 404);
    assert.equal((await carol.api("GET", `/api/prompts/${carolsPrompt}/versions/1`)).status, 200);
  });

  test("anonymous requests are rejected", async () => {
    const { promptId } = await createPrompt(alice, "Not for anonymous");
    for (const path of [`/api/prompts/${promptId}`, "/api/prompts", "/api/prompts/shared", `/api/prompts/${promptId}/shares`]) {
      const res = await fetch(`${app.base}${path}`, { headers: { Origin: TEST_ORIGIN } });
      assert.equal(res.status, 401, path);
    }
  });
});

describe("sharing", () => {
  let promptId;
  let shareId;

  before(async () => {
    ({ promptId } = await createPrompt(alice, "Marketing Campaign Brief"));
    await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv2\n</task>", changeNote: "second" });
    await alice.api("PATCH", `/api/prompts/${promptId}`, { title: "Q4 Marketing Campaign Brief" });
  });

  test("not shared yet: Bob can't see it", async () => {
    assert.equal((await bob.api("GET", `/api/prompts/${promptId}`)).status, 404);
    assert.equal((await bob.api("GET", "/api/prompts/shared")).body.prompts.length, 0);
  });

  test("the owner shares by email (any letter case); the share is listed", async () => {
    const r = await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "  BOB@Example.com " });
    assert.equal(r.status, 201);
    assert.equal(r.body.share.permission, "viewer");
    assert.equal(r.body.share.user.email, "bob@example.com");
    shareId = r.body.share.id;
    const list = (await alice.api("GET", `/api/prompts/${promptId}/shares`)).body.shares;
    assert.deepEqual(list.map((s) => s.user.email), ["bob@example.com"]);
  });

  test("share errors are friendly and specific", async () => {
    const unknown = await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "nobody@example.com" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, "No PromptMe account exists for that email yet.");
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "alice@example.com" })).status, 400);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "bob@example.com" })).status, 409);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "not-an-email" })).status, 400);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/shares`, {})).status, 400);
  });

  test("Bob sees it under Shared With Me, with who shared it", async () => {
    const { prompts } = (await bob.api("GET", "/api/prompts/shared")).body;
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].title, "Q4 Marketing Campaign Brief");
    assert.equal(prompts[0].currentVersionNumber, 2);
    assert.equal(prompts[0].sharedBy.name, "Alice Tester");
    // ...and it doesn't leak into his own prompt list
    assert.equal((await bob.api("GET", "/api/prompts")).body.prompts.length, 0);
  });

  test("Bob can read the current version, the history, and any older version", async () => {
    const detail = (await bob.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(detail.access.role, "viewer");
    assert.equal(detail.access.owner.name, "Alice Tester");
    assert.equal(detail.currentVersion.versionNumber, 2);
    assert.equal(detail.currentVersion.content, "<task>\nv2\n</task>");
    assert.equal((await bob.api("GET", `/api/prompts/${promptId}/versions`)).body.versions.length, 2);
    assert.equal((await bob.api("GET", `/api/prompts/${promptId}/versions/1`)).body.version.versionNumber, 1);
  });

  test("a viewer never receives the owner's generation inputs", async () => {
    const asViewer = (await bob.api("GET", `/api/prompts/${promptId}/versions/1`)).body.version;
    for (const key of ["originalPrompt", "qaPairs", "supportingContext", "sessionId"]) {
      assert.ok(!(key in asViewer), `viewer response must not include ${key}`);
    }
    const asOwner = (await alice.api("GET", `/api/prompts/${promptId}/versions/1`)).body.version;
    assert.equal(asOwner.supportingContext, "internal policy notes");
    assert.ok(asOwner.qaPairs.length > 0);
  });

  test("a viewer cannot change anything about the owner's prompt", async () => {
    const denied = await statuses(bob, writes(promptId));
    assert.ok(denied.every((s) => s === 403), `expected all 403, got ${denied}`);
    // and nothing changed
    const detail = (await alice.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(detail.currentVersion.versionNumber, 2);
    assert.equal(detail.prompt.title, "Q4 Marketing Campaign Brief");
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}/shares`)).body.shares.length, 1);
  });

  test("when the owner saves v3, Bob sees it with no re-share", async () => {
    await alice.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv3\n</task>" });
    const detail = (await bob.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(detail.currentVersion.versionNumber, 3);
    assert.equal((await bob.api("GET", "/api/prompts/shared")).body.prompts[0].currentVersionNumber, 3);
  });

  test("Bob's copy is a separate prompt he owns, independent of the original", async () => {
    const copy = await bob.api("POST", `/api/prompts/${promptId}/copy`, {});
    assert.equal(copy.status, 201);
    assert.equal(copy.body.prompt.title, "Q4 Marketing Campaign Brief");
    assert.equal(copy.body.prompt.versionNumber, 1);
    const copyId = copy.body.prompt.id;
    assert.notEqual(copyId, promptId);

    const mine = (await bob.api("GET", "/api/prompts")).body.prompts;
    assert.deepEqual(mine.map((p) => p.id), [copyId]);

    // content is v3 (current at copy time), provenance recorded, Alice's inputs not carried over
    const v1 = (await bob.api("GET", `/api/prompts/${copyId}/versions/1`)).body.version;
    assert.equal(v1.content, "<task>\nv3\n</task>");
    assert.equal(v1.source, "copied");
    assert.equal(v1.qaPairs, null);
    assert.equal(v1.supportingContext, null);
    assert.equal(v1.originalPrompt, "Q4 Marketing Campaign Brief");
    const { rows } = await db.query("SELECT copied_from_prompt_id FROM prompts WHERE id = $1", [copyId]);
    assert.equal(rows[0].copied_from_prompt_id, promptId);

    // Bob edits his copy freely...
    const edit = await bob.api("POST", `/api/prompts/${copyId}/versions`, { content: "<task>\nBob's take\n</task>" });
    assert.equal(edit.status, 201);
    assert.equal((await bob.api("PATCH", `/api/prompts/${copyId}`, { title: "Bob's Brief" })).status, 200);
    // ...and Alice's original is untouched
    const original = (await alice.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(original.prompt.title, "Q4 Marketing Campaign Brief");
    assert.equal(original.currentVersion.content, "<task>\nv3\n</task>");
  });

  test("copying a specific older version works for a viewer", async () => {
    const copy = await bob.api("POST", `/api/prompts/${promptId}/copy`, { versionNumber: 1 });
    assert.equal(copy.status, 201);
    const v1 = (await bob.api("GET", `/api/prompts/${copy.body.prompt.id}/versions/1`)).body.version;
    assert.equal(v1.content, "<task>\nMarketing Campaign Brief\n</task>");
    assert.equal((await bob.api("POST", `/api/prompts/${promptId}/copy`, { versionNumber: 99 })).status, 404);
  });

  test("an owner can't remove shares belonging to a different prompt", async () => {
    const { promptId: other } = await createPrompt(alice, "A different prompt");
    assert.equal((await alice.api("DELETE", `/api/prompts/${other}/shares/${shareId}`)).status, 404);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}/shares`)).body.shares.length, 1);
    // and another user can't touch it at all
    assert.equal((await carol.api("DELETE", `/api/prompts/${promptId}/shares/${shareId}`)).status, 404);
    assert.equal((await bob.api("DELETE", `/api/prompts/${promptId}/shares/${shareId}`)).status, 403);
  });

  test("revoking removes Bob's access everywhere but leaves his own copies alone", async () => {
    const mineBefore = (await bob.api("GET", "/api/prompts")).body.prompts.length;
    const r = await alice.api("DELETE", `/api/prompts/${promptId}/shares/${shareId}`);
    assert.equal(r.status, 200);

    assert.equal((await bob.api("GET", "/api/prompts/shared")).body.prompts.length, 0);
    assert.deepEqual(await statuses(bob, reads(promptId)), [404, 404, 404]);
    assert.equal((await bob.api("POST", `/api/prompts/${promptId}/copy`, {})).status, 404);
    assert.equal((await bob.api("GET", `/api/prompts/${promptId}/versions/2`)).status, 404);

    const mineAfter = (await bob.api("GET", "/api/prompts")).body.prompts;
    assert.equal(mineAfter.length, mineBefore);
    for (const p of mineAfter) assert.equal((await bob.api("GET", `/api/prompts/${p.id}`)).status, 200);
  });

  test("removing the same share twice is a 404, and re-sharing after revoke works", async () => {
    assert.equal((await alice.api("DELETE", `/api/prompts/${promptId}/shares/${shareId}`)).status, 404);
    assert.equal((await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "bob@example.com" })).status, 201);
  });
});

describe("deleting accounts and prompts", () => {
  test("deleting a recipient removes their shares; the prompt is unaffected", async () => {
    const { promptId } = await createPrompt(alice, "Shared with Dave");
    await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "dave@example.com" });
    await db.query("DELETE FROM users WHERE id = $1", [dave.id]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM prompt_shares WHERE prompt_id = $1", [promptId])).rows[0].n, 0);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).status, 200);
  });

  test("deleting a prompt removes its shares and versions", async () => {
    const { promptId } = await createPrompt(alice, "Soon deleted");
    await alice.api("POST", `/api/prompts/${promptId}/shares`, { email: "carol@example.com" });
    await db.query("DELETE FROM prompts WHERE id = $1", [promptId]);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM prompt_shares WHERE prompt_id = $1", [promptId])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM prompt_versions WHERE prompt_id = $1", [promptId])).rows[0].n, 0);
    assert.equal((await carol.api("GET", "/api/prompts/shared")).body.prompts.every((p) => p.id !== promptId), true);
  });

  test("deleting an owner removes their prompts, versions and shares — but not a copy someone else made", async () => {
    const erin = await signupUser(app.base, "Erin");
    const { promptId } = await createPrompt(erin, "Erin's prompt");
    await erin.api("POST", `/api/prompts/${promptId}/shares`, { email: "carol@example.com" });
    const copy = await carol.api("POST", `/api/prompts/${promptId}/copy`, {});
    assert.equal(copy.status, 201);

    await db.query("DELETE FROM users WHERE id = $1", [erin.id]);

    assert.equal((await db.query("SELECT count(*)::int AS n FROM prompts WHERE id = $1", [promptId])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM prompt_versions WHERE prompt_id = $1", [promptId])).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM prompt_shares WHERE prompt_id = $1", [promptId])).rows[0].n, 0);
    // Carol's copy survives, with its provenance link cleared rather than dangling
    const { rows } = await db.query("SELECT copied_from_prompt_id, copied_from_version_id FROM prompts WHERE id = $1", [copy.body.prompt.id]);
    assert.deepEqual(rows[0], { copied_from_prompt_id: null, copied_from_version_id: null });
    assert.equal((await carol.api("GET", `/api/prompts/${copy.body.prompt.id}`)).status, 200);
  });
});
