# Implementation Plan: Data Collection Layer + Candidate Scoring

**Overall Progress:** 0%
**Estimated phases:** 5
**Approach:** Data-first: Schema → Consent flow → Local scoring → Activity sync → Ship prep

## TLDR
Add a lean data collection layer that captures JD market intelligence and candidate engagement metrics. Extension computes a "seriousness score" (0-100) locally and syncs it + activity summaries to Supabase. All data collection requires explicit user consent during onboarding. This data feeds a future Recruiter Copilot product (separate dashboard, not part of this extension).

## Key Decisions
- **AI path**: Keep Edge Function as optional fallback, don't strip it yet
- **Score computation**: Local (in extension JS), sync final score to Supabase
- **Consent**: Explicit opt-in during onboarding — nothing syncs without user agreement
- **Recruiter copilot**: Separate future product — we just collect the right data now
- **Privacy**: Anonymize JD intelligence data; candidate data is PII-linked but consent-gated

---

## Data Model

### What we collect

**1. JD Intelligence (market data, anonymized)**
| Field | Source | Example |
|-------|--------|---------|
| role_title | JD digest | "Lead Product Manager" |
| company | JD digest | "Arcana" |
| seniority | JD digest | "senior" |
| tech_stack | JD digest | ["Python", "SQL", "Tableau"] |
| key_requirements | JD digest | ["5+ years PM", "B2B SaaS"] |
| industry | JD digest | "fintech" |
| location | JD digest | "Remote - India" |
| analyzed_at | timestamp | 2026-04-01T12:30:00Z |

**2. Candidate Activity (per user, consent-gated)**
| Field | Source | Purpose |
|-------|--------|---------|
| jobs_analyzed | count | Volume of research |
| jobs_saved | count | Shortlisting behavior |
| jobs_applied | count | Follow-through |
| avg_match_score | computed | Role-fit signal |
| cover_letters_generated | count | Application effort |
| resumes_generated | count | Application effort |
| prep_sessions | count | Interview investment |
| prep_total_time_sec | sum | Time commitment |
| prep_avg_score | avg of AI scores | Preparedness level |
| chat_messages_sent | count | Engagement depth |
| last_active_at | timestamp | Recency |

**3. Candidate Seriousness Score (0-100, computed locally)**

Rules:
| Factor | Weight | Scoring |
|--------|--------|---------|
| Jobs analyzed (last 7 days) | 15% | 0 jobs=0, 1-3=50, 4-7=80, 8+=100 |
| Jobs saved | 10% | 0=0, 1-3=50, 4-10=80, 10+=100 |
| Applied to saved jobs | 15% | ratio: applied/saved × 100 |
| Interview prep sessions | 20% | 0=0, 1=40, 2-3=70, 4+=100 |
| Prep time (total mins) | 15% | 0=0, <15=30, 15-60=70, 60+=100 |
| Prep avg score | 10% | direct map: score×10 (1-10 → 10-100) |
| Cover letters generated | 5% | 0=0, 1-2=60, 3+=100 |
| Resumes generated | 5% | 0=0, 1-2=60, 3+=100 |
| Activity recency | 5% | today=100, <3 days=80, <7=50, >7=20 |

Final score = weighted sum, clamped 0-100.

---

## Phase 1: Supabase Schema
**Goal:** Tables exist for JD intelligence, candidate activity, and scoring
**Files touched:** `supabase/migrations/`, `PROJECT-CONTEXT.md`

- [ ] Step 1.1: Create migration `20260401_add_data_collection_tables.sql`
  - [ ] `jd_intelligence` table (role_title, company, seniority, tech_stack jsonb, key_requirements jsonb, industry, location, analyzed_at, profile_id FK)
  - [ ] `candidate_activity` table (profile_id FK UNIQUE, jobs_analyzed, jobs_saved, jobs_applied, avg_match_score, cover_letters_generated, resumes_generated, prep_sessions, prep_total_time_sec, prep_avg_score, chat_messages_sent, seriousness_score, last_active_at, updated_at)
  - [ ] RLS: users can INSERT/UPDATE their own rows only
  - [ ] `data_consent` column on `profiles` table (boolean, default false)
- [ ] Step 1.2: Run migration via `supabase db push`

**Verify:** Tables visible in Supabase Dashboard → Table Editor

---

## Phase 2: Consent Flow
**Goal:** User explicitly opts in before any data syncs to backend
**Files touched:** `extension/content.js`, `extension/background.js`, `extension/profile.html`, `extension/profile.js`

- [ ] Step 2.1: Add consent banner in extension panel (shown once after sign-in if `data_consent` is false)
  - [ ] Banner text: "Help improve Applicant Copilot — share anonymous usage data to help us build better tools for job seekers. You can opt out anytime in Settings."
  - [ ] Two buttons: "Yes, I'm in" / "No thanks"
  - [ ] Store choice in `chrome.storage.local` as `dataConsent: true/false`
