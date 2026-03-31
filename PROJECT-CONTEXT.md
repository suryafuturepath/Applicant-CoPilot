# Applicant Copilot — Project Context

## Vision
A Chrome extension copilot that helps job applicants answer application questions intelligently by leveraging their deeply captured experience and the target job's context. Not auto-apply — a copilot that works *with* the applicant.

## Target User
Job seekers applying to **tech, consulting, and product roles**. Users who are applying to multiple positions and are tired of the repetitive, tedious back-and-forth of tailoring answers for each application.

## Core Problem
Every job application asks similar-but-different questions. Tailoring answers to each JD is time-consuming and mentally draining. Generic AI copy-paste is obvious to recruiters. Applicants need a tool that knows them deeply and helps craft authentic, tailored responses.

---

## Product Architecture

### Platform
**Chrome Extension** (Manifest V3) with a **Supabase backend**

### Interaction Model
1. User installs extension, creates account
2. **Onboarding**: Upload resume → guided conversational intake to build rich experience profile
   - Structured questions per role (what you did, what you learned, impact)
   - Top 5 target role types
   - Free-form "tell me about yourself"
   - Text dumps (paste LinkedIn About, old cover letters, etc.)
3. **Application flow**:
   - User navigates to a job posting → extension auto-extracts JD text
   - Extension creates a **JD digest** (structured extraction, cached per URL)
   - User opens panel → clicks "Analyze Job" → gets match score + insights
   - For form fields: copilot drafts tailored answers using profile + JD digest
   - User can edit, refine, then insert or copy
4. **Cover letter**: Generates tailored 4-paragraph cover letter → copy/download
5. **Resume generation**: Generates JD-tailored resume with ATS keyword optimization

### Key Features
- [x] Rich experience profile creation (resume upload + conversational intake)
- [x] JD extraction from any job posting page (smart selector + text-density fallback)
- [x] JD digest pipeline (extract once → reuse across all AI operations)
- [x] DOM scanning for application form fields (Workday, Lever, Greenhouse, Ashby, iCIMS)
- [x] Copilot-style answer generation (draft → refine → insert)
- [x] Cover letter generation (400-500 words, 4 paragraphs)
- [x] Tailored resume generation with ATS keyword optimization
- [x] Deterministic field matching (30+ field types, zero AI tokens)
- [x] Token cost optimization (JD digest, profile slicing, server-side cache)
- [ ] Usage-based billing (token cost + 15-20% margin)
- [ ] Voice input for onboarding

---

## Foundation Repos

### Primary (Fork & Enhance)

| Repo | License | Role | Key Value |
|------|---------|------|-----------|
| **JobMatchAI** | MIT | Fork base | Multi-platform selectors (LinkedIn, Workday, Greenhouse, Lever, Indeed), 10+ AI provider abstraction, Shadow DOM side panel, form detection + autofill, deterministic EEO matcher |
| **job_app_filler** | BSD-3 | Port Workday handlers | 471 commits of Workday expertise, 12+ field type handlers, React controlled input bypass via `__reactProps$xxx`, XPath-based discovery |

### Secondary (Study & Reimplement)

| Repo | License | Role | Key Value |
|------|---------|------|-----------|
| **AIHawk** | AGPL (study only) | Prompt patterns | Question classification, HR expert personas, ATS resume prompts. **Cannot copy code — reimplement independently.** |
| **workday-copilot** | MIT | Architecture reference | WXT + React + TS + Tailwind setup, side panel entry point, messaging patterns |

---

## Tech Stack

### Chrome Extension (Current — vanilla JS)
- **Base**: JobMatchAI fork (Manifest V3, no build step)
- **UI**: Shadow DOM side panel
- **Content Scripts**: Vanilla JS (DOM scanning, form detection, autofill)
- **State**: `chrome.storage.local`

### Chrome Extension (Migration target — Week 2+)
- **Framework**: WXT (Manifest V3, Vite-based, TypeScript-first)
- **UI**: React 19 + Tailwind CSS 4 (Side Panel)
- **State Management**: Zustand

### Backend
- **Platform**: Supabase (`oeeatotpwtftmvlydgsg.supabase.co`)
  - **Auth**: Google OAuth via Supabase Auth
  - **Database**: PostgreSQL with RLS on all tables
  - **Storage**: `resumes` bucket (private, 10MB limit)
  - **API**: Edge Functions (Deno runtime)

