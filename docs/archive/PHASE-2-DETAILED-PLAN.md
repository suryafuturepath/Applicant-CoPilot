# Phase 2: Supabase Backend Setup — Detailed Engineering Plan

**Owner:** CTO
**Estimated Duration:** 10–13 hours (1.5 working days)
**Prerequisite:** Phase 1 complete (extension loads in Chrome, JD extraction verified)

---

## Critical Decisions Requiring PM Input

Before starting Phase 2, the following decisions need sign-off:

| # | Decision | **PM Call** |
|---|----------|-------------|
| 1 | **Supabase plan** | **Free tier** ✅ — 500K Edge calls/month, 500MB DB |
| 2 | **Google Cloud project** | **New dedicated project** "applicant-copilot-prod" ✅ |
| 3 | **LLM model for Edge Function** | **Gemini Flash (free)** ✅ — $0 cost, user already has API key. Swap to Claude later for better quality. Edge Function is model-agnostic. |
| 4 | **Rate limiting** | **50 req/user/hour** ✅ |
| 5 | **Free tier for users** | **$2 in free credits** (~unlimited with Gemini free tier) ✅ |

---

## Dependency Graph

```
2.1 Create Supabase Project
 │
 ├──→ 2.2 Database Migration (needs project to exist)
 │     │
 │     └──→ 2.3a Auth Trigger (needs profiles table)
 │
 ├──→ 2.3 Auth Setup (needs project for dashboard config)
 │     │
 │     └──→ 2.3a Auth Trigger (needs auth configured)
 │
 ├──→ 2.4 Storage Setup (needs project to exist)
 │
 └──→ 2.5 Edge Function (needs project + tables + ANTHROPIC_API_KEY secret)
       │
       └──→ 2.6 End-to-End Test (needs everything above)

Parallelism:
  2.2 | 2.3 | 2.4  — can all run in parallel after 2.1 completes
  2.3a              — must wait for both 2.2 AND 2.3
  2.5               — must wait for 2.2 (needs usage_logs table) but can start structure before
  2.6               — must wait for all of 2.2, 2.3, 2.3a, 2.4, 2.5
```

**Visual:**
```
2.1 ──┬──→ 2.2 ──┬──→ 2.3a ──┐
      │          │            │
      ├──→ 2.3 ──┘            ├──→ 2.6
      │                       │
      ├──→ 2.4 ───────────────┤
      │                       │
      └──→ 2.5 ───────────────┘
```

---

## Task 2.1: Create Supabase Project

**Time estimate:** 0.5 hours
**Blocks:** Everything else

### Steps

1. Install Supabase CLI (if not already installed):
   ```bash
   brew install supabase/tap/supabase
   supabase --version  # verify >= 1.200.0
   ```

2. Initialize local Supabase config:
   ```bash
   cd /Users/surya/Documents/Programs/Applicant\ Copilot
   supabase init
   ```
   This creates `supabase/config.toml` and the `supabase/` directory structure.

