# Applicant Copilot — Project Context

**Last updated:** 2026-04-13
**Version:** 1.0.0 — Phase 9.6 complete. Preparing for Chrome Web Store submission.

---

## Vision

Chrome extension copilot that helps job applicants craft authentic, tailored applications. **Not auto-apply** — a copilot that works *with* the applicant, grounded in their deeply captured experience profile and the target job's context.

## Target user

Candidates applying to **tech, consulting, and product roles** who are tired of repetitive tailoring across applications.

---

## Tech stack

| Layer | Technology |
|---|---|
| Extension | Vanilla JS, Manifest V3, Shadow DOM panel, modular ESM under `src/`, esbuild bundler |
| Backend | Supabase (Auth, PostgreSQL + RLS, Storage, Edge Functions) |
| Backend LLM | Gemini 2.0 Flash (primary) → Groq Llama 3.3 70B (fallback) via Edge Function |
| Local LLM | 10+ providers via `aiService.js` (default: Gemini Flash) |
| Document parsing | pdf.js (WASM), mammoth.js |
| Design | "Organic Archive" sage design system, Manrope font, Material Symbols Outlined icons |

---

## Architecture

### Repository layout

```
Applicant Copilot/
├── extension/                   # The Chrome extension
│   ├── manifest.json            # MV3 manifest (version 1.0.0, <all_urls> content script)
│   ├── background.js            # Service worker: ~30 message handlers, LinkedIn scraper, Supabase proxy
│   ├── content.js               # Content script bundle (built from src/)
│   ├── aiService.js             # 10-provider abstraction, 9 prompt builders, callAI()
│   ├── deterministicMatcher.js  # Regex field matcher (30+ types, zero AI)
│   ├── keywordMatcher.js        # Legacy keyword matcher (auto-scan uses src/auto-scan/)
│   ├── supabase-client.js       # Supabase singleton, session persistence, callEdgeFunction()
│   ├── profile.html / profile.js # Full-page profile & settings UI
│   ├── styles.css               # Extension-wide host-page styles
│   ├── fonts/                   # Manrope + Material Symbols (self-hosted woff2)
│   ├── icons/                   # 16/48/128 px extension icons
│   ├── libs/                    # Vendored: pdf.js, mammoth.js, supabase-bundle
│   └── src/                     # Modular ESM (see FSD §2 for full tree)
│       ├── content-main.js, messaging.js, state.js, utils.js
│       ├── panel/               # Side panel (Shadow DOM) — 3 bottom tabs
│       ├── features/            # analysis, chat, cover-letter, ats-resume, interview-prep, save-applied, saved-jobs
│       ├── autofill/            # autofill pipeline, field detection, fill strategies, badges, inline chips
│       ├── auto-scan/           # ambient match-score widget
│       ├── platform/            # JD extraction per-platform + SPA monitor
│       └── storage/             # analysis-cache, job-notes
├── supabase/
│   ├── config.toml
│   ├── migrations/              # 6 SQL migrations
│   └── functions/generate-answer/index.ts  # Deno Edge Function (Gemini → Groq)
├── docs/
│   └── FSD-Applicant-Copilot.md # Functional specification (full spec)
├── research/repos/              # Study-only reference repos (JobMatchAI, job_app_filler, AIHawk, workday-copilot)
├── CLAUDE.md                    # Claude Code instructions
├── PROJECT-CONTEXT.md           # This file
├── README.md                    # Public-facing product overview
├── SETUP-GUIDE.md               # End-to-end local setup
└── Chrome Web store checklist.md
```

### Key data flows

**Analyze a job:**

```
User clicks "Analyze Job"
  → expandTruncatedContent() clicks "Show more" (LinkedIn, Workday, Indeed)
  → extractJobDescription() reads full JD via platform selectors or text-density fallback
  → handleDigestJD() → one AI call → structured ~500-token digest → cached per URL (server + client)
  → handleAnalyzeJob() → AI scores match + provides insights using digest + sliced profile
  → Result cached; digest stored on saved job as `jdDigest` for offline access
```

**Interview prep:**

```
User clicks "Prep" on a saved job
  → Load jdDigest from cache → savedJob.jdDigest → savedJob.analysis.jdDigest
  → AI generates 10–12 categorized questions (behavioral, technical, situational, role-specific)
  → User answers with optional countdown timer
  → AI scores 1–10 with strengths, improvements, sample answer
  → Adaptive follow-ups when score < 5
  → Analytics dashboard + positioning advice (available after 5+ answers)
```

**Edge Function call:**

