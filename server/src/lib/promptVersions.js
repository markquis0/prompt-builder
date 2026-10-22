// The only place that writes prompts / prompt_versions, so the invariants
// live in one spot: version numbers are sequential per prompt, a version is
// never updated after insert (also enforced by a DB trigger), and
// prompts.current_version_id always points at the newest version.
//
// Every function takes a pg client already inside a transaction — callers
// own BEGIN/COMMIT so a version write can be atomic with whatever else
// they're doing (e.g. sessions.js inserting the session row too).

const NAME_MAX = 80;

export function promptNameFrom(originalPrompt) {
  return originalPrompt.trim().slice(0, NAME_MAX);
}

export async function createPromptWithFirstVersion(client, { userId, name, promptType, version }) {
  const { rows: promptRows } = await client.query(
    "INSERT INTO prompts (user_id, name, prompt_type) VALUES ($1, $2, $3) RETURNING id",
    [userId, name, promptType || null]
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
  }
) {
  const { rows } = await client.query(
    `INSERT INTO prompt_versions
       (prompt_id, version_number, content, prompt_object, original_prompt, qa_pairs,
        supporting_context, change_note, parent_version_id, restored_from_version_id,
        created_by, session_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
    ]
  );
  return rows[0];
}