3. Create remote project via Supabase Dashboard (https://supabase.com/dashboard):
   - Organization: Create or select one
   - Project name: `applicant-copilot`
   - Database password: Generate strong password, save in password manager
   - Region: `us-east-1` (lowest latency to Anthropic API which is also US-based)
   - Plan: Free (per PM decision)

4. Link local project to remote:
   ```bash
   supabase link --project-ref <PROJECT_REF>
   # PROJECT_REF is the random string in your Supabase URL: https://<PROJECT_REF>.supabase.co
   ```

5. Create `.env` in project root (already gitignored):
   ```env
   SUPABASE_URL=https://<PROJECT_REF>.supabase.co
   SUPABASE_ANON_KEY=<anon-key-from-dashboard>
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-dashboard>
   ANTHROPIC_API_KEY=sk-ant-...
   ```

6. Store the Anthropic API key as a Supabase secret (for Edge Functions):
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   ```

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| CLI version mismatch with remote | Low | Medium | Pin CLI version in README; `supabase --version` check |
| Wrong region selected | Low | Low | Can't change after creation; would need new project. Decide region first |
| Credentials leaked to git | Medium | Critical | `.env` in `.gitignore` BEFORE creating `.env`; verify with `git status` |

### Verification
```bash
# Verify CLI linked correctly
supabase status

# Verify remote connection
supabase db remote list

# Verify secrets stored
supabase secrets list
# Should show ANTHROPIC_API_KEY (value hidden)
```

---

## Task 2.2: Database Migration — Create Tables

**Time estimate:** 2 hours
**Depends on:** 2.1
**Blocks:** 2.3a, 2.5, 2.6

### Steps

1. Create migration file:
   ```bash
   supabase migration new initial_schema
   # Creates supabase/migrations/<timestamp>_initial_schema.sql
   ```

2. Write the migration SQL:

```sql
-- ============================================================
-- Migration: initial_schema
-- Description: Core tables for Applicant Copilot MVP
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

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

-- Index: look up profile by email (for admin queries, dedup checks)
CREATE INDEX idx_profiles_email ON public.profiles(email);

-- RLS: users can only see and modify their own profile
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

-- No DELETE policy: users cannot delete their profile directly (use auth deletion)

-- ============================================================
-- TABLE: experiences
-- Work experiences linked to a user profile.
-- ============================================================
CREATE TABLE public.experiences (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company      text NOT NULL,
  title        text NOT NULL,
  start_date   date,
  end_date     date,           -- NULL if current role
  description  text,
  learnings    text,
  impact       text,
  skills       text[] DEFAULT '{}',
  order_index  int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Index: fetch all experiences for a profile, ordered
CREATE INDEX idx_experiences_profile_id ON public.experiences(profile_id, order_index);

-- RLS
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
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
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

-- Index: fetch applications for a profile, most recent first
CREATE INDEX idx_applications_profile_id ON public.applications(profile_id, created_at DESC);

-- Index: filter by status
CREATE INDEX idx_applications_status ON public.applications(profile_id, status);

-- RLS
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
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  question        text NOT NULL,
  answer          text,
  field_selector  text,           -- DOM selector for auto-fill
  is_final        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Index: fetch answers for an application
CREATE INDEX idx_generated_answers_application_id ON public.generated_answers(application_id);

-- RLS: access controlled through the parent application's profile_id
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
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  tokens_input   int NOT NULL DEFAULT 0,
  tokens_output  int NOT NULL DEFAULT 0,
  model          text NOT NULL,
  cost_usd       numeric(10,6) NOT NULL DEFAULT 0,
  billed_usd     numeric(10,6) NOT NULL DEFAULT 0,
  action_type    text NOT NULL
                   CHECK (action_type IN ('answer_generation', 'cover_letter', 'resume', 'chat', 'classification')),
  metadata       jsonb DEFAULT '{}'::jsonb,  -- extra context (question snippet, application_id, etc.)
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Index: billing queries — sum costs for a user in a date range
CREATE INDEX idx_usage_logs_profile_id_created ON public.usage_logs(profile_id, created_at DESC);

-- Index: aggregate by model for cost analysis
CREATE INDEX idx_usage_logs_model ON public.usage_logs(model, created_at DESC);

-- RLS: users can read their own usage, but CANNOT insert/update/delete directly.
-- Only the service_role (Edge Functions) can write to this table.
ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON public.usage_logs FOR SELECT
  USING (auth.uid() = profile_id);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated roles.
-- Edge Functions use the service_role key which bypasses RLS.

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

-- This trigger fires on the auth schema, so it needs SECURITY DEFINER
-- to be able to insert into public.profiles.
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

3. Apply the migration:
   ```bash
   # Push to remote Supabase project
   supabase db push

   # Or if testing locally first:
   supabase start            # starts local Supabase (Docker required)
   supabase db reset          # applies all migrations from scratch
   ```

### Design Decisions Explained

**Why `ON CONFLICT DO UPDATE` in handle_new_user():**
- Google OAuth can trigger duplicate inserts if the user signs up, deletes account, re-signs up with the same Google account. The `ON CONFLICT` clause handles this gracefully instead of crashing.

**Why usage_logs has no user-writable RLS policies:**
- Usage logs are billing data. They must only be written by the server (Edge Functions using service_role key). If a client could INSERT, they could forge zero-cost entries and get free usage.

**Why generated_answers RLS uses a subquery on applications:**
- generated_answers doesn't have a direct profile_id column. The ownership chain is: user -> applications -> generated_answers. The subquery enforces this chain.

**Why metadata jsonb on usage_logs:**
- Future-proofing. We'll want to attach application_id, question snippet, etc. for debugging and analytics without schema changes.

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| auth.users trigger fails on migration | Medium | High | The trigger on `auth.users` requires the migration to run with sufficient privileges. `supabase db push` runs as superuser so this should work. If not, create the trigger via Supabase Dashboard SQL Editor |
| RLS subquery on generated_answers is slow | Low | Medium | The subquery hits `applications` by PK with a WHERE on `profile_id` — both indexed. For MVP volumes this is instant. Add a denormalized `profile_id` column later if needed |
| ON CONFLICT on profiles fails with partial unique index | Low | Medium | `id` is the PK so ON CONFLICT (id) is unambiguous |

### Verification
```bash
# Verify tables exist
supabase db remote list

# Or via psql / Supabase SQL Editor:
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
-- Expected: applications, experiences, generated_answers, profiles, usage_logs

# Verify RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public';
-- All should show rowsecurity = true

# Verify trigger exists
SELECT trigger_name, event_object_table FROM information_schema.triggers
WHERE trigger_schema IN ('public', 'auth');
-- Expected: on_auth_user_created on auth.users, set_updated_at_* on each table

# Test RLS: as anon user, try to read profiles (should return empty)
# In Supabase Dashboard > SQL Editor:
SET request.jwt.claims TO '{"sub": "00000000-0000-0000-0000-000000000000", "role": "authenticated"}';
SELECT * FROM public.profiles;  -- should return 0 rows
```

---

## Task 2.3: Auth Setup (Google OAuth)

**Time estimate:** 1.5 hours
**Depends on:** 2.1
**Blocks:** 2.3a (trigger relies on auth working), 2.6

### Steps

#### A. Google Cloud Console Setup

1. Go to https://console.cloud.google.com
2. Create new project: `applicant-copilot-prod` (or per PM decision)
3. Enable the **Google Identity** API:
   - APIs & Services > Library > search "Google Identity" > Enable
4. Create OAuth consent screen:
   - APIs & Services > OAuth consent screen
   - User type: **External** (for beta, switch to Internal if using Google Workspace)
   - App name: "Applicant Copilot"
   - User support email: your email
   - Authorized domains: `supabase.co` (add your custom domain later)
   - Scopes: `email`, `profile`, `openid`
   - Test users: add your own email (required while in "Testing" status)
5. Create OAuth credentials:
   - APIs & Services > Credentials > Create Credentials > OAuth 2.0 Client ID
   - Application type: **Web application**
   - Name: "Applicant Copilot - Supabase"
   - Authorized redirect URIs: `https://<PROJECT_REF>.supabase.co/auth/v1/callback`
   - Save the **Client ID** and **Client Secret**

#### B. Supabase Dashboard Configuration

1. Go to Supabase Dashboard > Authentication > Providers
2. Enable **Google** provider:
   - Client ID: paste from GCP
   - Client Secret: paste from GCP
   - Authorized Client IDs: leave blank (or add Chrome extension client ID if using chrome.identity)
3. Enable **Email** provider (fallback):
   - Enable email confirmations: **Yes** for production, **No** for development (faster testing)
   - Minimum password length: 8
4. Authentication > URL Configuration:
   - Site URL: `chrome-extension://<EXTENSION_ID>` (get from chrome://extensions after loading)
   - Redirect URLs: Add `chrome-extension://<EXTENSION_ID>` and `https://<PROJECT_REF>.supabase.co/auth/v1/callback`

#### C. Chrome Extension OAuth Considerations

The standard `supabase.auth.signInWithOAuth()` opens a browser tab for the OAuth flow, which works for extensions. However, there's a subtlety:

- **Option A (simpler):** Use tab-based flow. Extension calls `signInWithOAuth({ provider: 'google' })`, which opens a new tab. After auth, Supabase redirects to the Site URL (the extension). The extension's background.js listens for the redirect and extracts the session tokens from the URL hash.

- **Option B (smoother UX):** Use `chrome.identity.launchWebAuthFlow()` with the Supabase OAuth URL. This opens a popup instead of a tab. Requires `identity` permission in manifest.json.

**Recommendation:** Start with Option A (tab-based). It requires zero manifest changes and is guaranteed to work. Migrate to Option B in polish phase if the UX feels clunky.

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Google OAuth consent screen stuck in "Testing" (only test users can sign in) | Medium | Medium | Add all beta testers as test users; apply for verification when ready for public launch |
| Redirect URI mismatch causes "redirect_uri_mismatch" error | High | Medium | Triple-check the redirect URI matches exactly between GCP and Supabase. Most common Phase 2 bug |
| Chrome extension ID changes between loads | Medium | Medium | The ID is deterministic from the `key` field in manifest.json. Pin it by adding a `key` field, or use a wildcard redirect |
| Session tokens lost when service worker goes idle | Medium | High | Store tokens in `chrome.storage.local` on auth state change, re-hydrate on service worker wake |

### Verification
```bash
# Test via curl — get the OAuth redirect URL
curl -s "https://<PROJECT_REF>.supabase.co/auth/v1/authorize?provider=google&redirect_to=https://<PROJECT_REF>.supabase.co" -o /dev/null -w "%{redirect_url}"
# Should redirect to accounts.google.com with correct client_id

# Test email signup
curl -X POST "https://<PROJECT_REF>.supabase.co/auth/v1/signup" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpassword123"}'
# Should return 200 with user object

# Verify the profile trigger fired — check profiles table
curl -X GET "https://<PROJECT_REF>.supabase.co/rest/v1/profiles?select=*" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ACCESS_TOKEN_FROM_SIGNUP>"
# Should return the newly created profile row
```

---

## Task 2.3a: Auth Trigger Verification

**Time estimate:** 0.5 hours
**Depends on:** 2.2 + 2.3
**Blocks:** 2.6

This is not a separate implementation task — the trigger SQL is in 2.2. This task is specifically about **verifying** the trigger works with real auth events.

### Steps

1. Sign up a test user via email (using the curl command from 2.3 verification)
2. Check the `profiles` table has a new row with matching `id`, `full_name`, and `email`
3. Sign up a second user via Google OAuth (manual browser test)
4. Verify profile row created with Google display name populated
5. Edge case: delete the test user from Supabase Dashboard > Authentication > Users, then re-signup with same email. Verify `ON CONFLICT` updates the profile instead of crashing.

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Trigger fires but `raw_user_meta_data` is empty for email signups | Medium | Low | The COALESCE chain falls back to empty string. Profile still created, just with blank name. User fills in name during onboarding |
| Google OAuth metadata field names differ from expected (`full_name` vs `name`) | Medium | Low | The trigger COALESCEs both `full_name` and `name`. Google uses `full_name` in most cases |

### Verification
```sql
-- In Supabase SQL Editor after test signups:
SELECT id, full_name, email, created_at FROM public.profiles;
-- Should show rows matching auth.users entries
```

---

## Task 2.4: Storage Setup (Resume Uploads)

**Time estimate:** 0.5 hours
**Depends on:** 2.1
**Blocks:** 2.6

### Steps

1. Create the `resumes` bucket via Supabase Dashboard > Storage > New Bucket:
   - Name: `resumes`
   - Public: **No** (private bucket)
   - File size limit: `10485760` (10 MB)
   - Allowed MIME types: `application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document` (PDF and DOCX)

2. Create storage policies via SQL (add to a new migration or run in SQL Editor):

```sql
-- ============================================================
-- STORAGE POLICIES: resumes bucket
-- ============================================================

-- Users can upload to their own folder: resumes/{user_id}/*
CREATE POLICY "Users can upload own resumes"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can read their own resumes
CREATE POLICY "Users can read own resumes"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can update (replace) their own resumes
CREATE POLICY "Users can update own resumes"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Users can delete their own resumes
CREATE POLICY "Users can delete own resumes"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resumes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

3. Expected upload path pattern: `resumes/{user_id}/resume.pdf`

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `storage.foldername()` function not available | Low | Medium | This is a Supabase built-in. If missing, use `split_part(name, '/', 1)` instead |
| Large DOCX files with embedded images exceed 10 MB | Low | Low | Show user-friendly error: "Resume too large. Try removing images or saving as PDF" |
| MIME type check blocks valid PDFs with wrong Content-Type | Low | Low | Extension should explicitly set Content-Type header when uploading |

### Verification
```bash
# Upload a test file (requires auth token from a signed-in user)
curl -X POST "https://<PROJECT_REF>.supabase.co/storage/v1/object/resumes/<USER_ID>/test.pdf" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H "Content-Type: application/pdf" \
  --data-binary @/path/to/test.pdf
# Should return 200

# Try to read another user's file (should fail)
curl -X GET "https://<PROJECT_REF>.supabase.co/storage/v1/object/resumes/<OTHER_USER_ID>/test.pdf" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
# Should return 400 or 404

# Download own file
curl -X GET "https://<PROJECT_REF>.supabase.co/storage/v1/object/resumes/<USER_ID>/test.pdf" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -o downloaded.pdf
# Should succeed
```

---

## Task 2.5: LLM Proxy Edge Function

**Time estimate:** 4 hours (largest task)
**Depends on:** 2.1, 2.2 (needs usage_logs table)
**Blocks:** 2.6

### Steps

1. Create the function scaffold:
   ```bash
   supabase functions new generate-answer
   # Creates supabase/functions/generate-answer/index.ts
   ```

2. Write the Edge Function:

**File: `supabase/functions/generate-answer/index.ts`**

```typescript
// supabase/functions/generate-answer/index.ts
//
// LLM proxy Edge Function for Applicant Copilot.
// Accepts a question + context, calls Claude, logs usage, returns answer.
//
// Deno runtime — uses Deno.serve(), Web Fetch API, and Supabase client.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Types ──────────────────────────────────────────────────────────

interface RequestBody {
  question: string;
  jd_text?: string;
  jd_company?: string;
  jd_role?: string;
  user_profile?: {
    full_name?: string;
    headline?: string;
    summary?: string;
    target_roles?: string[];
    experiences?: Array<{
      company: string;
      title: string;
      description?: string;
      impact?: string;
      skills?: string[];
    }>;
  };
  application_id?: string;
  model?: string;
  max_tokens?: number;
}

interface AnthropicResponse {
  id: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Constants ──────────────────────────────────────────────────────

const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS_DEFAULT = 1024;
const MARGIN_MULTIPLIER = 1.18; // 18% margin on token cost

// Pricing per million tokens (as of 2025 — update as needed)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-3-5-20241022": { input: 0.80, output: 4.0 },
};

// Rate limit: tracked per user via usage_logs count in the last hour
const MAX_REQUESTS_PER_HOUR = 50;

// ─── CORS headers ───────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",  // Tighten to extension origin in production
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ─── Helper: Build system prompt ────────────────────────────────────

function buildSystemPrompt(
  profile: RequestBody["user_profile"],
  jdCompany?: string,
  jdRole?: string,
  jdText?: string
): string {
  let prompt = `You are an expert career coach and application assistant for a job applicant. Your role is to help craft authentic, tailored answers to job application questions.

IMPORTANT GUIDELINES:
- Write in first person as if you ARE the applicant
- Reference specific experiences and achievements from the applicant's profile
- Tailor the answer to the specific job and company
- Be professional but authentic — avoid generic corporate speak
- Keep answers concise (100-200 words) unless the question clearly requires more
- Never fabricate experiences or skills not in the profile
- If the profile lacks relevant experience for the question, acknowledge it honestly and pivot to transferable skills`;

  if (profile) {
    prompt += `\n\n--- APPLICANT PROFILE ---`;
    if (profile.full_name) prompt += `\nName: ${profile.full_name}`;
    if (profile.headline) prompt += `\nHeadline: ${profile.headline}`;
    if (profile.summary) prompt += `\nSummary: ${profile.summary}`;
    if (profile.target_roles?.length) {
      prompt += `\nTarget Roles: ${profile.target_roles.join(", ")}`;
    }
    if (profile.experiences?.length) {
      prompt += `\n\nWORK EXPERIENCE:`;
      for (const exp of profile.experiences) {
        prompt += `\n- ${exp.title} at ${exp.company}`;
        if (exp.description) prompt += `\n  ${exp.description}`;
        if (exp.impact) prompt += `\n  Impact: ${exp.impact}`;
        if (exp.skills?.length) prompt += `\n  Skills: ${exp.skills.join(", ")}`;
      }
    }
  }

  if (jdCompany || jdRole || jdText) {
    prompt += `\n\n--- TARGET JOB ---`;
    if (jdCompany) prompt += `\nCompany: ${jdCompany}`;
    if (jdRole) prompt += `\nRole: ${jdRole}`;
    if (jdText) prompt += `\nJob Description:\n${jdText}`;
  }

  return prompt;
}

// ─── Helper: Calculate cost ─────────────────────────────────────────

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): { cost_usd: number; billed_usd: number } {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL];
  const cost_usd =
    (inputTokens * pricing.input) / 1_000_000 +
    (outputTokens * pricing.output) / 1_000_000;
  const billed_usd = cost_usd * MARGIN_MULTIPLIER;
  return {
    cost_usd: Math.round(cost_usd * 1_000_000) / 1_000_000, // 6 decimal places
    billed_usd: Math.round(billed_usd * 1_000_000) / 1_000_000,
  };
}

// ─── Main handler ───────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // ── Auth: extract user from JWT ──────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Missing or invalid authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create a Supabase client with the user's JWT to enforce RLS
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized", detail: authError?.message }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Rate limit check ─────────────────────────────────────────────
    // Use service role client for usage_logs (user can't write to it)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentRequests, error: countError } = await serviceClient
      .from("usage_logs")
      .select("*", { count: "exact", head: true })
      .eq("profile_id", user.id)
      .gte("created_at", oneHourAgo);

    if (countError) {
      console.error("Rate limit check failed:", countError);
      // Don't block the request on rate limit check failure — fail open
    } else if (recentRequests !== null && recentRequests >= MAX_REQUESTS_PER_HOUR) {
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded",
          detail: `Maximum ${MAX_REQUESTS_PER_HOUR} requests per hour. Try again later.`,
          retry_after_seconds: 3600,
        }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Parse request body ───────────────────────────────────────────
    const body: RequestBody = await req.json();

    if (!body.question || typeof body.question !== "string" || body.question.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing required field: question" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const model = body.model || DEFAULT_MODEL;
    const maxTokens = Math.min(body.max_tokens || MAX_TOKENS_DEFAULT, 4096);

    // ── Build prompt and call Anthropic ──────────────────────────────
    const systemPrompt = buildSystemPrompt(
      body.user_profile,
      body.jd_company,
      body.jd_role,
      body.jd_text
    );

    const anthropicApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicApiKey) {
      console.error("ANTHROPIC_API_KEY not configured");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: body.question,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!anthropicResponse.ok) {
      const errorBody = await anthropicResponse.text();
      console.error(`Anthropic API error: ${anthropicResponse.status}`, errorBody);

      // Pass through rate limit from Anthropic
      if (anthropicResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI provider rate limited. Try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ error: "AI generation failed. Please try again." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result: AnthropicResponse = await anthropicResponse.json();
    const answerText = result.content?.[0]?.text || "";

    // ── Log usage (atomic — must not fail silently) ──────────────────
    const { cost_usd, billed_usd } = calculateCost(
      model,
      result.usage.input_tokens,
      result.usage.output_tokens
    );

    const { error: logError } = await serviceClient.from("usage_logs").insert({
      profile_id: user.id,
      tokens_input: result.usage.input_tokens,
      tokens_output: result.usage.output_tokens,
      model: result.model,
      cost_usd,
      billed_usd,
      action_type: "answer_generation",
      metadata: {
        question_preview: body.question.substring(0, 100),
        application_id: body.application_id || null,
      },
    });

    if (logError) {
      // CRITICAL: Usage logging failed. Log to console for monitoring.
      // Do NOT fail the request — the user already got their answer.
      // Set up alerting on this log line in production.
      console.error("CRITICAL: Usage log insert failed:", logError);
    }

    // ── Return response ──────────────────────────────────────────────
    return new Response(
      JSON.stringify({
        answer: answerText,
        model: result.model,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cost_usd,
          billed_usd,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Unhandled error in generate-answer:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

3. Deploy the function:
   ```bash
   supabase functions deploy generate-answer --no-verify-jwt
   ```
   **Note:** We pass `--no-verify-jwt` because we handle JWT verification manually inside the function (we need both user client and service client). Supabase's built-in JWT verification would prevent the service client from working correctly. Our manual verification is equivalent.

   **Actually, correction:** The built-in JWT verification just checks the Authorization header is a valid Supabase JWT. We still want that. Remove `--no-verify-jwt`:
   ```bash
   supabase functions deploy generate-answer
   ```

4. Verify the function is deployed:
   ```bash
   supabase functions list
   # Should show: generate-answer | Active
   ```

### Design Decisions Explained

**Why service_role key for usage logging:**
- usage_logs has no INSERT policy for authenticated users (by design — billing data). The Edge Function runs as a trusted server, so it uses the service_role key to bypass RLS and write the log entry.

**Why fail-open on rate limit check errors:**
- If the rate limit query fails (DB timeout, etc.), we'd rather serve the request than block a paying user. The risk is a few extra unthrottled requests, not data loss.

**Why fail-soft on usage log errors:**
- The user already received their AI answer. Failing the HTTP response would confuse them ("error" but they see no answer). Instead, log the failure as CRITICAL and set up monitoring. Lost billing data is recoverable from Anthropic's usage dashboard.

**Why manual system prompt construction (not a template file):**
- For MVP, the prompt is simple enough to live in the function. In Phase 5 we'll extract prompts to a shared module when we add cover letter / resume functions.

**Why CORS `*` origin:**
- Chrome extensions don't send an Origin header for fetch requests from the background service worker. A restrictive CORS policy would only matter for browser-tab-initiated requests. Tighten this when we add a web dashboard.

### Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Edge Function cold start takes 3-5s | High | Medium | Acceptable for MVP. Show loading spinner in UI. Supabase Pro reduces cold starts. Consider warming via cron in production |
| Anthropic API key quota exceeded | Low | High | Set up Anthropic usage alerts. Edge Function returns 502 with user-friendly message |
| Token cost calculation becomes stale (Anthropic changes pricing) | Medium | Medium | MODEL_PRICING is a constant — update on pricing changes. Add a TODO to fetch pricing dynamically later |
| Large JD text causes prompt to exceed context window | Low | Medium | Claude Sonnet has 200K context. A JD is ~2K tokens max. Not a concern for MVP |
| Supabase Edge Function 60s timeout | Low | Medium | Claude Sonnet typically responds in 2-10s. Only at risk if Anthropic is slow. The 60s Supabase timeout is sufficient |
| Service role key exposed in Edge Function env | Low | Critical | Supabase Edge Functions run server-side. The key is in Deno.env, never sent to the client. This is the intended pattern |

### Verification
```bash
# 1. Get an auth token (sign in first)
AUTH_RESPONSE=$(curl -s -X POST "https://<PROJECT_REF>.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpassword123"}')

ACCESS_TOKEN=$(echo $AUTH_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Call the Edge Function
curl -s -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/generate-answer" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Why do you want to work at Google?",
    "jd_company": "Google",
    "jd_role": "Software Engineer",
    "jd_text": "We are looking for a software engineer to work on Google Search infrastructure.",
    "user_profile": {
      "full_name": "Test User",
      "headline": "Full-Stack Engineer",
      "summary": "5 years of experience building web applications",
      "experiences": [{
        "company": "Startup Inc",
        "title": "Senior Engineer",
        "description": "Built search infrastructure handling 1M queries/day",
        "impact": "Reduced latency by 40%",
        "skills": ["Python", "Go", "Elasticsearch"]
      }]
    }
  }' | python3 -m json.tool

# Expected response:
# {
#   "answer": "...(tailored answer text)...",
#   "model": "claude-sonnet-4-20250514",
#   "usage": {
#     "input_tokens": ~500,
#     "output_tokens": ~200,
#     "cost_usd": 0.004500,
#     "billed_usd": 0.005310
#   }
# }

# 3. Verify usage log was created
curl -s "https://<PROJECT_REF>.supabase.co/rest/v1/usage_logs?select=*&order=created_at.desc&limit=1" \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | python3 -m json.tool

# Should return 1 row with matching tokens/cost

# 4. Test error cases:
# Missing question
curl -s -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/generate-answer" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | python3 -m json.tool
# Expected: 400, "Missing required field: question"

# No auth header
curl -s -X POST "https://<PROJECT_REF>.supabase.co/functions/v1/generate-answer" \
  -H "Content-Type: application/json" \
  -d '{"question": "test"}' | python3 -m json.tool
# Expected: 401, "Missing or invalid authorization header"
```

---

## Task 2.6: End-to-End Integration Test

**Time estimate:** 1 hour
**Depends on:** All of 2.1–2.5

### Steps

This is a manual integration test that exercises the entire backend:

1. **Sign up** a new user via email:
   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/auth/v1/signup" \
     -H "apikey: <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"email": "e2e-test@example.com", "password": "e2eTestPass123!"}'
   ```

2. **Verify profile trigger**: Check profiles table has the new user.

3. **Sign in** and get access token:
   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/auth/v1/token?grant_type=password" \
     -H "apikey: <ANON_KEY>" \
     -H "Content-Type: application/json" \
     -d '{"email": "e2e-test@example.com", "password": "e2eTestPass123!"}'
   ```

4. **Update profile**:
   ```bash
   curl -X PATCH "https://<PROJECT_REF>.supabase.co/rest/v1/profiles?id=eq.<USER_ID>" \
     -H "apikey: <ANON_KEY>" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"full_name": "E2E Test User", "headline": "Software Engineer"}'
   ```

5. **Create an application**:
   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/rest/v1/applications" \
     -H "apikey: <ANON_KEY>" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -H "Prefer: return=representation" \
     -d '{"profile_id": "<USER_ID>", "company": "Google", "role": "SWE", "jd_text": "Looking for SWE..."}'
   ```

6. **Generate an answer** via Edge Function (full curl from 2.5 verification).

7. **Upload a test resume** to storage:
   ```bash
   curl -X POST "https://<PROJECT_REF>.supabase.co/storage/v1/object/resumes/<USER_ID>/test-resume.pdf" \
     -H "apikey: <ANON_KEY>" \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/pdf" \
     --data-binary @test-resume.pdf
   ```

8. **Verify RLS isolation**: Create a second user. Verify user 2 cannot see user 1's profile, applications, or usage logs.

9. **Verify rate limiting**: Send 51 rapid requests to the Edge Function. The 51st should return 429.

### Pass Criteria
- [ ] Signup creates user + profile row
- [ ] Profile update works (RLS allows own row)
- [ ] Application insert works (RLS allows own row)
- [ ] Edge Function returns a generated answer
- [ ] usage_logs row created with correct token counts and cost
- [ ] Resume upload to own path succeeds
- [ ] Resume upload to another user's path fails
- [ ] Second user cannot read first user's data
- [ ] Rate limit kicks in at 51st request

---

## Environment Variables Summary

| Variable | Where Used | How Set | Value Source |
|----------|-----------|---------|--------------|
| `SUPABASE_URL` | Extension, Edge Functions | `.env` file (extension), auto-injected (Edge Functions) | Supabase Dashboard > Settings > API |
| `SUPABASE_ANON_KEY` | Extension, Edge Functions | `.env` file (extension), auto-injected (Edge Functions) | Supabase Dashboard > Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Functions only | Auto-injected by Supabase runtime | Supabase Dashboard > Settings > API. NEVER put in extension code |
| `ANTHROPIC_API_KEY` | Edge Functions only | `supabase secrets set` | Anthropic Console > API Keys |
| `GOOGLE_CLIENT_ID` | Supabase Auth config | Supabase Dashboard > Auth > Providers | Google Cloud Console > Credentials |
| `GOOGLE_CLIENT_SECRET` | Supabase Auth config | Supabase Dashboard > Auth > Providers | Google Cloud Console > Credentials |

---

## Time Estimate Summary

| Task | Hours | Depends On | Can Parallel With |
|------|-------|-----------|-------------------|
| 2.1 Create Supabase Project | 0.5h | Phase 1 | — |
| 2.2 Database Migration | 2.0h | 2.1 | 2.3, 2.4 |
| 2.3 Auth Setup (Google OAuth) | 1.5h | 2.1 | 2.2, 2.4 |
| 2.3a Auth Trigger Verification | 0.5h | 2.2 + 2.3 | — |
| 2.4 Storage Setup | 0.5h | 2.1 | 2.2, 2.3 |
| 2.5 Edge Function | 4.0h | 2.1 + 2.2 | 2.3, 2.4 (partially) |
| 2.6 E2E Integration Test | 1.0h | All above | — |
| **Buffer (debugging, auth quirks)** | **2.0h** | — | — |
| **Total** | **12.0h** | | |

**Critical path:** 2.1 (0.5h) → 2.2 (2h) → 2.5 (4h) → 2.6 (1h) = **7.5 hours minimum**
**With parallel work:** Auth + Storage happen during DB migration writing, so real elapsed time is closer to **8-10 hours**.

---

## Post-Phase-2 Checklist

Before moving to Phase 3 (Connect Extension to Backend), verify:

- [ ] `supabase status` shows healthy connection
- [ ] All 5 tables exist with RLS enabled
- [ ] Auth trigger creates profile on signup (tested with email + Google)
- [ ] Storage bucket accepts PDF/DOCX uploads with correct RLS
- [ ] Edge Function deployed and returns AI-generated answers
- [ ] Usage logging works (row created per request with correct costs)
- [ ] Rate limiting works (429 after threshold)
- [ ] RLS isolation verified (user A cannot see user B's data)
- [ ] All secrets stored (`supabase secrets list` shows ANTHROPIC_API_KEY)
- [ ] `.env` file exists locally and is gitignored
