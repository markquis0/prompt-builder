import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createScratchDb, startApp, signupUser, createPrompt } from "./helpers.js";

let db;
let app;
let manager; // owns teams and prompts
let alice; // team member
let bob; // team member / second path tests
let carol; // never in any team

before(async () => {
  db = await createScratchDb();
  app = await startApp(db);
  manager = await signupUser(app.base, "Manager");
  alice = await signupUser(app.base, "Alice");
  bob = await signupUser(app.base, "Bob");
  carol = await signupUser(app.base, "Carol");
});

after(async () => {
  await app.stop();
  await db.drop();
});

const count = async (sql, params) => (await db.query(sql, params)).rows[0].n;

async function newTeam(owner, name, members = []) {
  const r = await owner.api("POST", "/api/teams", { name });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  for (const m of members) {
    const a = await owner.api("POST", `/api/teams/${r.body.team.id}/members`, { email: m.email });
    assert.equal(a.status, 201, JSON.stringify(a.body));
  }
  return r.body.team.id;
}

describe("creating and managing a team", () => {
  test("the creator becomes the one owner, and sees the team", async () => {
    const r = await manager.api("POST", "/api/teams", { name: "  Acme   Marketing " });
    assert.equal(r.status, 201);
    assert.equal(r.body.team.name, "Acme Marketing");
    assert.equal(r.body.team.role, "owner");

    const list = (await manager.api("GET", "/api/teams")).body.teams;
    const t = list.find((x) => x.id === r.body.team.id);
    assert.deepEqual([t.role, t.memberCount, t.promptCount, t.ownerName], ["owner", 1, 0, "Manager Tester"]);
    assert.equal(await count("SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND role = 'owner'", [t.id]), 1);
  });

  test("validates the name", async () => {
    assert.equal((await manager.api("POST", "/api/teams", { name: "   " })).status, 400);
    assert.equal((await manager.api("POST", "/api/teams", {})).status, 400);
    assert.equal((await manager.api("POST", "/api/teams", { name: "x".repeat(81) })).status, 400);
  });

  test("only the owner can rename or delete; a member and a stranger cannot", async () => {
    const id = await newTeam(manager, "Rename me", [alice]);
    assert.equal((await alice.api("PATCH", `/api/teams/${id}`, { name: "hijack" })).status, 403);
    assert.equal((await alice.api("DELETE", `/api/teams/${id}`)).status, 403);
    assert.equal((await carol.api("PATCH", `/api/teams/${id}`, { name: "hijack" })).status, 404);
    assert.equal((await carol.api("DELETE", `/api/teams/${id}`)).status, 404);
    const r = await manager.api("PATCH", `/api/teams/${id}`, { name: "Renamed" });
    assert.equal(r.status, 200);
    assert.equal(r.body.team.name, "Renamed");
    // a stranger can't even see it exists
    assert.equal((await carol.api("GET", `/api/teams/${id}`)).status, 404);
    assert.equal((await carol.api("GET", "/api/teams")).body.teams.some((t) => t.id === id), false);
  });

  test("renaming a team leaves its members and prompts alone", async () => {
    const id = await newTeam(manager, "Stable", [alice]);
    const { promptId } = await createPrompt(manager, "Stays put");
    await manager.api("POST", `/api/teams/${id}/prompts`, { promptId });
    await manager.api("PATCH", `/api/teams/${id}`, { name: "Stable (renamed)" });
    assert.equal((await manager.api("GET", `/api/teams/${id}/members`)).body.members.length, 2);
    assert.equal((await manager.api("GET", `/api/teams/${id}/prompts`)).body.prompts.length, 1);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).status, 200);
  });
});

