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
