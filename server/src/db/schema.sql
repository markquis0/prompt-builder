-- Run via `npm run db:migrate` (server/src/db/migrate.js), or paste into
-- Render's Postgres query console. Safe to re-run — every statement is
-- idempotent (IF NOT EXISTS), unlike a literal copy of a migration log.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Subscription state
  stripe_customer_id       TEXT,
  stripe_subscription_id   TEXT,
  subscription_status      TEXT NOT NULL DEFAULT 'none',
    -- 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  trial_ends_at             TIMESTAMPTZ,
  current_period_ends_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_prompt   TEXT,
  qa_pairs          JSONB,
  supporting_context TEXT,
  prompt_object     JSONB,
  raw_assembled     TEXT,
  meta_prompt_version TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users(stripe_customer_id);

-- Phase 3 (links directory). Columns beyond what /resources itself needs
-- today (last_verified_at, verification_status, source_type) exist for two
-- future consumers: the vendor doc monitor writes into the first two after
-- each check, and Phase 4 scoring links rubric dimensions back to
-- curation_note. Retrofitting this shape under live data later is worse
-- than a few unused columns now.
CREATE TABLE IF NOT EXISTS resources (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  url                   TEXT NOT NULL,
  description           TEXT,
  organization          TEXT,           -- "Anthropic", "DAIR.AI", "Wharton GAIL"
  category              TEXT NOT NULL,  -- official_docs | research | community |
                                         --   tutorial | tool | news
  audience              TEXT NOT NULL,  -- beginner | practitioner | builder
  model_family          TEXT[] NOT NULL DEFAULT '{}',
                                         -- {claude, gpt, gemini, llama, mistral, ...}
  is_downloadable       BOOLEAN NOT NULL DEFAULT false,
  download_url          TEXT,
  curation_note         TEXT NOT NULL,  -- why THIS is worth the reader's time —
                                         -- required; the actual differentiator
                                         -- over a bare link list
  source_type           TEXT NOT NULL DEFAULT 'curated',
                                         -- 'curated' | 'scraped'
  verification_status   TEXT NOT NULL DEFAULT 'verified',
                                         -- 'verified' | 'moved' | 'stale' | 'broken'
  published_at          DATE,
  last_verified_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category);
CREATE INDEX IF NOT EXISTS idx_resources_audience ON resources(audience);
CREATE INDEX IF NOT EXISTS idx_resources_model_family ON resources USING GIN(model_family);
CREATE INDEX IF NOT EXISTS idx_resources_verification_status ON resources(verification_status);