describe("membership", () => {
  let teamId;
  before(async () => {
    teamId = await newTeam(manager, "Members team");
  });

  test("the owner adds an existing user (any letter case); duplicates are refused", async () => {
    const r = await manager.api("POST", `/api/teams/${teamId}/members`, { email: " ALICE@Example.com " });
    assert.equal(r.status, 201);
    assert.equal(r.body.member.role, "member");
    assert.equal((await manager.api("POST", `/api/teams/${teamId}/members`, { email: "alice@example.com" })).status, 409);
    assert.equal((await manager.api("POST", `/api/teams/${teamId}/members`, { email: "manager@example.com" })).status, 409);
    assert.equal(await count("SELECT count(*)::int AS n FROM team_members WHERE team_id = $1 AND user_id = $2", [teamId, alice.id]), 1);
  });

  test("friendly errors for unknown or malformed emails", async () => {
    const unknown = await manager.api("POST", `/api/teams/${teamId}/members`, { email: "nobody@example.com" });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error, "No PromptMe account exists for that email yet.");
    assert.equal((await manager.api("POST", `/api/teams/${teamId}/members`, { email: "nope" })).status, 400);
  });

  test("a member sees the team and its roster (names only); a non-owner cannot add or remove people", async () => {
    const team = (await alice.api("GET", "/api/teams")).body.teams.find((t) => t.id === teamId);
    assert.equal(team.role, "member");
    const asMember = (await alice.api("GET", `/api/teams/${teamId}/members`)).body.members;
    assert.deepEqual(asMember.map((m) => m.role), ["owner", "member"]);
    assert.ok(asMember.every((m) => !("email" in m.user)), "members don't get each other's emails");
    const asOwner = (await manager.api("GET", `/api/teams/${teamId}/members`)).body.members;
    assert.ok(asOwner.every((m) => typeof m.user.email === "string"));

    assert.equal((await alice.api("POST", `/api/teams/${teamId}/members`, { email: "bob@example.com" })).status, 403);
    const owner = asOwner.find((m) => m.role === "owner");
    assert.equal((await alice.api("DELETE", `/api/teams/${teamId}/members/${owner.id}`)).status, 403);
    assert.equal((await carol.api("GET", `/api/teams/${teamId}/members`)).status, 404);
  });

  test("the owner can't be removed, and can't leave", async () => {
    const owner = (await manager.api("GET", `/api/teams/${teamId}/members`)).body.members.find((m) => m.role === "owner");
    assert.equal((await manager.api("DELETE", `/api/teams/${teamId}/members/${owner.id}`)).status, 404);
    const leave = await manager.api("POST", `/api/teams/${teamId}/leave`);
    assert.equal(leave.status, 400);
    assert.equal((await manager.api("GET", `/api/teams/${teamId}`)).status, 200);
  });

  test("the schema itself refuses a second owner", async () => {
    await assert.rejects(
      db.query("INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, 'owner')", [teamId, bob.id]),
      /unique/i
    );
  });

  test("a member can leave; removal can't cross teams", async () => {
    const other = await newTeam(manager, "Other team", [bob]);
    const bobsMembership = (await manager.api("GET", `/api/teams/${other}/members`)).body.members.find((m) => m.user.email === "bob@example.com");
    // using another team's membership id against this team removes nothing
    assert.equal((await manager.api("DELETE", `/api/teams/${teamId}/members/${bobsMembership.id}`)).status, 404);
    assert.equal((await bob.api("POST", `/api/teams/${other}/leave`)).status, 200);
    assert.equal((await bob.api("GET", `/api/teams/${other}`)).status, 404);
  });

  test("anonymous requests are rejected", async () => {
    const res = await fetch(`${app.base}/api/teams`, { headers: { Origin: "http://localhost:5173" } });
    assert.equal(res.status, 401);
  });
});

