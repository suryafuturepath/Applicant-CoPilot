-- Migration: Add data collection tables for JD intelligence + candidate activity scoring
-- Date: 2026-04-01
-- Purpose: Lean data layer for market intelligence and candidate seriousness scoring.
--          Feeds future Recruiter Copilot product. All data is consent-gated.

-- ─── 1. Add data_consent to profiles ─────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS data_consent boolean DEFAULT false;

-- ─── 2. JD Intelligence (market data) ────────────────────────────────────────
-- One row per JD analyzed. Used for market intelligence:
-- which roles are hot, what skills companies want, hiring trends by industry.

CREATE TABLE IF NOT EXISTS jd_intelligence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role_title text,
  company text,
  seniority text,
  tech_stack jsonb DEFAULT '[]'::jsonb,
  key_requirements jsonb DEFAULT '[]'::jsonb,
  industry text,
  location text,
  analyzed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_jd_intelligence_profile ON jd_intelligence(profile_id);
CREATE INDEX idx_jd_intelligence_analyzed ON jd_intelligence(analyzed_at DESC);
CREATE INDEX idx_jd_intelligence_company ON jd_intelligence(company);

-- RLS: users can insert their own rows, read their own rows
ALTER TABLE jd_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own jd_intelligence"
  ON jd_intelligence FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can read own jd_intelligence"
  ON jd_intelligence FOR SELECT
  USING (auth.uid() = profile_id);

-- Service role can read all (for recruiter copilot / analytics)
CREATE POLICY "Service role full access on jd_intelligence"
  ON jd_intelligence FOR ALL
  USING (auth.role() = 'service_role');

-- ─── 3. Candidate Activity (one row per user, upserted) ─────────────────────
-- Aggregated activity metrics + seriousness score. Updated on each action.

CREATE TABLE IF NOT EXISTS candidate_activity (
  profile_id uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  jobs_analyzed integer DEFAULT 0,
  jobs_saved integer DEFAULT 0,
  jobs_applied integer DEFAULT 0,
  avg_match_score numeric(5,2) DEFAULT 0,
  cover_letters_generated integer DEFAULT 0,
  resumes_generated integer DEFAULT 0,
  prep_sessions integer DEFAULT 0,
  prep_total_time_sec integer DEFAULT 0,
  prep_avg_score numeric(4,2) DEFAULT 0,
  chat_messages_sent integer DEFAULT 0,
  seriousness_score integer DEFAULT 0,
  last_active_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: users can upsert their own row, read their own row
ALTER TABLE candidate_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own candidate_activity"
  ON candidate_activity FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own candidate_activity"
  ON candidate_activity FOR UPDATE
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can read own candidate_activity"
  ON candidate_activity FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Service role full access on candidate_activity"
  ON candidate_activity FOR ALL
  USING (auth.role() = 'service_role');

-- Auto-update updated_at on candidate_activity
CREATE OR REPLACE FUNCTION update_candidate_activity_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER handle_candidate_activity_updated_at
  BEFORE UPDATE ON candidate_activity
  FOR EACH ROW
  EXECUTE FUNCTION update_candidate_activity_timestamp();


-- ─── DOWN (rollback) ─────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS handle_candidate_activity_updated_at ON candidate_activity;
-- DROP TABLE IF EXISTS candidate_activity;
-- DROP TABLE IF EXISTS jd_intelligence;
-- ALTER TABLE profiles DROP COLUMN IF EXISTS data_consent;