-- Phase 4 (completeness scoring). ADD COLUMN rather than a new table —
-- extends the existing sessions row a critique was scored against.
-- deterministic_score/checks are Layer 1 (free, computed client-side,
-- written here only for the user's own history); llm_critique/
-- critique_version/scored_at are Layer 2 (paid, one LLM call). Both are
-- nullable — most session rows will never be scored at all.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deterministic_score INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS deterministic_checks JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS llm_critique JSONB;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS critique_version TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

-- Webhook dedup (scalability review Finding 8.1). Stripe delivers events
-- at-least-once — retries, and manual resends from the Dashboard, can
-- redeliver an event we already applied. id is Stripe's own event.id
-- (evt_...), already globally unique, so it's the primary key directly
-- rather than a separate surrogate id.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id            TEXT PRIMARY KEY,
  processed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Webhook ordering guard (same finding). Stripe doesn't guarantee delivery
-- order, so customer.subscription.updated needs a way to detect a
-- late-arriving older event and skip it rather than regress
-- subscription_status backward. Stores the event.created (not sub.created)
-- of the last update actually applied for this row's subscription.
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_event_created_at TIMESTAMPTZ;

-- Account settings (password/email change). Bumped on every password
-- change and embedded in each issued JWT (see routes/auth.js's
-- issueSessionCookie) so requireAuth/requirePaid can reject tokens signed
-- before the bump — the only way to invalidate an already-issued,
-- unexpired JWT without a separate revocation-list table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

-- Session history (minimal). Not a new table — the sessions table already
-- gets an automatic, no-save-button write on every generation for signed-in
-- users (PromptBuilder.jsx's requestAssembly), which is exactly the
-- "persist on generation" requirement a session-history feature needs.
-- category reuses the promptType value IntakeForm.jsx already collects at
-- intake (previously used only to steer question generation, then
-- dropped before assembly) — nullable since older rows and prompts where
-- the user left it unset never had one.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS category TEXT;

-- Header redesign Part 3 — required first/last name at signup.
--
-- INCIDENT: the handoff's premise ("no existing signed-up users, so a
-- plain NOT NULL with no backfill is fine") was wrong. Production's
-- `users` table already had rows, so the original bare
-- `ADD COLUMN ... NOT NULL` (no default) failed outright the moment this
-- deployed — exactly the failure mode flagged in-line when that version
-- shipped — which broke every login/signup/account request from that
-- point on, since the application code already unconditionally queries
-- these columns. Confirmed live: POST /api/auth/login 500ing consistently
-- (not a cold-start blip — ruled out with timed retries) while
-- GET /api/resources (untouched by this migration) stayed healthy,
-- isolating the failure to exactly these two missing columns.
--
-- Fixed with the standard safe pattern for adding NOT NULL to a non-empty
-- table: add nullable, backfill existing rows, then enforce NOT NULL.
-- Idempotent/safe to re-run on every boot like the rest of this file —
-- the UPDATE only touches rows still NULL, and SET NOT NULL is a no-op
-- once already set.
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;
UPDATE users SET first_name = 'Unknown' WHERE first_name IS NULL;
UPDATE users SET last_name = 'Unknown' WHERE last_name IS NULL;
ALTER TABLE users ALTER COLUMN first_name SET NOT NULL;
ALTER TABLE users ALTER COLUMN last_name SET NOT NULL;

-- Prompt version history. A "prompt" is one persistent identity a user
-- keeps improving; each "prompt_version" is an immutable snapshot of it.
-- `sessions` is left exactly as it was (the critique feature still writes
-- scores onto session rows) — this is additive, and prompt_versions.session_id
-- is only a soft link back to the generation that produced a version.
--
-- Not an FK on purpose: prompt_versions are immutable (trigger below), and
-- an FK with ON DELETE SET NULL would be an UPDATE the trigger blocks
-- during a user-deletion cascade.
CREATE TABLE IF NOT EXISTS prompts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  prompt_type        TEXT,
  current_version_id UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id                 UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  version_number            INTEGER NOT NULL,
  content                   TEXT NOT NULL,
  prompt_object             JSONB,
  original_prompt           TEXT,
  qa_pairs                  JSONB,
  supporting_context        TEXT,
  change_note               TEXT,
  parent_version_id         UUID REFERENCES prompt_versions(id) ON DELETE CASCADE,
  restored_from_version_id  UUID REFERENCES prompt_versions(id) ON DELETE CASCADE,
  created_by                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id                UUID,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, version_number)
);

