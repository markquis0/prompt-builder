import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createScratchDb, startApp, signupUser, createPrompt, TEST_ORIGIN } from "./helpers.js";

let db;
let app;
let llm;
let getCritiqueSystemPrompt;
let owner; // Pro
let viewer; // Pro, shared individually
let teamViewer; // Pro, team member
let free; // not Pro

// What the fake model returns, and what it was asked.
let calls;
let respond;

const dims = (overrides = {}) => {
  const base = Object.fromEntries(
    ["task", "audience", "format", "context", "constraints", "example", "success_criteria"].map((d) => [
      d,
      { present: true, score: 2, diagnosis: `${d} is clear.`, fix: "Nothing to fix." },
    ])
  );
  return { ...base, ...overrides };
};
const weak = (score, d = "x") => ({ present: score > 0, score, diagnosis: `diag ${d}`, fix: `fix ${d}` });

before(async () => {
  db = await createScratchDb();
  app = await startApp(db);
  ({ llm } = await import("../src/lib/llm.js"));
  ({ getCritiqueSystemPrompt } = await import("../src/lib/prompts.js"));

  owner = await signupUser(app.base, "Owner");
  viewer = await signupUser(app.base, "Viewer");
  teamViewer = await signupUser(app.base, "Teamie");
  free = await signupUser(app.base, "Free");
  await db.query("UPDATE users SET subscription_status = 'active' WHERE id = ANY($1)", [[owner.id, viewer.id, teamViewer.id]]);
});

after(async () => {
  await app.stop();
  await db.drop();
});

beforeEach(() => {
  calls = [];
  respond = () =>
    JSON.stringify({
      dimensions: dims({ audience: weak(0, "audience"), constraints: weak(1, "constraints") }),
      improvedPrompt: "<task>\nImproved task\n</task>\n\n<audience>\n[target audience]\n</audience>",
    });
  llm.call = async (args) => {
    calls.push(args);
    return respond(args);
  };
});

const versionsOf = async (id) => (await owner.api("GET", `/api/prompts/${id}/versions`)).body.versions;

async function promptAtV3() {
  const { promptId } = await createPrompt(owner, "Brand Voice Writer", "<task>\nv1\n</task>");
  await owner.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv2\n</task>" });
  await owner.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv3\n</task>" });
  return promptId;
}

describe("generating a proposal", () => {
  test("one model call, using the shared critique rubric, on the canonical text — and nothing is saved", async () => {
    const promptId = await promptAtV3();
    const r = await owner.api("POST", `/api/prompts/${promptId}/improve`, {});
    assert.equal(r.status, 200);

    assert.equal(calls.length, 1, "grading and rewriting happen in a single call");
    // same rubric as the standalone critique: its definition of grading is a prefix of Improve's system prompt
    const rubric = getCritiqueSystemPrompt().split("Respond with ONLY valid JSON")[0];
    assert.ok(calls[0].system.startsWith(rubric), "Improve reuses the existing critique rubric verbatim");
    assert.ok(calls[0].userMessage.includes("<task>\nv3\n</task>"), "the canonical current text is what's improved");

    assert.equal(r.body.baseVersionNumber, 3);
    assert.equal(r.body.baseIsCurrent, true);
    assert.equal(r.body.unchanged, false);
    assert.equal(r.body.improvedContent, "<task>\nImproved task\n</task>\n\n<audience>\n[target audience]\n</audience>");
    // 7 dimensions: five at 2, one at 1, one at 0 = 11 / 14 — reported as is, not as a percentage
    assert.equal(r.body.critique.score, 11);
    assert.equal(r.body.critique.maxScore, 14);
    assert.equal(r.body.critique.dimensions.audience.fix, "fix audience");

    assert.equal((await versionsOf(promptId)).length, 3, "a suggestion is not a version");
  });

  test("can improve an older version, and says it isn't the current one", async () => {
    const promptId = await promptAtV3();
    const r = await owner.api("POST", `/api/prompts/${promptId}/improve`, { versionNumber: 1 });
    assert.equal(r.status, 200);
    assert.equal(r.body.baseVersionNumber, 1);
    assert.equal(r.body.baseIsCurrent, false);
    assert.ok(calls[0].userMessage.includes("<task>\nv1\n</task>"));
    assert.equal((await owner.api("POST", `/api/prompts/${promptId}/improve`, { versionNumber: 99 })).status, 404);
    assert.equal((await owner.api("POST", `/api/prompts/${promptId}/improve`, { versionNumber: "abc" })).status, 400);
  });

  test("flags a no-op suggestion", async () => {
    const promptId = await promptAtV3();
    respond = () => JSON.stringify({ dimensions: dims(), improvedPrompt: "<task>\nv3\n</task>" });
    const r = await owner.api("POST", `/api/prompts/${promptId}/improve`, {});
    assert.equal(r.body.unchanged, true);
  });
});

