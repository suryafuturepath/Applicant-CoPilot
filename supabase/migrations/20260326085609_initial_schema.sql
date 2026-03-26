-- ============================================================
-- Migration: initial_schema
-- Description: Core tables for Applicant Copilot MVP
-- ============================================================

-- No extensions needed — using gen_random_uuid() (built-in to Postgres 13+)

-- ============================================================
-- TABLE: profiles
-- One row per user. PK is the Supabase auth user ID.
-- ============================================================
CREATE TABLE public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     text,
  email         text,
  headline      text,
  summary       text,
  target_roles  text[] DEFAULT '{}',
  resume_url    text,
  resume_parsed jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_email ON public.profiles(email);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ============================================================
-- TABLE: experiences
-- Work experiences linked to a user profile.
-- ============================================================
CREATE TABLE public.experiences (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company      text NOT NULL,
  title        text NOT NULL,
  start_date   date,
  end_date     date,
  description  text,
  learnings    text,
  impact       text,
  skills       text[] DEFAULT '{}',
  order_index  int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_experiences_profile_id ON public.experiences(profile_id, order_index);

ALTER TABLE public.experiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own experiences"
  ON public.experiences FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own experiences"
  ON public.experiences FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own experiences"
  ON public.experiences FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete own experiences"
  ON public.experiences FOR DELETE
  USING (auth.uid() = profile_id);

-- ============================================================
-- TABLE: applications
-- One row per job the user is applying to.
-- ============================================================
CREATE TABLE public.applications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company     text NOT NULL,
  role        text NOT NULL,
  jd_text     text,
  jd_url      text,
  status      text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'in_progress', 'submitted', 'rejected', 'interview', 'offer')),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_applications_profile_id ON public.applications(profile_id, created_at DESC);
CREATE INDEX idx_applications_status ON public.applications(profile_id, status);

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own applications"
  ON public.applications FOR SELECT
  USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own applications"
  ON public.applications FOR INSERT
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can update own applications"
  ON public.applications FOR UPDATE
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

CREATE POLICY "Users can delete own applications"
  ON public.applications FOR DELETE
  USING (auth.uid() = profile_id);

-- ============================================================
-- TABLE: generated_answers
-- Each answer generated for an application question.
-- ============================================================
CREATE TABLE public.generated_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  question        text NOT NULL,
  answer          text,
  field_selector  text,
  is_final        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_generated_answers_application_id ON public.generated_answers(application_id);

ALTER TABLE public.generated_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own answers"
  ON public.generated_answers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = generated_answers.application_id
        AND a.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own answers"
  ON public.generated_answers FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = generated_answers.application_id
        AND a.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own answers"
  ON public.generated_answers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = generated_answers.application_id
        AND a.profile_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete own answers"
  ON public.generated_answers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.applications a
      WHERE a.id = generated_answers.application_id
        AND a.profile_id = auth.uid()
    )
  );

-- ============================================================
-- TABLE: usage_logs
-- Immutable append-only log of every LLM call for billing.
-- ============================================================
CREATE TABLE public.usage_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tokens_input   int NOT NULL DEFAULT 0,
  tokens_output  int NOT NULL DEFAULT 0,
  model          text NOT NULL,
  cost_usd       numeric(10,6) NOT NULL DEFAULT 0,
  billed_usd     numeric(10,6) NOT NULL DEFAULT 0,
  action_type    text NOT NULL
                   CHECK (action_type IN ('answer_generation', 'cover_letter', 'resume', 'chat', 'classification')),
  metadata       jsonb DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_logs_profile_id_created ON public.usage_logs(profile_id, created_at DESC);
CREATE INDEX idx_usage_logs_model ON public.usage_logs(model, created_at DESC);

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON public.usage_logs FOR SELECT
  USING (auth.uid() = profile_id);

-- ============================================================
-- TRIGGER: auto-update updated_at timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_experiences
  BEFORE UPDATE ON public.experiences
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_applications
  BEFORE UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at_generated_answers
  BEFORE UPDATE ON public.generated_answers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- TRIGGER: auto-create profile on auth.users insert
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    email = COALESCE(EXCLUDED.email, profiles.email),
    updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