-- prompts <-> prompt_versions reference each other, so this FK can only be
-- added after both tables exist. Deferred so deleting a user (cascading
-- through prompts and versions in one statement) never trips over it.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompts_current_version_fk') THEN
    ALTER TABLE prompts
      ADD CONSTRAINT prompts_current_version_fk
      FOREIGN KEY (current_version_id) REFERENCES prompt_versions(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_prompts_user_updated ON prompts(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt ON prompt_versions(prompt_id, version_number DESC);

-- Immutability enforced in the database, not just by the API never issuing
-- an UPDATE: a saved version must never change. DELETE is deliberately not
-- blocked — account deletion cascades through here.
CREATE OR REPLACE FUNCTION prompt_versions_block_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'prompt_versions rows are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prompt_versions_block_update ON prompt_versions;
CREATE TRIGGER trg_prompt_versions_block_update
  BEFORE UPDATE ON prompt_versions
  FOR EACH ROW EXECUTE FUNCTION prompt_versions_block_update();

-- Backfill: every already-saved generation becomes one prompt with a v1.
-- Re-runnable on every boot — only sessions with no version yet are
-- touched. Sessions with no assembled text (the anonymous->account
-- migration can save a half-finished intake) are skipped: a prompt needs
-- content to be a prompt.
DO $$
DECLARE
  s RECORD;
  new_prompt_id UUID;
  new_version_id UUID;
BEGIN
  FOR s IN
    SELECT * FROM sessions
    WHERE original_prompt IS NOT NULL
      AND btrim(original_prompt) <> ''
      AND raw_assembled IS NOT NULL
      AND btrim(raw_assembled) <> ''
      AND NOT EXISTS (SELECT 1 FROM prompt_versions pv WHERE pv.session_id = sessions.id)
    ORDER BY created_at
  LOOP
    INSERT INTO prompts (user_id, name, prompt_type, created_at, updated_at)
    VALUES (s.user_id, left(s.original_prompt, 80), s.category, s.created_at, s.updated_at)
    RETURNING id INTO new_prompt_id;

    INSERT INTO prompt_versions
      (prompt_id, version_number, content, prompt_object, original_prompt, qa_pairs,
       supporting_context, created_by, session_id, created_at)
    VALUES
      (new_prompt_id, 1, s.raw_assembled, s.prompt_object, s.original_prompt, s.qa_pairs,
       s.supporting_context, s.user_id, s.id, s.created_at)
    RETURNING id INTO new_version_id;

    UPDATE prompts SET current_version_id = new_version_id WHERE id = new_prompt_id;
  END LOOP;

  -- prompts_current_version_fk is DEFERRABLE INITIALLY DEFERRED, so the
  -- inserts above leave pending constraint checks until the transaction
  -- commits — and this whole file runs as ONE transaction. Postgres refuses
  -- any later ALTER TABLE prompts in the same transaction while checks are
  -- pending ("cannot ALTER TABLE because it has pending trigger events"),
  -- which would roll back this entire file and leave every statement after
  -- this block (including newer migrations) silently unapplied. Running the
  -- check now makes this block self-contained wherever it sits in the file.
  SET CONSTRAINTS prompts_current_version_fk IMMEDIATE;
END $$;

-- Prompt sharing, copy provenance, version source.
--
-- prompts.name is the prompt's title (the API exposes it as `title`). It was
-- not renamed to `title` in the database: a rename would break the old server
-- instance still serving during a deploy's overlap, and nothing else needs
-- it. Renaming a prompt updates this column only — a title is metadata, not
-- prompt content, so it never creates a version.

-- How a version came to exist: generated | regenerated | edited | restored |
-- copied. Nullable on purpose — versions that predate this column can't be
-- backfilled (prompt_versions is immutable, and the trigger above would
-- rightly reject the UPDATE), so NULL means "unknown" and readers derive a
-- label from version_number / restored_from_version_id instead.
ALTER TABLE prompt_versions ADD COLUMN IF NOT EXISTS source TEXT;

-- Provenance for "Build on this" / "Save a copy". SET NULL, not CASCADE: a
-- copy belongs to whoever made it and must survive the original being
-- deleted (or its owner's account being deleted).
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS copied_from_prompt_id UUID REFERENCES prompts(id) ON DELETE SET NULL;
ALTER TABLE prompts ADD COLUMN IF NOT EXISTS copied_from_version_id UUID REFERENCES prompt_versions(id) ON DELETE SET NULL;

-- Private user-to-user sharing of a *logical prompt* — a recipient always
-- sees the owner's current version, not a snapshot. The owner is not stored
-- here: prompts.user_id already is the owner, and a second copy of that fact
-- could drift. `permission` only has 'viewer' today; the column exists so an
-- editor level can be added later without another migration.
CREATE TABLE IF NOT EXISTS prompt_shares (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id            UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  shared_with_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission           TEXT NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer')),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, shared_with_user_id)
);

CREATE INDEX IF NOT EXISTS idx_prompt_shares_shared_with ON prompt_shares(shared_with_user_id);

-- Teams: a lightweight workspace so an owner can publish official prompts to
-- a group once instead of sharing each prompt person by person.
--
-- Two roles, 'owner' and 'member'. teams.created_by IS the owner — there is
-- no ownership transfer yet — and it cascades: deleting the owner's account
-- deletes the team (and, through it, memberships and publications), because
-- a team must never be left without an owner. The owner also gets a
-- team_members row (role 'owner') so "who is in this team" is one uniform
-- query; the partial unique index below guarantees exactly one such row.
-- When transfer is added later, created_by and that row move together.
CREATE TABLE IF NOT EXISTS teams (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_one_owner ON team_members(team_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

-- A team's official prompts are an ASSOCIATION to the logical prompt, never
-- a copy: the prompt's current version is whatever its owner last saved, so
-- members see v8 the moment it exists. Deleting a team (or removing a
-- prompt from it) deletes only this row — the prompt, its versions and its
-- owner's library are untouched. Deleting the prompt removes its
-- publications.
CREATE TABLE IF NOT EXISTS team_prompts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id       UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  prompt_id     UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  published_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS idx_team_prompts_prompt ON team_prompts(prompt_id);