describe("publishing a prompt to a team", () => {
  let teamId;
  let promptId;
  before(async () => {
    teamId = await newTeam(manager, "Publishing team", [alice]);
    ({ promptId } = await createPrompt(manager, "Brand Voice Writer"));
  });

  test("before publishing, nobody else can see the prompt", async () => {
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).status, 404);
  });

  test("only a team owner can publish, and only prompts they own", async () => {
    assert.equal((await alice.api("POST", `/api/teams/${teamId}/prompts`, { promptId })).status, 403);
    assert.equal((await carol.api("POST", `/api/teams/${teamId}/prompts`, { promptId })).status, 404);
    // a prompt someone else owns can't be published by the team owner
    const { promptId: alices } = await createPrompt(alice, "Alice's own");
    assert.equal((await manager.api("POST", `/api/teams/${teamId}/prompts`, { promptId: alices })).status, 404);
    assert.equal((await manager.api("POST", `/api/teams/${teamId}/prompts`, { promptId: "not-a-uuid" })).status, 404);
  });

  test("a published prompt is visible to members and to no one else; duplicates refused", async () => {
    const r = await manager.api("POST", `/api/teams/${teamId}/prompts`, { promptId });
    assert.equal(r.status, 201);
    assert.equal((await manager.api("POST", `/api/teams/${teamId}/prompts`, { promptId })).status, 409);

    const detail = await alice.api("GET", `/api/prompts/${promptId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.access.role, "viewer");
    assert.deepEqual(detail.body.access.via, { direct: false, team: true });
    assert.deepEqual(detail.body.teams.map((t) => t.name), ["Publishing team"]);
    assert.equal((await carol.api("GET", `/api/prompts/${promptId}`)).status, 404);

    const listed = (await alice.api("GET", `/api/teams/${teamId}/prompts`)).body.prompts;
    assert.deepEqual(listed.map((p) => [p.title, p.currentVersionNumber, p.ownerName]), [["Brand Voice Writer", 1, "Manager Tester"]]);
    assert.equal((await carol.api("GET", `/api/teams/${teamId}/prompts`)).status, 404);
  });

  test("members automatically see the owner's new versions — no republishing", async () => {
    await manager.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv2\n</task>" });
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).body.currentVersion.versionNumber, 2);
    assert.equal((await alice.api("GET", `/api/teams/${teamId}/prompts`)).body.prompts[0].currentVersionNumber, 2);
    await manager.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv3\n</task>" });
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).body.currentVersion.versionNumber, 3);
  });

  test("a team member can read history and versions but never receives the owner's inputs", async () => {
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}/versions`)).body.versions.length, 3);
    const v1 = (await alice.api("GET", `/api/prompts/${promptId}/versions/1`)).body.version;
    for (const key of ["originalPrompt", "qaPairs", "supportingContext", "sessionId"]) assert.ok(!(key in v1), key);
  });

  test("a team member is strictly read-only on the canonical prompt", async () => {
    const calls = [
      ["POST", `/api/prompts/${promptId}/versions`, { content: "<task>hijack</task>" }],
      ["POST", `/api/prompts/${promptId}/versions/1/restore`, {}],
      ["PATCH", `/api/prompts/${promptId}`, { title: "hijacked" }],
      ["GET", `/api/prompts/${promptId}/shares`],
      ["POST", `/api/prompts/${promptId}/shares`, { email: "carol@example.com" }],
      ["DELETE", `/api/teams/${teamId}/prompts/${promptId}`],
    ];
    for (const [m, path, body] of calls) {
      assert.equal((await alice.api(m, path, body)).status, 403, `${m} ${path}`);
    }
    const detail = (await manager.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(detail.currentVersion.versionNumber, 3);
    assert.equal(detail.prompt.title, "Brand Voice Writer");
    assert.equal((await manager.api("GET", `/api/teams/${teamId}/prompts`)).body.prompts.length, 1);
  });

  test("Build on this gives the member an independent prompt that outlives their access", async () => {
    const copy = await alice.api("POST", `/api/prompts/${promptId}/copy`, {});
    assert.equal(copy.status, 201);
    const copyId = copy.body.prompt.id;
    assert.equal(copy.body.prompt.versionNumber, 1);

    const v1 = (await alice.api("GET", `/api/prompts/${copyId}/versions/1`)).body.version;
    assert.equal(v1.content, "<task>\nv3\n</task>");
    assert.equal(v1.source, "copied");
    assert.equal((await db.query("SELECT copied_from_prompt_id FROM prompts WHERE id = $1", [copyId])).rows[0].copied_from_prompt_id, promptId);

    // Alice edits her copy; the canonical prompt doesn't move
    assert.equal((await alice.api("POST", `/api/prompts/${copyId}/versions`, { content: "<task>\nAlice's take\n</task>" })).status, 201);
    assert.equal((await manager.api("GET", `/api/prompts/${promptId}`)).body.currentVersion.content, "<task>\nv3\n</task>");
    // and the owner keeps shipping versions without touching her copy
    await manager.api("POST", `/api/prompts/${promptId}/versions`, { content: "<task>\nv4\n</task>" });
    assert.equal((await alice.api("GET", `/api/prompts/${copyId}`)).body.currentVersion.content, "<task>\nAlice's take\n</task>");

    // "built on N times" is real, stored data
    const mine = (await manager.api("GET", "/api/prompts")).body.prompts.find((p) => p.id === promptId);
    assert.equal(mine.buildCount, 1);
    assert.deepEqual(mine.teamNames, ["Publishing team"]);

    // remove Alice from the team: she loses the team's prompt, keeps her copy
    const member = (await manager.api("GET", `/api/teams/${teamId}/members`)).body.members.find((m) => m.user.email === "alice@example.com");
    assert.equal((await manager.api("DELETE", `/api/teams/${teamId}/members/${member.id}`)).status, 200);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).status, 404);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}/versions/1`)).status, 404);
    assert.equal((await alice.api("GET", `/api/teams/${teamId}/prompts`)).status, 404);
    assert.equal((await alice.api("GET", `/api/prompts/${copyId}`)).status, 200);
  });

  test("removing the prompt from the team removes member access but not the prompt", async () => {
    const t2 = await newTeam(manager, "Remove-prompt team", [bob]);
    const { promptId: p2 } = await createPrompt(manager, "Removable");
    await manager.api("POST", `/api/teams/${t2}/prompts`, { promptId: p2 });
    assert.equal((await bob.api("GET", `/api/prompts/${p2}`)).status, 200);
    assert.equal((await manager.api("DELETE", `/api/teams/${t2}/prompts/${p2}`)).status, 200);
    assert.equal((await bob.api("GET", `/api/prompts/${p2}`)).status, 404);
    assert.equal((await manager.api("GET", `/api/prompts/${p2}`)).status, 200);
    assert.equal((await manager.api("DELETE", `/api/teams/${t2}/prompts/${p2}`)).status, 404);
  });
});

describe("effective access across several routes", () => {
  // Bob reaches one prompt by an individual share AND by a team. Access must
  // last until the *last* route is gone, in either order.
  async function setup(label) {
    const teamId = await newTeam(manager, `Paths ${label}`, [bob]);
    const { promptId } = await createPrompt(manager, `Paths prompt ${label}`);
    await manager.api("POST", `/api/teams/${teamId}/prompts`, { promptId });
    const share = await manager.api("POST", `/api/prompts/${promptId}/shares`, { email: "bob@example.com" });
    assert.equal(share.status, 201);
    const member = (await manager.api("GET", `/api/teams/${teamId}/members`)).body.members.find((m) => m.user.email === "bob@example.com");
    return { teamId, promptId, shareId: share.body.share.id, membershipId: member.id };
  }
  const canRead = async (promptId) => (await bob.api("GET", `/api/prompts/${promptId}`)).status === 200;

  test("both routes at once is simply viewer access", async () => {
    const { promptId } = await setup("both");
    const detail = (await bob.api("GET", `/api/prompts/${promptId}`)).body;
    assert.equal(detail.access.role, "viewer");
    assert.deepEqual(detail.access.via, { direct: true, team: true });
  });

  test("remove the direct share first: still has access via the team; then remove the team: gone", async () => {
    const { teamId, promptId, shareId, membershipId } = await setup("a");
    await manager.api("DELETE", `/api/prompts/${promptId}/shares/${shareId}`);
    assert.equal(await canRead(promptId), true);
    assert.deepEqual((await bob.api("GET", `/api/prompts/${promptId}`)).body.access.via, { direct: false, team: true });
    await manager.api("DELETE", `/api/teams/${teamId}/members/${membershipId}`);
    assert.equal(await canRead(promptId), false);
  });

  test("remove the team membership first: still has access via the direct share; then remove it: gone", async () => {
    const { teamId, promptId, shareId, membershipId } = await setup("b");
    await manager.api("DELETE", `/api/teams/${teamId}/members/${membershipId}`);
    assert.equal(await canRead(promptId), true);
    assert.deepEqual((await bob.api("GET", `/api/prompts/${promptId}`)).body.access.via, { direct: true, team: false });
    await manager.api("DELETE", `/api/prompts/${promptId}/shares/${shareId}`);
    assert.equal(await canRead(promptId), false);
  });

  test("removing the prompt from the team keeps a direct share; deleting the team does too", async () => {
    const { teamId, promptId } = await setup("c");
    await manager.api("DELETE", `/api/teams/${teamId}/prompts/${promptId}`);
    assert.equal(await canRead(promptId), true);
    const { teamId: t2, promptId: p2 } = await setup("d");
    await manager.api("DELETE", `/api/teams/${t2}`);
    assert.equal(await canRead(p2), true);
  });

  test("a prompt in two teams survives losing one", async () => {
    const t1 = await newTeam(manager, "Two-team A", [bob]);
    const t2 = await newTeam(manager, "Two-team B", [bob]);
    const { promptId } = await createPrompt(manager, "In two teams");
    await manager.api("POST", `/api/teams/${t1}/prompts`, { promptId });
    await manager.api("POST", `/api/teams/${t2}/prompts`, { promptId });
    await manager.api("DELETE", `/api/teams/${t1}`);
    assert.equal(await canRead(promptId), true);
    await manager.api("DELETE", `/api/teams/${t2}/prompts/${promptId}`);
    assert.equal(await canRead(promptId), false);
  });

  test("a non-member only sees the teams they themselves belong to on a shared prompt", async () => {
    const t1 = await newTeam(manager, "Visible team", [bob]);
    const t2 = await newTeam(manager, "Hidden team", [alice]);
    const { promptId } = await createPrompt(manager, "Two teams, one viewer");
    await manager.api("POST", `/api/teams/${t1}/prompts`, { promptId });
    await manager.api("POST", `/api/teams/${t2}/prompts`, { promptId });
    assert.deepEqual((await bob.api("GET", `/api/prompts/${promptId}`)).body.teams.map((t) => t.name), ["Visible team"]);
  });
});

describe("deleting teams and accounts", () => {
  test("deleting a team removes its memberships and publications but never the prompts", async () => {
    const teamId = await newTeam(manager, "Doomed team", [alice, bob]);
    const { promptId } = await createPrompt(manager, "Survivor");
    await manager.api("POST", `/api/teams/${teamId}/prompts`, { promptId });

    assert.equal((await manager.api("DELETE", `/api/teams/${teamId}`)).status, 200);

    assert.equal(await count("SELECT count(*)::int AS n FROM team_members WHERE team_id = $1", [teamId]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM team_prompts WHERE team_id = $1", [teamId]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM prompts WHERE id = $1", [promptId]), 1);
    assert.equal((await manager.api("GET", `/api/prompts/${promptId}`)).status, 200);
    assert.equal((await alice.api("GET", `/api/prompts/${promptId}`)).status, 404);
    assert.equal((await alice.api("GET", `/api/teams/${teamId}`)).status, 404);
  });

  test("deleting a member's account removes only their membership", async () => {
    const dave = await signupUser(app.base, "Dave");
    const teamId = await newTeam(manager, "Dave's team", [dave]);
    await db.query("DELETE FROM users WHERE id = $1", [dave.id]);
    assert.equal(await count("SELECT count(*)::int AS n FROM team_members WHERE team_id = $1", [teamId]), 1);
    assert.equal((await manager.api("GET", `/api/teams/${teamId}`)).status, 200);
  });

  test("deleting a prompt's owner removes its publications; deleting a team owner removes the whole team", async () => {
    const erin = await signupUser(app.base, "Erin");
    const teamId = await newTeam(erin, "Erin's team", [bob]);
    const { promptId } = await createPrompt(erin, "Erin's prompt");
    await erin.api("POST", `/api/teams/${teamId}/prompts`, { promptId });
    const copy = await bob.api("POST", `/api/prompts/${promptId}/copy`, {});
    assert.equal(copy.status, 201);

    await db.query("DELETE FROM users WHERE id = $1", [erin.id]);

    for (const table of ["teams WHERE id", "team_members WHERE team_id", "team_prompts WHERE team_id"]) {
      assert.equal(await count(`SELECT count(*)::int AS n FROM ${table} = $1`, [teamId]), 0, table);
    }
    assert.equal(await count("SELECT count(*)::int AS n FROM prompts WHERE id = $1", [promptId]), 0);
    assert.equal(await count("SELECT count(*)::int AS n FROM prompt_versions WHERE prompt_id = $1", [promptId]), 0);
    // Bob's copy survives, provenance cleared rather than dangling
    assert.equal((await bob.api("GET", `/api/prompts/${copy.body.prompt.id}`)).status, 200);
    assert.equal((await db.query("SELECT copied_from_prompt_id FROM prompts WHERE id = $1", [copy.body.prompt.id])).rows[0].copied_from_prompt_id, null);
    assert.equal((await bob.api("GET", "/api/teams")).body.teams.some((t) => t.id === teamId), false);
  });

  test("no orphaned rows remain anywhere", async () => {
    const orphans = (
      await db.query(
        `SELECT
           (SELECT count(*)::int FROM team_members tm WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = tm.team_id)) AS members,
           (SELECT count(*)::int FROM team_prompts tp WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = tp.team_id)
                                                          OR NOT EXISTS (SELECT 1 FROM prompts p WHERE p.id = tp.prompt_id)) AS publications,
           (SELECT count(*)::int FROM teams t WHERE NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.team_id = t.id AND tm.role = 'owner')) AS ownerless_teams`
      )
    ).rows[0];
    assert.deepEqual(orphans, { members: 0, publications: 0, ownerless_teams: 0 });
  });
});
