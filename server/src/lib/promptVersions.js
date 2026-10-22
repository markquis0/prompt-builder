// The only place that writes prompts / prompt_versions, so the invariants
// live in one spot: version numbers are sequential per prompt, a version is
// never updated after insert (also enforced by a DB trigger), and
// prompts.current_version_id always points at the newest version.
//
// Every function takes a pg client already inside a transaction — callers
// own BEGIN/COMMIT so a version write can be atomic with whatever else
// they're doing (e.g. sessions.js inserting the session row too).

// Longest title a user may give a prompt. Default titles are shorter (below).
export const TITLE_MAX_LENGTH = 120;
const DEFAULT_TITLE_MAX = 60;

// Deterministic starting title for a new prompt, used until the user renames
// it: the first sentence of what they typed, trimmed to a word boundary.
// Deliberately no extra LLM call just to name something — manual rename is
// the real feature. Existing prompts keep whatever title they already have.
export function defaultTitleFrom(originalPrompt) {
  const oneLine = String(originalPrompt || "").replace(/\s+/g, " ").trim();
  const sentenceEnd = oneLine.search(/[.!?](\s|$)/);
  let title = sentenceEnd > 0 ? oneLine.slice(0, sentenceEnd) : oneLine;
  if (title.length > DEFAULT_TITLE_MAX) {
    title = title.slice(0, DEFAULT_TITLE_MAX).replace(/\s+\S*$/, "") + "…";
  }
  return title || "Untitled prompt";
}

export const VERSION_SOURCES = ["generated", "regenerated", "edited", "restored", "copied"];

export async function createPromptWithFirstVersion(
  client,
  { userId, name, promptType, version, copiedFromPromptId, copiedFromVersionId }
) {
  const { rows: promptRows } = await client.query(
    `INSERT INTO prompts (user_id, name, prompt_type, copied_from_prompt_id, copied_from_version_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [userId, name, promptType || null, copiedFromPromptId || null, copiedFromVersionId || null]
  );
  const promptId = promptRows[0].id;
  const versionRow = await insertVersion(client, { promptId, userId, versionNumber: 1, parentVersionId: null, ...version });
  await client.query("UPDATE prompts SET current_version_id = $1, updated_at = now() WHERE id = $2", [
    versionRow.id,
    promptId,
  ]);
  return { promptId, version: versionRow };
}

// A rejection the caller should surface as an HTTP error (nothing to save,
// restoring the already-current version, etc.) — thrown from buildVersion
// so it aborts the transaction cleanly rather than half-writing.
export class VersionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// buildVersion(currentVersionRow) runs *under the prompt's row lock* and
// returns the fields for the new version — so "compare against current" and
// "restore from an older one" see a state no concurrent save can change.
// Returns null if the prompt doesn't exist or isn't this user's — callers
// treat that as a 404 either way, same as sessions.js, so ownership of other
// users' IDs is never confirmed.
export async function addVersion(client, { promptId, userId, buildVersion }) {
  // Row lock serializes concurrent saves on the same prompt, so two
  // "Save new version" clicks can't both compute the same next number
  // (the UNIQUE constraint is the backstop, this is what avoids the error).
  const { rows: promptRows } = await client.query(
    "SELECT id, current_version_id FROM prompts WHERE id = $1 AND user_id = $2 FOR UPDATE",
    [promptId, userId]
  );
  const prompt = promptRows[0];
  if (!prompt) return null;

  const { rows: currentRows } = await client.query("SELECT * FROM prompt_versions WHERE id = $1", [
    prompt.current_version_id,
  ]);
  const version = await buildVersion(currentRows[0] || null);

  const { rows: maxRows } = await client.query(
    "SELECT COALESCE(MAX(version_number), 0) AS n FROM prompt_versions WHERE prompt_id = $1",
    [promptId]
  );
  const versionRow = await insertVersion(client, {
    promptId,
    userId,
    versionNumber: maxRows[0].n + 1,
    parentVersionId: prompt.current_version_id,
    ...version,
  });
  await client.query("UPDATE prompts SET current_version_id = $1, updated_at = now() WHERE id = $2", [
    versionRow.id,
    promptId,
  ]);
  return { promptId, version: versionRow };
}

async function insertVersion(
  client,
  {
    promptId,
    userId,
    versionNumber,
    parentVersionId,
    content,
    promptObject,
    originalPrompt,
    qaPairs,
    supportingContext,
    changeNote,
    restoredFromVersionId,
    sessionId,
    source,
  }
) {
  const { rows } = await client.query(
    `INSERT INTO prompt_versions
       (prompt_id, version_number, content, prompt_object, original_prompt, qa_pairs,
        supporting_context, change_note, parent_version_id, restored_from_version_id,
        created_by, session_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      promptId,
      versionNumber,
      content,
      promptObject ? JSON.stringify(promptObject) : null,
      originalPrompt ?? null,
      qaPairs ? JSON.stringify(qaPairs) : null,
      supportingContext ?? null,
      changeNote || null,
      parentVersionId,
      restoredFromVersionId || null,
      userId,
      sessionId || null,
      VERSION_SOURCES.includes(source) ? source : null,
    ]
  );
  return rows[0];
}
