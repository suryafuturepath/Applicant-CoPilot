-- ============================================================
-- Migration: add_interview_prep_action
-- Description: Adds 'interview_prep' to usage_logs action_type CHECK
--              constraint for the interview preparation feature.
-- ============================================================

ALTER TABLE public.usage_logs
  DROP CONSTRAINT IF EXISTS usage_logs_action_type_check;

ALTER TABLE public.usage_logs
  ADD CONSTRAINT usage_logs_action_type_check
  CHECK (action_type IN (
    'answer_generation', 'cover_letter', 'resume', 'chat',
    'classification', 'resume_generation', 'jd_digest', 'interview_prep'
  ));

-- ============================================================
-- DOWN (rollback)
-- ============================================================
-- ALTER TABLE public.usage_logs DROP CONSTRAINT IF EXISTS usage_logs_action_type_check;
-- ALTER TABLE public.usage_logs ADD CONSTRAINT usage_logs_action_type_check
--   CHECK (action_type IN (
--     'answer_generation', 'cover_letter', 'resume', 'chat',
--     'classification', 'resume_generation', 'jd_digest'
--   ));