### LLM
- **Backend (Edge Function)**: Groq Llama 3.3 70B (primary, free tier) → Gemini 2.0 Flash (fallback)
- **Local (user's own key)**: 10+ providers via AI service abstraction (Anthropic, OpenAI, Gemini, Groq, Cerebras, Together, OpenRouter, Mistral, DeepSeek, Cohere)
- **Default local model**: Claude Sonnet 4
- **Architecture**: All backend LLM calls go through Edge Functions (never from extension directly)
  - Protects API keys
  - Enables usage tracking + billing
  - Server-side prompt construction with user context
  - Model swappable without extension update

### Key Dependencies
- `@supabase/supabase-js` — Supabase client (bundled as `supabase-bundle.js`)
- `pdf.js` — Client-side PDF parsing
- `mammoth.js` — Client-side DOCX parsing
- *Week 2+:* `wxt`, `react`, `react-dom`, `tailwindcss`, `zustand`, `zod`

---

## Extension Architecture

### File Structure
```
extension/
├── manifest.json          # MV3 manifest, <all_urls> content scripts
├── background.js          # Service worker: message router, AI handlers, storage, auth
├── content.js             # Content script: Shadow DOM panel, JD extraction, form detection, autofill
├── aiService.js           # 10+ provider abstraction, prompt builders, callAI()
├── deterministicMatcher.js # Rule-based field matcher (30+ field types, zero AI tokens)
├── supabase-client.js     # Singleton Supabase client, session persistence in chrome.storage
├── profile.html/js        # Full-page profile/settings UI
├── styles.css             # Content script styles
├── icons/                 # Extension icons (16, 48, 128)
├── libs/                  # Vendored libraries (pdf.js, mammoth, supabase-bundle)
└── tests/                 # Test plans
```

### Message Flow
```
content.js (page context)
  → chrome.runtime.sendMessage({ type: 'ANALYZE_JOB', ... })
  → background.js (service worker)
    → handleAnalyzeJob()
      → handleDigestJD() → getCachedDigest() or callEdgeFunction/callAI
      → sliceProfileForOperation(profile, 'analysis')
      → callEdgeFunction('generate-answer', ...) or callAI(...)
    → { success: true, data: result }
  → content.js renders result in Shadow DOM panel
```

### Token Optimization Pipeline
```
User clicks "Analyze Job"
  → extractJobDescription()
    Stage 1: Platform selectors (LinkedIn, Workday, Indeed, Greenhouse, Lever)
    Stage 2: Text-density algorithm (fallback for unknown ATS sites)
  → handleDigestJD(rawJD, title, company, url)
    → Check cache (chrome.storage.local, keyed by URL, 7-day TTL)
    → If miss: ONE AI call → structured JD digest (~500 tokens)
    → Cache result for all downstream operations
  → handleAnalyzeJob(jd, title, company, url)
    → sliceProfileForOperation(profile, 'analysis') → titles + skills only
    → Pass digest (not raw JD) + sliced profile to AI
  → Subsequent operations (cover letter, resume, bullets) reuse cached digest
```

### Profile Context Flow
Every AI operation receives context through two mechanisms:
1. **Profile slicing**: `sliceProfileForOperation()` returns only relevant fields per operation
2. **Rich context enrichment**: `enrichProfileWithContext()` / `buildRichContextForPrompt()` adds career goals, experience highlights, work preferences from the conversational intake

| Operation | Profile Slice | Rich Context |
|-----------|--------------|--------------|
| Job Analysis | titles + skills + education | Career goals, target roles |
| Cover Letter | top 3 experiences (full) | Career goals, motivations |
| Bullet Rewrite | all experience + skills | Career goals, highlights |
| Resume Gen | full profile (no slicing) | All context |
| Autofill | personal details + titles | Work preferences, Q&A answers |

### Deterministic Matcher (Zero AI Tokens)
`deterministicMatcher.js` handles 30+ field types without AI calls:
- **EEO/demographic**: gender, race, veteran, disability, pronouns, sexual orientation
- **Personal info**: name, email, phone, LinkedIn, GitHub, website, location
- **Employment**: work authorization, sponsorship, current title/employer
- **Binary**: background check, drug test, driver's license, age 18+, relocation, travel
- **Synonyms**: 40+ synonym mappings (e.g., "male" → "man", "indian" → "South Asian")
- **Fallback**: "Prefer not to say" for unanswered demographic fields

---

## Database Schema

### Tables

| Table | Purpose | RLS |
|-------|---------|-----|
| `profiles` | User profiles (PK = auth.users.id) | Users own their row |
| `experiences` | Work experience entries | Users own via profile_id |
| `applications` | Job applications being tracked | Users own via profile_id |
| `generated_answers` | AI-generated answers per application | Users own via application_id → profile_id |
| `usage_logs` | Immutable token usage log (billing) | Users can read own |
| `jd_cache` | Server-side response cache per JD per operation | Users own via profile_id |

### `jd_cache` (Token Optimization)
```sql
jd_cache(
  id uuid PK,
  profile_id uuid FK → profiles,
  jd_hash text NOT NULL,         -- SHA-256 of normalized JD text
  operation text NOT NULL,        -- 'digest', 'analysis', 'cover_letter', 'resume', 'bullet_rewrite'
  result jsonb NOT NULL,          -- Cached AI response
  expires_at timestamptz DEFAULT now() + 7 days,
  UNIQUE(profile_id, jd_hash, operation)
)
```

### Triggers
- `handle_updated_at` — Auto-updates `updated_at` on profiles, experiences, applications, generated_answers
- `handle_new_user` — Auto-creates profile row when auth.users row is inserted

---

## Edge Function: `generate-answer`

### Provider Chain
1. **Groq** (Llama 3.3 70B) — Primary. Free tier, 6000 req/day, ~200ms latency.
2. **Gemini Flash** — Fallback if Groq fails/rate-limits.

### Features
- JWT auth via `Authorization: Bearer <token>`
- Rate limiting: 50 requests/user/hour (via usage_logs count)
- Usage logging: tokens_input, tokens_output, model, cost_usd, action_type
- Server-side response caching via `jd_cache` table (cache hit = 0 tokens)
- Action types: `answer_generation`, `cover_letter`, `resume`, `resume_generation`, `jd_digest`, `chat`, `classification`

### Cache Flow
```
Request arrives with jd_text
  → SHA-256 hash of jd_text = jd_hash
  → Check jd_cache(profile_id, jd_hash, action_type) WHERE expires_at > now()
  → HIT: return cached result (0 Gemini tokens, instant response)
  → MISS: call Groq/Gemini → write to jd_cache → return fresh result
```

---

## Platform Priority

| Priority | Platform | Status | Source |
|----------|----------|--------|--------|
| P0 | **LinkedIn Easy Apply** | Working | JobMatchAI selectors |
| P0 | **Workday** | Working (basic) | JobMatchAI + job_app_filler selectors |
| P1 | Greenhouse | Selectors ready | JobMatchAI |
| P1 | Lever | Selectors ready | JobMatchAI |
| P2 | Indeed | Selectors ready | JobMatchAI |
| P2 | Glassdoor | Selectors ready | JobMatchAI |
| Any | Unknown ATS | Working | Text-density fallback algorithm |

---

## Conventions

### Code Style
- Vanilla JS (Week 1) → TypeScript strict mode (Week 2+)
- Functional patterns, no classes
- Named exports (no default exports except where required)
- All prompts in dedicated builder functions in `aiService.js`

### Naming
- Files: `kebab-case.js`
- Components: `PascalCase.tsx` (Week 2+)
- Functions/variables: `camelCase`
- Database: `snake_case`
- Constants: `UPPER_SNAKE_CASE`

### Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Feature branches: `feat/description`
- PR per feature/fix

---

## Current Status

**Phase 3.5: Token Optimization — DONE (2026-03-31)**

### Phase 1: Fork & Project Setup — DONE (2026-03-26)
- Forked JobMatchAI as extension base
- Chrome extension loads, JD extraction working
- Deterministic EEO matcher with gender/gender_identity ordering fix
- Gemini Flash integrated for local resume parsing

### Phase 2: Supabase Backend Setup — DONE (2026-03-27)
- 6 tables with full RLS, triggers, storage policies
- Edge Function `generate-answer` deployed
- JWT auth, rate limiting, usage logging

### Phase 3: Connect Extension to Backend — DONE (2026-03-27)
- Google OAuth via Supabase Auth (tab-based flow)
- All 5 AI handlers route through Edge Function when signed in
- Graceful fallback to local API key when signed out
- Profile sync (extension → Supabase, one-way push)
- Cover letter (400-500 words, 4 paragraphs)
- ATS Resume Generator (markdown → PDF via browser print)
- 7-strategy JSON parser that never throws
- Code quality pass (XSS prevention, CORS, performance, accessibility)

### Phase 3.5: Token Cost Optimization — DONE (2026-03-31)
- **Smart JD extraction**: 5 platform selectors + Readability-inspired text-density fallback
- **JD digest pipeline**: One AI call extracts structured digest (~500 tokens), cached per URL
- **Profile slicing**: Only sends relevant profile fields per operation type
- **All prompt builders updated**: Accept digest or raw JD (backward compatible)
- **Server-side cache**: `jd_cache` table with 7-day TTL, SHA-256 keys
- **Expanded deterministic matcher**: 30+ field types handled without AI (name, email, phone, URLs, yes/no fields)
- **Groq as primary LLM**: Llama 3.3 70B via Groq (free tier) → Gemini Flash fallback
- **Projected savings**: ~70% reduction (380K → 115K tokens/month per power user)

### Phase 4: Ask AI Chat + UX Overhaul — DONE (2026-03-31)
- **Ask AI Chat**: Replaced Q&A tab with in-panel chat interface
  - Full context: JD digest + profile + analysis passed as system context
  - 4 suggestion chips for first-time guidance ("Am I a good fit?", "Interview prep", etc.)
  - Per-URL chat persistence (chrome.storage.local, 50 msgs/chat, 20 chats max, LRU eviction)
  - Typing indicator, copy button on AI responses, error bubbles with retry
  - 30s timeout on AI responses
- **ATS Resume Redesign**: 2-phase flow (Build → Result)
  - Build phase: 6 instruction chips (Leadership, Technical, Metrics, Match JD, Fit 1 Page, Cross-functional) + custom textarea
  - Result phase: mini rendered HTML preview + "Open Full Preview" in new tab
  - Full preview tab: formatted resume with sticky action bar (Copy Text + Download PDF), hidden on print
  - "Regenerate with changes" button flips back to build phase for iteration
- **Removed**: "Improve Resume Bullets" button (folded into ATS Resume custom instructions)
- **Navigation**: Added Home tab — 5 tabs now: Home | Ask AI | Saved | Profile | Settings

### Phase 4.5: Configurable Prompts + Token Controls — DONE (2026-03-31)
- **8 editable system prompts** in AI Settings: Resume, Cover Letter, Chat, Analysis, Autofill, Resume Parse, JD Digest, Edge System
  - Collapsible sections with monospace textareas
  - "Modified" badge when prompt differs from default
  - Per-section "Reset to default" + global "Reset All"
  - Stored in `chrome.storage.local` under `customPrompts`
  - All prompt builders accept `promptOverride` param — custom prompt replaces hardcoded text
  - Backend Edge Function calls also use custom prompts
- **Token budget controls**: 4 sliders in AI Settings
  - Resume: 2048–16384, default 8192
  - Analysis: 1024–8192, default 4096
  - Cover Letter: 512–4096, default 2048
  - Chat: 256–2048, default 1024
  - Edge Function cap raised from 4096 to 16384
  - Dynamic length guideline: long-form operations (>2048 tokens) get "be thorough" instead of "be concise"
- **Architecture fixes** from final review:
  - Hoisted `getCustomPrompts()` to avoid redundant storage reads in fallback paths
  - Fixed Edge Function system prompt — "100-200 words" instruction no longer overrides resume/cover letter generation

### Remaining Manual Steps
- [ ] Create `resumes` storage bucket in Supabase Dashboard
- [ ] End-to-end integration test (see testplanMVP.md)

### Next: Phase 5 — Ship & Scale
- Server-side prompt management (admin pushes prompts to all users via Supabase `system_prompts` table)
- WXT + TypeScript migration
- Full Workday field handler port from job_app_filler
- Billing/payment system (Stripe)
- Voice input for onboarding

---

## Documentation Map

| File | Purpose |
|------|---------|
| `PROJECT-CONTEXT.md` | This file — master project document |
| `CLAUDE.md` | Claude Code instructions (condensed reference) |
| `SETUP-GUIDE.md` | Step-by-step local setup for developers |
| `testplanMVP.md` | 15-test end-to-end MVP test plan |
| `extension/tests/TEST-PLAN.md` | QA gap analysis + test infrastructure recommendations |
| `docs/PHASE-1-SUMMARY.md` | Historical summary of Phase 1 fork work |
| `docs/archive/` | Completed planning artifacts (PLAN-week1, PHASE-2, intake-flow, testing-phase1) |

---

## Repositories
- **GitHub**: https://github.com/suryafuturepath/Applicant-CoPilot
