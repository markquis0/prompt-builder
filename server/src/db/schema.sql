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
