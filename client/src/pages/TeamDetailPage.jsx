import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import InlineTitle from "../components/InlineTitle.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import {
  getTeam,
  renameTeam,
  deleteTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  leaveTeam,
  listTeamPrompts,
  addPromptToTeam,
  removePromptFromTeam,
  listPrompts,
  getPrompt,
  copyPrompt,
} from "../api.js";
import { openPromptInBuilder } from "../promptResume.js";
import { copyToClipboard, COPY_CONFIRMATION_MS } from "../clipboard.js";
import { formatRelative, truncate } from "../formatSession.js";
import "./HistoryPage.css";
import "./TeamDetailPage.css";

const SITE_URL = "https://promptme.host";

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function TeamDetailPage() {
  const { teamId } = useParams();
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();

  const [team, setTeam] = useState(null);
  const [members, setMembers] = useState(null);
  const [prompts, setPrompts] = useState(null);
  const [myPrompts, setMyPrompts] = useState([]); // owner only: candidates to publish
  const [tab, setTab] = useState("prompts");
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [pickId, setPickId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberError, setMemberError] = useState(null);
  const [addingMember, setAddingMember] = useState(false);

  const isOwner = team?.role === "owner";

  useEffect(() => {
    if (!authLoading && !user) navigate("/", { replace: true });
  }, [authLoading, user, navigate]);

  const load = useCallback(async () => {
    const [{ team: t }, { members: m }, { prompts: p }] = await Promise.all([
      getTeam(teamId),
      listTeamMembers(teamId),
      listTeamPrompts(teamId),
    ]);
    setTeam(t);
    setMembers(m);
    setPrompts(p);
    if (t.role === "owner") {
      const { prompts: mine } = await listPrompts();
      setMyPrompts(mine);
    }
  }, [teamId]);

  useEffect(() => {
    if (!user) return;
    load().catch((err) => setError(err.message));
  }, [user, load]);

  async function run(id, fn) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleRename(name) {
    const { team: updated } = await renameTeam(teamId, name);
    setTeam((prev) => ({ ...prev, name: updated.name }));
    posthog.capture("team_renamed", { team_id: teamId });
  }

  function handleDelete() {
    if (
      !window.confirm(
        `Delete “${team.name}”? Members lose access to its prompts. The prompts themselves are not deleted — they stay in their owners' libraries.`
      )
    ) {
      return;
    }
    run("team", async () => {
      await deleteTeam(teamId);
      posthog.capture("team_deleted", { team_id: teamId });
      navigate("/teams");
    });
  }

  function handleLeave() {
    if (!window.confirm(`Leave “${team.name}”? You'll lose access to its prompts. Copies you've made stay yours.`)) return;
    run("team", async () => {
      await leaveTeam(teamId);
      posthog.capture("team_left", { team_id: teamId });
      navigate("/teams");
    });
  }

  async function handleAddMember(e) {
    e.preventDefault();
    if (!memberEmail.trim()) return;
    setAddingMember(true);
    setMemberError(null);
    try {
      const { member } = await addTeamMember(teamId, memberEmail);
      setMembers((prev) => [...prev, member]);
      setTeam((prev) => ({ ...prev, memberCount: prev.memberCount + 1 }));
      setMemberEmail("");
      posthog.capture("team_member_added", { team_id: teamId });
    } catch (err) {
      setMemberError(err.message);
    } finally {
      setAddingMember(false);
    }
  }

  const handleRemoveMember = (member) =>
    run(member.id, async () => {
      await removeTeamMember(teamId, member.id);
      setMembers((prev) => prev.filter((m) => m.id !== member.id));
      setTeam((prev) => ({ ...prev, memberCount: prev.memberCount - 1 }));
      posthog.capture("team_member_removed", { team_id: teamId });
    });

  async function handleAddPrompt(e) {
    e.preventDefault();
    if (!pickId) return;
    await run("add-prompt", async () => {
      await addPromptToTeam(teamId, pickId);
      posthog.capture("prompt_added_to_team", { team_id: teamId, prompt_id: pickId, source_page: "team" });
      setPickId("");
      await load();
    });
  }

  const handleRemovePrompt = (prompt) =>
    run(prompt.id, async () => {
      await removePromptFromTeam(teamId, prompt.id);
      posthog.capture("prompt_removed_from_team", { team_id: teamId, prompt_id: prompt.id, source_page: "team" });
      await load();
    });

  const handleCopy = (prompt) =>
    run(prompt.id, async () => {
      const { currentVersion } = await getPrompt(prompt.id);
      if (currentVersion && (await copyToClipboard(currentVersion.content))) {
        setCopiedId(prompt.id);
        setTimeout(() => setCopiedId(null), COPY_CONFIRMATION_MS);
        posthog.capture("team_prompt_copied", {
          team_id: teamId,
          prompt_id: prompt.id,
          version_number: currentVersion.versionNumber,
        });
      }
    });

  // "Build on this": the member gets their own independent prompt (v1 = the
  // team prompt's current version) and lands in the builder with it.
  async function handleBuildOnThis(prompt) {
    if (busyId) return;
    setBusyId(prompt.id);
    setError(null);
    try {
      const { prompt: mine } = await copyPrompt(prompt.id);
      posthog.capture("prompt_copy_saved", {
        source: "team",
        prompt_id: prompt.id,
        new_prompt_id: mine.id,
        source_page: "team",
      });
      posthog.capture("team_prompt_built_on", {
        team_id: teamId,
        prompt_id: prompt.id,
        version_number: prompt.currentVersionNumber,
      });
      await openPromptInBuilder(navigate, mine.id);
    } catch (err) {
      setError(err.message);
      setBusyId(null);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="app-shell">
        <NavHeader />
        <main>
          <p className="loading-text">Loading…</p>
        </main>
      </div>
    );
  }

  const inTeam = new Set((prompts || []).map((p) => p.id));
  const publishable = myPrompts.filter((p) => !inTeam.has(p.id));

  return (
    <div className="app-shell">
      <Helmet>
        <title>{team ? `${team.name} — PromptMe` : "Team — PromptMe"}</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}/teams/${teamId}`} />
      </Helmet>
      <NavHeader />
      <main className="team-detail history-page">
        <p className="prompt-detail-back">
          <Link to="/teams">← Teams</Link>
        </p>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}
        {!team && !error && <p className="loading-text">Loading…</p>}

        {team && members && prompts && (
          <>
            <InlineTitle as="h1" title={team.name} canEdit={isOwner} onSave={handleRename} />
            <p className="team-detail-role">
              {isOwner ? "You are the owner" : `Team owner: ${team.ownerName}`} · {plural(team.memberCount, "member")}
            </p>

            <div className="history-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "prompts"}
                className={`history-tab ${tab === "prompts" ? "active" : ""}`}
                onClick={() => setTab("prompts")}
              >
                Team Prompts ({prompts.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "members"}
                className={`history-tab ${tab === "members" ? "active" : ""}`}
                onClick={() => setTab("members")}
              >
                Members ({members.length})
              </button>
            </div>

            {tab === "prompts" && (
              <section>
                {prompts.length === 0 && (
                  <p className="history-empty">
                    {isOwner
                      ? "No prompts yet. Add one of your prompts below — members will always see its latest version."
                      : "The owner hasn't published any prompts to this team yet."}
                  </p>
                )}

                {prompts.length > 0 && (
                  <ul className="history-list">
                    {prompts.map((prompt) => {
                      const busy = busyId === prompt.id;
                      return (
                        <li key={prompt.id} className="history-card">
                          <button
                            type="button"
                            className="history-item"
                            onClick={() => navigate(`/history/${prompt.id}`)}
                          >
                            <span className="history-item-text">{truncate(prompt.title, 100)}</span>
                            <span className="history-item-date">
                              v{prompt.currentVersionNumber} · Updated {formatRelative(prompt.updatedAt)}
                            </span>
                          </button>
                          <p className="history-item-meta">
                            Official team prompt · {plural(prompt.versionCount, "version")}
                            {prompt.buildCount > 0 && ` · Built on ${plural(prompt.buildCount, "time")}`}
                          </p>
                          <div className="history-actions">
                            <button type="button" className="link-button" onClick={() => handleCopy(prompt)} disabled={busy}>
                              {copiedId === prompt.id ? "Copied!" : "Copy"}
                            </button>
                            <Link to={`/history/${prompt.id}`} className="history-versions-link">
                              Version history
                            </Link>
                            {isOwner ? (
                              <button type="button" className="link-button" onClick={() => handleRemovePrompt(prompt)} disabled={busy}>
                                Remove from team
                              </button>
                            ) : (
                              <button type="button" className="link-button" onClick={() => handleBuildOnThis(prompt)} disabled={busy}>
                                Build on this
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {isOwner && (
                  <form className="team-add-form" onSubmit={handleAddPrompt}>
                    <label htmlFor="team-add-prompt">Add one of your prompts</label>
                    <div className="team-add-row">
                      <select id="team-add-prompt" value={pickId} onChange={(e) => setPickId(e.target.value)}>
                        <option value="">
                          {publishable.length === 0 ? "No more prompts to add" : "Choose a prompt…"}
                        </option>
                        {publishable.map((p) => (
                          <option key={p.id} value={p.id}>
                            {truncate(p.title, 70)}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className="btn btn-primary" disabled={!pickId || busyId === "add-prompt"}>
                        Add
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}

            {tab === "members" && (
              <section>
                <ul className="team-member-list">
                  {members.map((member) => (
                    <li key={member.id}>
                      <span className="team-member-person">
                        <span className="team-member-name">
                          {member.user.firstName} {member.user.lastName}
                        </span>
                        {member.user.email && <span className="team-member-email">{member.user.email}</span>}
                      </span>
                      <span className="team-member-role">{member.role === "owner" ? "Owner" : "Member"}</span>
                      {isOwner && member.role === "member" && (
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => handleRemoveMember(member)}
                          disabled={busyId === member.id}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {isOwner && (
                  <form className="team-add-form" onSubmit={handleAddMember}>
                    <label htmlFor="team-add-member">Add a member</label>
                    <div className="team-add-row">
                      <input
                        id="team-add-member"
                        type="email"
                        value={memberEmail}
                        placeholder="teammate@company.com"
                        onChange={(e) => setMemberEmail(e.target.value)}
                      />
                      <button type="submit" className="btn btn-primary" disabled={addingMember || !memberEmail.trim()}>
                        {addingMember ? "Adding…" : "Add member"}
                      </button>
                    </div>
                    {memberError && <p className="teams-error">{memberError}</p>}
                    <p className="team-add-hint">They need an existing PromptMe account with that email.</p>
                  </form>
                )}
              </section>
            )}

            <div className="team-danger-zone">
              {isOwner ? (
                <button type="button" className="link-button team-danger" onClick={handleDelete} disabled={busyId === "team"}>
                  Delete team
                </button>
              ) : (
                <button type="button" className="link-button team-danger" onClick={handleLeave} disabled={busyId === "team"}>
                  Leave team
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
