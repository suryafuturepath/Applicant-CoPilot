# Applicant Copilot — Project Context

## Vision
Chrome extension copilot that helps job applicants craft authentic, tailored responses. Not auto-apply — a copilot that works *with* the applicant using their deeply captured experience + target JD context.

## Target User
Job seekers applying to **tech, consulting, and product roles** — tired of repetitive, tedious tailoring across applications.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Extension** | Vanilla JS, Manifest V3, Shadow DOM panel, no build step |
| **Backend** | Supabase (Auth, PostgreSQL + RLS, Storage, Edge Functions) |
| **LLM (Backend)** | Gemini 2.0 Flash (primary) → Groq Llama 3.3 70B (fallback) via Edge Function |
| **LLM (Local)** | 10+ providers via `aiService.js` abstraction (default: Gemini Flash) |
| **Dependencies** | `@supabase/supabase-js`, `pdf.js`, `mammoth.js` |

---

## Architecture

### File Structure
```
extension/
├── manifest.json          # MV3 manifest, <all_urls> content scripts
├── background.js          # Service worker: message router, 11 AI handlers, storage, auth
├── content.js             # Content script: Shadow DOM panel, JD extraction, form detection, autofill, interview prep UI
├── aiService.js           # 10+ provider abstraction, 9 prompt builders, callAI()
├── deterministicMatcher.js # Rule-based field matcher (30+ types, zero AI tokens)
├── supabase-client.js     # Supabase client, session persistence, callEdgeFunction()
├── profile.html/js        # Full-page profile/settings/report UI
├── libs/                  # Vendored libraries (pdf.js, mammoth, supabase-bundle)
```

### Key Data Flows

**Analysis Flow:**
```
User clicks "Analyze Job"
  → expandTruncatedContent() clicks "Show more" (LinkedIn, Workday, Indeed)
  → extractJobDescription() gets full JD via platform selectors or text-density fallback
  → handleDigestJD() → AI creates structured ~500-token digest → cached per URL
  → handleAnalyzeJob() → AI scores match + provides insights using digest + sliced profile
  → Result cached; digest stored on saved job as `jdDigest`
```

**Interview Prep Flow:**
```
User clicks "Prep" on saved job
  → Load jdDigest: cache → savedJob.jdDigest → savedJob.analysis.jdDigest
  → AI generates 10-12 categorized practice questions (behavioral, technical, situational, role-specific)
  → User answers with optional countdown timer
  → AI scores 1-10 with strengths, improvements, sample answer
  → Adaptive follow-ups for weak answers (score < 5)
  → Full-page report with positioning advice after 5+ answers
```

**Edge Function Call Flow:**
```
background.js handler → callEdgeFunction('generate-answer', body)
  → getSession() (auto-refresh if expiring within 120s)
  → fetch(SUPABASE_URL/functions/v1/generate-answer) with Bearer token + apikey
  → Edge Function: validate JWT via getUser() → try Gemini → fallback Groq
  → On failure: catch block logs [EDGE][handler] → falls back to local callAI()
```

### Token Optimization
- **JD digest pipeline**: Raw JD → one AI call → structured ~500-token digest → cached per URL (7-day TTL)
- **Profile slicing**: `sliceProfileForOperation()` sends only relevant fields per operation
- **Deterministic matcher**: 30+ field types handled without AI (name, email, EEO, yes/no, URLs)
- **Server-side cache**: `jd_cache` table with SHA-256 keys, 7-day TTL
- **Projected savings**: ~70% reduction (380K → 115K tokens/month per power user)

---

## Features (all working)

| Feature | Description |
|---------|------------|
| **Job Analysis** | Match score + skill gaps + insights against JD |
| **Ask AI Chat** | In-panel chat with full context (JD + profile + analysis), per-URL persistence |
| **Cover Letter** | Tailored 4-paragraph letter, copy/download |
| **ATS Resume** | 2-phase flow (build with instruction chips → preview + PDF download) |
| **Autofill** | AI-drafted form answers + deterministic field matching |
| **Interview Prep** | Timed practice, AI scoring 1-10, adaptive follow-ups, analytics, full-page report |
| **Save Jobs** | Track jobs with analysis + jdDigest, "Mark Applied" toggle |
| **Configurable Prompts** | 9 editable system prompts in Settings |
| **Token Controls** | 5 budget sliders (resume, analysis, cover letter, chat, interview prep) |
| **JD Expansion** | Auto-clicks "Show more" on LinkedIn/Workday/Indeed before extraction |
| **Diagnostic System** | 4-layer health check (settings, auth, Edge Function, local AI) |

