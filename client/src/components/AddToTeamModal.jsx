import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import posthog from "posthog-js";
import { listTeams, addPromptToTeam, removePromptFromTeam } from "../api.js";
import "./AuthModal.css";
import "./ShareModal.css";

// Owner-only. Publishes the prompt to teams the user owns (and takes it back
// out). It's an association to the prompt, not a copy: team members always
// see whatever the prompt's current version is, so there's nothing to
// republish after saving a new version. `currentTeamIds` is where it's
// already published; `onChanged()` lets the page refresh its "Used by" line.
export default function AddToTeamModal({ promptId, promptTitle, currentTeamIds, onClose, onChanged }) {
  const [teams, setTeams] = useState(null);
  const [published, setPublished] = useState(() => new Set(currentTeamIds));
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listTeams()
      .then(({ teams }) => setTeams(teams.filter((t) => t.role === "owner")))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function toggle(team) {
    setError(null);
    setBusyId(team.id);
    const isIn = published.has(team.id);
    try {
      if (isIn) {
        await removePromptFromTeam(team.id, promptId);
        posthog.capture("prompt_removed_from_team", { team_id: team.id, prompt_id: promptId, source_page: "detail" });
      } else {
        await addPromptToTeam(team.id, promptId);
        posthog.capture("prompt_added_to_team", { team_id: team.id, prompt_id: promptId, source_page: "detail" });
      }
      setPublished((prev) => {
        const next = new Set(prev);
        if (isIn) next.delete(team.id);
        else next.add(team.id);
        return next;
      });
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="auth-modal-overlay" onClick={onClose}>
      <div
        className="card auth-modal share-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Add ${promptTitle} to a team`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="auth-modal-header">
          <h2>Add “{promptTitle}” to a team</h2>
          <button type="button" className="btn btn-ghost auth-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="share-modal-intro">
          Members of a team see this as an official prompt and always get its latest version — no need to re-share
          after you save a new one. They can use and copy it, but can’t change it.
        </p>

        {error && <p className="share-modal-error">{error}</p>}
        {teams === null && !error && <p className="loading-text">Loading…</p>}

        {teams && teams.length === 0 && (
          <p className="share-modal-empty">
            You don’t own any teams yet. <Link to="/teams">Create a team</Link> first.
          </p>
        )}

        {teams && teams.length > 0 && (
          <ul className="share-modal-list">
            {teams.map((team) => {
              const isIn = published.has(team.id);
              return (
                <li key={team.id}>
                  <span className="share-modal-person">
                    <span className="share-modal-name">{team.name}</span>
                    <span className="share-modal-email">{isIn ? "Official team prompt" : `${team.memberCount} members`}</span>
                  </span>
                  <button
                    type="button"
                    className={isIn ? "link-button" : "btn btn-secondary"}
                    onClick={() => toggle(team)}
                    disabled={busyId === team.id}
                  >
                    {busyId === team.id ? "…" : isIn ? "Remove from team" : "Add"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
