import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import posthog from "posthog-js";
import NavHeader from "../components/NavHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { listTeams, createTeam } from "../api.js";
import "./TeamsPage.css";

const SITE_URL = "https://promptme.host";

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export default function TeamsPage() {
  const { user, authLoading } = useAuth();
  const navigate = useNavigate();
  const [teams, setTeams] = useState(null);
  const [error, setError] = useState(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Same redirect-to-"/" pattern as HistoryPage/SettingsPage.
  useEffect(() => {
    if (!authLoading && !user) navigate("/", { replace: true });
  }, [authLoading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    posthog.capture("teams_viewed");
    listTeams()
      .then(({ teams }) => setTeams(teams))
      .catch((err) => setError(err.message));
  }, [user]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const { team } = await createTeam(name);
      posthog.capture("team_created", { team_id: team.id });
      navigate(`/teams/${team.id}`);
    } catch (err) {
      setCreateError(err.message);
      setCreating(false);
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

  return (
    <div className="app-shell">
      <Helmet>
        <title>Teams — PromptMe</title>
        <meta name="robots" content="noindex" />
        <link rel="canonical" href={`${SITE_URL}/teams`} />
      </Helmet>
      <NavHeader />
      <main className="teams-page">
        <h1>Teams</h1>
        <p className="teams-intro">
          A team is a shared space for official prompts. Add the people you work with, publish a prompt to the team
          once, and everyone sees its latest version — no re-sharing.
        </p>

        {error && (
          <div className="error-banner">
            <span>{error}</span>
          </div>
        )}

        {teams === null && !error && <p className="loading-text">Loading…</p>}

        {teams && teams.length > 0 && (
          <ul className="teams-list">
            {teams.map((team) => (
              <li key={team.id}>
                <Link to={`/teams/${team.id}`} className="team-card">
                  <span className="team-card-name">{team.name}</span>
                  <span className="team-card-role">{team.role === "owner" ? "Owner" : "Member"}</span>
                  <span className="team-card-meta">
                    {plural(team.memberCount, "member")} · {plural(team.promptCount, "prompt")}
                    {team.role !== "owner" && ` · Owned by ${team.ownerName}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {teams && teams.length === 0 && (
          <p className="teams-empty">You're not on any teams yet. Create one below, or ask a teammate to add you.</p>
        )}

        <section className="teams-create">
          <h2>Create a team</h2>
          <form onSubmit={handleCreate} className="teams-create-form">
            <input
              type="text"
              value={name}
              maxLength={80}
              placeholder="e.g. Acme Marketing"
              aria-label="Team name"
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
              {creating ? "Creating…" : "Create"}
            </button>
          </form>
          {createError && <p className="teams-error">{createError}</p>}
        </section>
      </main>
    </div>
  );
}