describe("accepting an improvement", () => {
  test("creates v4 as an immutable new version, source 'improved', parent v3, v3 untouched", async () => {
    const promptId = await promptAtV3();
    const proposal = (await owner.api("POST", `/api/prompts/${promptId}/improve`, {})).body;
    const save = await owner.api("POST", `/api/prompts/${promptId}/versions`, {
      content: proposal.improvedContent,
      source: "improved",
      baseVersionNumber: proposal.baseVersionNumber,
    });
    assert.equal(save.status, 201);
    assert.equal(save.body.version.versionNumber, 4);
    assert.equal(save.body.version.source, "improved");
    assert.equal(save.body.version.changeNote, "Improved with PromptMe suggestions");
    assert.equal(save.body.version.isCurrent, true);
    assert.equal(save.body.version.promptObject.task, "Improved task", "model tabs re-derive from the saved text");

    const list = await versionsOf(promptId);
    const byNumber = Object.fromEntries(list.map((v) => [v.versionNumber, v]));
    assert.equal(byNumber[4].parentVersionId, byNumber[3].id);
    const v3 = (await owner.api("GET", `/api/prompts/${promptId}/versions/3`)).body.version;
    assert.equal(v3.content, "<task>\nv3\n</task>");
    await assert.rejects(db.query("UPDATE prompt_versions SET content = 'x' WHERE id = $1", [byNumber[4].id]), /immutable/);
  });

  test("an edited suggestion is saved as the user changed it, still marked 'improved'", async () => {
    const promptId = await promptAtV3();
    const save = await owner.api("POST", `/api/prompts/${promptId}/versions`, {
      content: "<task>\nImproved and then edited by me\n</task>",
      source: "improved",
      baseVersionNumber: 3,
      changeNote: "Took the suggestion, tweaked it",
    });
    assert.equal(save.status, 201);
    assert.equal(save.body.version.source, "improved");
    assert.equal(save.body.version.changeNote, "Took the suggestion, tweaked it");
    assert.equal(save.body.version.content, "<task>\nImproved and then edited by me\n</task>");
  });

  test("refuses a suggestion made from a version the prompt has moved past", async () => {
    const promptId = await promptAtV3();
    const proposal = (await owner.api("POST", `/api/prompts/${promptId}/improve`, {})).body;
    await owner.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv4 saved elsewhere\n</task>" });
    const save = await owner.api("POST", `/api/prompts/${promptId}/versions`, {
      content: proposal.improvedContent,
      source: "improved",
      baseVersionNumber: proposal.baseVersionNumber,
    });
    assert.equal(save.status, 409);
    assert.match(save.body.error, /changed since/);
    assert.equal((await versionsOf(promptId)).length, 4);
  });

  test("only 'improved' and 'edited' are accepted as sources over the API", async () => {
    const promptId = await promptAtV3();
    const r = await owner.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nx\n</task>", source: "restored" });
    assert.equal(r.status, 201);
    assert.equal(r.body.version.source, "edited");
  });
});

describe("who can improve", () => {
  test("a direct viewer cannot, and no model call is made", async () => {
    const promptId = await promptAtV3();
    await owner.api("POST", `/api/prompts/${promptId}/shares`, { email: "viewer@example.com" });
    assert.equal((await viewer.api("POST", `/api/prompts/${promptId}/improve`, {})).status, 403);
    assert.equal(calls.length, 0);
  });

  test("a team viewer cannot either", async () => {
    const promptId = await promptAtV3();
    const team = (await owner.api("POST", "/api/teams", { name: "Improvers" })).body.team;
    await owner.api("POST", `/api/teams/${team.id}/members`, { email: "teamie@example.com" });
    await owner.api("POST", `/api/teams/${team.id}/prompts`, { promptId });
    assert.equal((await teamViewer.api("POST", `/api/prompts/${promptId}/improve`, {})).status, 403);
    assert.equal(calls.length, 0);

    // ...but they can build on it, and improve their own copy
    const copy = (await teamViewer.api("POST", `/api/prompts/${promptId}/copy`, {})).body.prompt.id;
    const mine = await teamViewer.api("POST", `/api/prompts/${copy}/improve`, {});
    assert.equal(mine.status, 200);
    assert.equal(calls.length, 1);
  });

  test("a user with no access gets a 404; anonymous gets a 401", async () => {
    const promptId = await promptAtV3();
    assert.equal((await free.api("POST", `/api/prompts/${promptId}/improve`, {})).status, 403, "free user: paid check comes first");
    const outsiderPro = await signupUser(app.base, "Outsider");
    await db.query("UPDATE users SET subscription_status = 'trialing' WHERE id = $1", [outsiderPro.id]);
    assert.equal((await outsiderPro.api("POST", `/api/prompts/${promptId}/improve`, {})).status, 404);
    const anon = await fetch(`${app.base}/api/prompts/${promptId}/improve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN },
      body: "{}",
    });
    assert.equal(anon.status, 401);
    assert.equal(calls.length, 0);
  });

  test("Improve is a Pro feature, like the existing critique", async () => {
    const { promptId } = await createPrompt(free, "Free user's prompt");
    const r = await free.api("POST", `/api/prompts/${promptId}/improve`, {});
    assert.equal(r.status, 403);
    assert.match(r.body.error, /Pro/);
    assert.equal(calls.length, 0);
  });
});

describe("bad model responses are never offered to the user", () => {
  const cases = {
    "not JSON": () => "Sure! Here's a better prompt.",
    "no rewrite": () => JSON.stringify({ dimensions: dims() }),
    "rewrite has no <task>": () => JSON.stringify({ dimensions: dims(), improvedPrompt: "just some text" }),
    "empty rewrite": () => JSON.stringify({ dimensions: dims(), improvedPrompt: "   " }),
    "malformed grading": () => JSON.stringify({ dimensions: { task: { score: 5 } }, improvedPrompt: "<task>x</task>" }),
  };
  for (const [name, fn] of Object.entries(cases)) {
    test(name, async () => {
      const promptId = await promptAtV3();
      respond = fn;
      const r = await owner.api("POST", `/api/prompts/${promptId}/improve`, {});
      assert.equal(r.status, 502);
      assert.equal((await versionsOf(promptId)).length, 3);
    });
  }

  test("tolerates the model wrapping its JSON in a code fence", async () => {
    const promptId = await promptAtV3();
    respond = () => "```json\n" + JSON.stringify({ dimensions: dims(), improvedPrompt: "<task>\nfenced\n</task>" }) + "\n```";
    assert.equal((await owner.api("POST", `/api/prompts/${promptId}/improve`, {})).status, 200);
  });
});