- [ ] Step 2.2: Sync consent to Supabase `profiles.data_consent` when user opts in
- [ ] Step 2.3: Add "Data Sharing" toggle in Profile → Settings (can opt out anytime)
- [ ] Step 2.4: All sync functions check `dataConsent` before sending anything

**Verify:** Sign in → see consent banner → decline → no data syncs. Accept → data starts syncing. Toggle off in settings → syncing stops.

---

## Phase 3: Local Seriousness Score
**Goal:** Extension computes candidate score (0-100) from local activity data
**Files touched:** `extension/background.js`

- [ ] Step 3.1: Add `computeSeriousnessScore()` function in `background.js`
  - [ ] Reads from chrome.storage.local: savedJobs, appliedJobs, interviewPrepSessions, chat history
  - [ ] Applies weighted scoring rules (see Data Model above)
  - [ ] Returns { score: 0-100, factors: { jobsAnalyzed: N, ... } }
- [ ] Step 3.2: Add `COMPUTE_SERIOUSNESS_SCORE` message handler
- [ ] Step 3.3: Recompute score after key actions (analyze job, save job, complete prep, send chat)
- [ ] Step 3.4: Store score in `chrome.storage.local` as `seriousnessScore`

**Verify:** Analyze 3 jobs, save 2, do 1 prep session → score should be ~40-50. Check via service worker console: `chrome.storage.local.get('seriousnessScore')`

---

## Phase 4: Activity Sync to Supabase
**Goal:** Extension syncs activity summary + score to Supabase (consent-gated)
**Files touched:** `extension/background.js`, `extension/supabase-client.js`

- [ ] Step 4.1: Add `syncActivityToSupabase()` function
  - [ ] Check `dataConsent === true` first — abort if false
  - [ ] Upsert to `candidate_activity` table (profile_id, all counts, score, last_active_at)
  - [ ] Fire-and-forget (don't block user actions on sync)
- [ ] Step 4.2: Add `syncJDIntelligence(digest)` function
  - [ ] Check consent → insert to `jd_intelligence` table
  - [ ] Called after every successful `handleDigestJD`
  - [ ] Only sends digest fields (no raw JD, no profile data)
- [ ] Step 4.3: Trigger sync after key actions:
  - [ ] After `handleAnalyzeJob` → sync JD intelligence + recompute & sync activity
  - [ ] After `handleSaveJob` → sync activity
  - [ ] After interview prep session update → sync activity
  - [ ] After cover letter / resume generation → sync activity
- [ ] Step 4.4: Debounce syncs — max once per 30 seconds to avoid hammering Supabase

**Verify:** Opt in → analyze a job → check Supabase `jd_intelligence` table (new row) + `candidate_activity` table (updated counts + score)

---

## Phase 5: Ship Prep (Chrome Web Store readiness)
**Goal:** Extension is ready for Chrome Web Store submission
**Files touched:** Multiple

- [ ] Step 5.1: Add DEBUG flag — wrap all `[EDGE]` console.logs behind `const DEBUG = false`
- [ ] Step 5.2: Re-enable rate limiting in Edge Function (uncomment, set 200/hour)
- [ ] Step 5.3: Delete `dbpassword.txt` and `linearkey.txt` from repo
- [ ] Step 5.4: Create `README.md` (product description, install, dev setup)
- [ ] Step 5.5: Create privacy policy page (can be a GitHub Pages or simple hosted page)
  - [ ] What data is collected (anonymous JD data + opt-in activity metrics)
  - [ ] How it's stored (Supabase, encrypted at rest)
  - [ ] User controls (opt-in/out toggle, data deletion on request)
- [ ] Step 5.6: Bump manifest version to `1.0.0`
- [ ] Step 5.7: Prepare Chrome Web Store assets
  - [ ] 5 screenshots (1280x800): Home, Analysis, Chat, Interview Prep, Settings
  - [ ] Store description (short + detailed)
  - [ ] Category: Productivity
  - [ ] Pricing: $20 one-time / $2.50 monthly
- [ ] Step 5.8: Deploy updated Edge Function with rate limiting
- [ ] Step 5.9: Final E2E test on LinkedIn + one other platform

**Verify:** Full happy path: Install → Sign in → Consent → Analyze → Save → Prep → Check Supabase for synced data

---

## Risks & Watchouts
- **Chrome Web Store review**: Privacy policy must match actual data collection. Mismatches = rejection.
- **Consent UX**: If the banner is too aggressive, users skip it. If too subtle, nobody opts in. Keep it one-time, clear, non-blocking.
- **Storage limits**: `candidate_activity` is one row per user (upsert). `jd_intelligence` grows unbounded — add a retention policy later (e.g., delete >90 days).
- **Score gaming**: Score is computed locally so technically manipulable. For V1 this is fine — the recruiter copilot can add server-side validation later.
- **GDPR/data deletion**: If a user asks to delete their data, you need a way to do it. Add a "Delete my data" button in Settings (Phase 5 stretch goal).

## Out of Scope
- Recruiter copilot dashboard (separate product, later)
- Server-side score recomputation (local-only for V1)
- Advanced analytics/dashboards for the applicant
- Data export functionality
- A/B testing scoring weights