### Platform Support
| Priority | Platform | Status |
|----------|----------|--------|
| P0 | LinkedIn Easy Apply | Working (with JD expansion) |
| P0 | Workday | Working |
| P1 | Greenhouse / Lever | Selectors ready |
| P2 | Indeed / Glassdoor | Selectors ready |
| Any | Unknown ATS | Text-density fallback |

---

## Database Schema

| Table | Purpose | RLS |
|-------|---------|-----|
| `profiles` | User profiles (PK = auth.users.id) | Users own their row |
| `experiences` | Work experience entries | Users own via profile_id |
| `applications` | Job applications tracked | Users own via profile_id |
| `generated_answers` | AI-generated answers per application | Users own via application_id |
| `usage_logs` | Immutable token usage log | Users can read own |
| `jd_cache` | Server-side response cache per JD/operation | Users own via profile_id |

## Edge Function: `generate-answer`

- **Provider chain**: Gemini Flash (primary) → Groq Llama 3.3 70B (fallback)
- **Auth**: JWT validated internally via `getUser()` (gateway `verify_jwt = false` — required for Chrome extension compatibility)
- **Deploy**: `supabase functions deploy generate-answer --no-verify-jwt`
- **Rate limiting**: Disabled during dev (TODO: re-enable at 200/hour before prod)
- **Action types**: `answer_generation`, `cover_letter`, `resume`, `resume_generation`, `jd_digest`, `chat`, `classification`, `interview_prep`
- **Passthrough**: `interview_prep` uses lightweight system prompt (needs JSON output, not career-coach prose)
- **Structured errors**: 502 responses include `provider_errors[]` with per-provider failure details

---

## Development History

| Phase | Date | Summary |
|-------|------|---------|
| **1: Fork & Setup** | 2026-03-26 | Forked JobMatchAI, extension loads, JD extraction, EEO matcher |
| **2: Supabase Backend** | 2026-03-27 | 6 tables + RLS, Edge Function, JWT auth, usage logging |
| **3: Connect to Backend** | 2026-03-27 | Google OAuth, Edge Function routing, fallback to local AI, cover letter, ATS resume, JSON parser |
| **3.5: Token Optimization** | 2026-03-31 | JD digest pipeline, profile slicing, server-side cache, deterministic matcher (30+ types), Groq primary |
| **4: Chat + UX** | 2026-03-31 | Ask AI chat tab, ATS resume redesign (2-phase), Home nav tab |
| **4.5: Configurable Prompts** | 2026-03-31 | 8 editable prompts, token budget sliders, Edge Function prompt fixes |
| **5a: Edge Function Fix** | 2026-04-01 | Root cause: `verify_jwt` gateway rejection. Fixed with `--no-verify-jwt`. 4-layer diagnostic, `[EDGE]` logging on all 11 handlers, action_type on all calls, provider error reporting |
| **5b: Interview Prep + JD** | 2026-04-01 | Interview prep feature (timed practice, scoring, follow-ups, analytics, report). JD expansion (clicks "Show more"). Digest saved with jobs as `jdDigest` for reliable offline access. Token budget fix (2048→4096). JSON format always appended to custom prompts. |

### Remaining Manual Steps
- [ ] Create `resumes` storage bucket in Supabase Dashboard
- [ ] End-to-end integration test (see testplanMVP.md)
- [ ] Re-enable rate limiting before production launch

### Next: Phase 6 — Ship & Scale
- WXT + TypeScript migration
- Server-side prompt management (admin pushes prompts via Supabase table)
- Full Workday field handler port from job_app_filler
- Billing/payment system (Stripe)
- Voice input for onboarding

---

## Conventions

- **Files**: `kebab-case.js` | **Components**: `PascalCase.tsx` | **DB**: `snake_case` | **Constants**: `UPPER_SNAKE_CASE`
- **Git**: Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`), feature branches
- **Prompts**: Dedicated builder functions in `aiService.js`, all accept `promptOverride`
- **Edge Function calls**: Always include `action_type`, logged with `[EDGE]` prefix

## Documentation

| File | Purpose |
|------|---------|
| `PROJECT-CONTEXT.md` | This file — master project document |
| `CLAUDE.md` | Claude Code instructions (condensed reference) |
| `SETUP-GUIDE.md` | Step-by-step local setup |
| `testplanMVP.md` | 15-test MVP test plan |
| `docs/PHASE-5-INTERVIEW-PREP-LEARNINGS.md` | Detailed bug analysis from Phase 5 session |
| `docs/archive/` | Completed planning artifacts |

## Repository
**GitHub**: https://github.com/suryafuturepath/Applicant-CoPilot
