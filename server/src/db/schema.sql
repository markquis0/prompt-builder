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
