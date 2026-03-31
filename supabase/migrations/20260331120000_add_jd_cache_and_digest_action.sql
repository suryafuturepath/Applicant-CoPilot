-- ============================================================
-- Migration: add_jd_cache_and_digest_action
-- Description: Adds jd_cache table for server-side response caching
--              and 'jd_digest' action type to usage_logs.
-- ============================================================

-- ============================================================
-- TABLE: jd_cache
-- Caches AI responses per user per JD per operation.
-- Cache key = (profile_id, jd_hash, operation).
-- Entries expire after 7 days (checked at query time).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jd_cache (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  jd_hash         text NOT NULL,       -- SHA-256 of normalized JD text
  operation       text NOT NULL         -- 'digest', 'analysis', 'cover_letter', 'resume', 'bullet_rewrite'
                    CHECK (operation IN ('digest', 'analysis', 'cover_letter', 'resume', 'bullet_rewrite')),
  result          jsonb NOT NULL,       -- Cached AI response
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Composite unique constraint = the cache key
CREATE UNIQUE INDEX IF NOT EXISTS idx_jd_cache_lookup
  ON public.jd_cache(profile_id, jd_hash, operation);

-- Index for TTL cleanup queries
CREATE INDEX IF NOT EXISTS idx_jd_cache_expires
  ON public.jd_cache(expires_at);

-- ============================================================
-- RLS: Users can only CRUD their own cache rows
-- ============================================================
ALTER TABLE public.jd_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own cache"
  ON public.jd_cache FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own cache"
  ON public.jd_cache FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own cache"
  ON public.jd_cache FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete own cache"
  ON public.jd_cache FOR DELETE
  USING (auth.uid() = profile_id);

-- ============================================================
-- UPDATE: Add 'jd_digest' to usage_logs action_type CHECK
-- ============================================================
ALTER TABLE public.usage_logs
  DROP CONSTRAINT IF EXISTS usage_logs_action_type_check;

ALTER TABLE public.usage_logs
  ADD CONSTRAINT usage_logs_action_type_check
  CHECK (action_type IN (
    'answer_generation', 'cover_letter', 'resume', 'chat',
    'classification', 'resume_generation', 'jd_digest'
  ));

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- DROP TABLE IF EXISTS public.jd_cache;
-- ALTER TABLE public.usage_logs DROP CONSTRAINT IF EXISTS usage_logs_action_type_check;
-- ALTER TABLE public.usage_logs ADD CONSTRAINT usage_logs_action_type_check
--   CHECK (action_type IN ('answer_generation', 'cover_letter', 'resume', 'chat', 'classification', 'resume_generation'));