```
background.js handler → callEdgeFunction('generate-answer', body)
  → getSession() (auto-refresh if expiring within 120s)
  → fetch(SUPABASE_URL/functions/v1/generate-answer) with Bearer token + apikey
  → Edge Function: validate JWT via getUser() → try Gemini → fallback Groq
  → On failure: 502 with provider_errors[]; caller falls back to local callAI() if key present
```

**LinkedIn import (v3):**

```
User clicks "Import from LinkedIn"
  → background.js visits /in/me/details/{experience,education,certifications,projects,skills}/
  → Per page: waitForPageReady() → loadAllContent() (scroll + expand) → extractForPage(type)
  → Merge: replace experience/education/projects, union skills/certifications
  → Normalize dates, filter company-block artifacts
  → Persist structured arrays to active profile slot + write markdown snapshot
```

---

## Features (all working)

| Feature | Status | Entry point |
|---|---|---|
| Job Analysis | ✅ | Analysis tab → "Analyze Job" |
| AI Coach Chat | ✅ | Coaching tab (per-URL persistence) |
| Cover Letter | ✅ | Analysis tab → "Cover Letter" |
| ATS Resume | ✅ | Analysis tab → "ATS Resume" (2-phase: chips → preview) |
| Autofill | ✅ | Analysis tab → "AutoFill Application" |
| Interview Prep | ✅ | My Jobs → "Prep" on any saved job |
| Job Tracker | ✅ | My Jobs (full Saved → Applied → Interview → Offer → Rejected → Withdrawn pipeline) |
| Auto-Scan Widget | ✅ | Automatic on any recognized job posting |
| LinkedIn Import | ✅ | User Context → "Import from LinkedIn" |
| Multi-Resume | ✅ | Up to 10 slots, one global profile, different docs per slot |
| Configurable Prompts | ✅ | 9 editable prompts in AI Settings |
| Token Budget Controls | ✅ | 5 sliders in AI Settings |
| JD Expansion | ✅ | Auto-clicks "Show more" on LinkedIn, Workday, Indeed |
| 4-Layer Diagnostic | ✅ | AI Settings → "Test Connection" |

### Platform support

| Priority | Platform | Status |
|---|---|---|
| P0 | LinkedIn Easy Apply | Working (with JD expansion) |
| P0 | Workday | Working |
| P1 | Greenhouse / Lever | Selectors ready |
| P2 | Indeed / Glassdoor | Selectors ready |
| Any | Unknown ATS | Text-density fallback |

---

## Database schema

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | User identity, settings, consent | User owns their row |
| `experiences` | Work history entries | User owns via `profile_id` |
| `applications` | Tracked applications | User owns via `profile_id` |
| `generated_answers` | Per-application AI answers | User owns via application chain |
| `usage_logs` | Immutable token audit trail | User reads own |
| `jd_cache` | Server-side AI response cache (7-day TTL) | User owns rows |
| `jd_intelligence` | Market data from analyzed JDs (opt-in) | User inserts/reads own; service reads all |
| `candidate_activity` | Aggregated engagement metrics (opt-in) | User upserts/reads own; service reads all |

Migrations live in `supabase/migrations/` (6 files).

## Edge Function: `generate-answer`

- **Provider chain:** Gemini Flash (primary) → Groq Llama 3.3 70B (fallback)
- **Auth:** JWT validated internally via `getUser()` — gateway `verify_jwt = false` (required for Chrome-extension CORS)
- **Deploy:** `supabase functions deploy generate-answer --no-verify-jwt`
- **Action types:** `answer_generation`, `cover_letter`, `resume`, `resume_generation`, `jd_digest`, `chat`, `classification`, `interview_prep`
- **Passthrough:** `interview_prep` uses a lightweight system prompt so the model returns clean JSON
- **Structured errors:** 502 responses include `provider_errors[]`
- **Rate limiting:** Disabled in dev; re-enable at 200/hour before prod
- **Logging:** All calls log to `usage_logs` with token counts

---

## Token optimization

| Technique | Savings | Applied to |
|---|---|---|
| JD digest | ~80% on JD tokens | All JD-consuming operations |
| Profile slicing | 30–50% on profile tokens | Per-operation (only relevant fields) |
| Deterministic matcher | 100% (zero AI) | 30+ common field types |
| Server-side `jd_cache` | ~70% cache hit | Repeat analyses on same JD |
| Client-side analysis cache | Avoids redundant calls | 24h TTL for analysis results |

**Projected total:** ~70% reduction vs. a naïve full-context-every-call implementation.

---

## Design system — "The Organic Archive"

| Token | Value |
|---|---|
| Primary | `#4f614d` (Sage green) |
| Primary gradient | `linear-gradient(145deg, #4f614d 0%, #384937 100%)` |
| Background | `#f9f9f8` (panel), `#ffffff` (profile page) |
| Surfaces | `#f3f4f3` → `#edeeed` → `#e4e5e3` |
| Text | `#191c1c` primary, `#434842` secondary, `#727971` muted |
| Font | Manrope (variable, self-hosted woff2) |
| Icons | Material Symbols Outlined (self-hosted woff2, ligature-based) |
| Radius | 8 px small, 12 px medium, 16 px large |

**Icon rule:** Always `<span class="material-symbols-outlined">icon_name</span>`. No emoji characters anywhere.
**Font loading:** Fonts are loaded from `chrome.runtime.getURL()` inside the Shadow DOM so they render on any host page.

---

## Conventions

| Area | Rule |
|---|---|
| File names | `kebab-case.js` (`.ts` after WXT migration) |
| Components | `PascalCase.tsx` (after migration) |
| Database | `snake_case` columns |
| Constants | `UPPER_SNAKE_CASE` |
| Git | Conventional commits: `feat:`, `fix:`, `chore:`, `docs:` |
| Branches | `feat/description`, `fix/description` |
| Prompts | Dedicated builder functions in `aiService.js`, all accept `promptOverride` |
| Edge Function calls | Always include `action_type`, logged with `[EDGE]` prefix |
| Icons | Material Symbols Outlined only — never emoji |
| Panel isolation | Side panel runs in Shadow DOM; fonts via `chrome.runtime.getURL()` |

---

## Phase history

| Phase | Date | Summary |
|---|---|---|
| 1: Fork & setup | 2026-03-26 | JobMatchAI fork, JD extraction, EEO matcher |
| 2: Supabase backend | 2026-03-27 | 6 tables + RLS, Edge Function, JWT auth, usage logging |
| 3: Backend wiring | 2026-03-27 | Google OAuth, Edge routing, cover letter, ATS resume |
| 3.5: Token optimization | 2026-03-31 | JD digest, profile slicing, server cache, deterministic matcher |
| 4 / 4.5: Chat + prompts | 2026-03-31 | AI Coach chat, 8 editable prompts, token budget sliders |
| 5a: Edge Function fix | 2026-04-01 | Root-caused `verify_jwt` rejection; 4-layer diagnostic |
| 5b: Interview prep | 2026-04-01 | Timed practice, scoring, follow-ups, analytics, positioning |
| 6: Data collection | 2026-04-05 | Consent layer, `jd_intelligence`, `candidate_activity` |
| 6.5: Modular refactor | 2026-04-07 | Split content.js into 33 ESM modules; esbuild |
| 7: Auto-scan widget | 2026-04-08 | Ambient keyword match score widget |
| 7.5: Design system | 2026-04-09 | "Organic Archive" + Manrope + provider extractors |
| 8: Unified job tracker | 2026-04-10 | Full pipeline + auto-detect + filter tabs |
| 8.5: UI rebuild | 2026-04-10 | Profile page with Stitch layout + sidebar nav |
| 9: Icon system | 2026-04-11 | Emoji → Material Symbols Outlined (self-hosted) |
| 9.5: LinkedIn import v3 | 2026-04-12 | Multi-page scraper, smart merge, snapshot |
| 9.6: In-page interview prep | 2026-04-12 | Replaced broken LinkedIn redirect with in-page view |

### Outstanding manual steps

- [ ] Create `resumes` storage bucket in Supabase Dashboard (private, 10 MB, PDF only)
- [ ] End-to-end integration test (see setup guide)
- [ ] Re-enable Edge Function rate limiting before prod (target: 200/hour per user)

### Next: Phase 10 — Ship & scale

- Chrome Web Store submission (see `Chrome Web store checklist.md`)
- WXT + TypeScript migration
- Server-side prompt management (admin pushes prompts via Supabase table)
- Full Workday field handler port from `job_app_filler`
- Billing / payments (Stripe)
- Cross-device sync

---

## Documentation

| File | Purpose |
|---|---|
| `PROJECT-CONTEXT.md` | This file — master project document |
| `README.md` | Public-facing product overview |
| `SETUP-GUIDE.md` | End-to-end local setup |
| `CLAUDE.md` | Claude Code instructions |
| `docs/FSD-Applicant-Copilot.md` | Functional specification document |
| `Chrome Web store checklist.md` | Submission checklist |

---

## Repository

**GitHub:** https://github.com/suryafuturepath/Applicant-CoPilot
