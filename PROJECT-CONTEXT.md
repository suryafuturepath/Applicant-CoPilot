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
**Chrome Extension** (Manifest V3) with a **backend API**

### Interaction Model
1. User installs extension, creates account
2. **Onboarding**: Upload resume → guided Q&A to build rich experience profile
   - Structured questions per role (what you did, what you learned, impact)
   - Top 5 target role types
   - Free-form "tell me about yourself"
   - Voice input (text-to-speech) supported for answering questions
3. **Application flow**:
   - User navigates to a job posting → clicks "Read JD" → extension extracts JD text
   - User approves extracted context
   - User navigates to application pages → extension scans DOM for form fields
   - For each question/field: copilot drafts a tailored answer using profile + JD context
   - User can edit, refine (chat with copilot), then insert or copy
4. **Cover letter**: Minimal additional questions → generates tailored cover letter → download
5. **Resume generation**: Generates JD-tailored resume with keyword optimization (ATS 80+ score)

### Key Features (Full Vision)
- [ ] Rich experience profile creation (resume upload + guided Q&A)
- [ ] Voice input for onboarding Q&A
- [ ] JD extraction from any job posting page
- [ ] DOM scanning for application form fields (Workday, Lever, Greenhouse, Ashby, iCIMS)
- [ ] Copilot-style answer generation (draft → refine → insert)
- [ ] Cover letter generation
- [ ] Tailored resume generation with ATS keyword optimization
- [ ] Usage-based billing (token cost + 15-20% margin)

---

## Foundation Repos

We are building on top of existing open-source work rather than starting from scratch.

### Primary (Fork & Enhance)

| Repo | License | Role | Key Value |
|------|---------|------|-----------|
| **JobMatchAI** | MIT | Fork base | Multi-platform selectors (LinkedIn, Workday, Greenhouse, Lever, Indeed), 10+ AI provider abstraction, Shadow DOM side panel, form detection + autofill, deterministic EEO matcher |
| **job_app_filler** | BSD-3 | Port Workday handlers | 471 commits of Workday expertise, 12+ field type handlers, React controlled input bypass via `__reactProps$xxx`, XPath-based discovery, inject script architecture |

### Secondary (Study & Reimplement)

| Repo | License | Role | Key Value |
|------|---------|------|-----------|
| **AIHawk** | AGPL (study only) | Prompt patterns | Question classification → section routing, HR expert personas, ATS resume prompts, cover letter generation, suitability scoring. **Cannot copy code — reimplement independently.** |
| **workday-copilot** | MIT | Architecture reference | WXT + React + TypeScript + Tailwind setup, side panel entry point, content ↔ background ↔ panel messaging, custom error classes per input type |

### Build Strategy
```
Fork JobMatchAI (MIT, vanilla JS, multi-platform)
  + Port job_app_filler Workday handlers (BSD-3, TypeScript, 12+ field types)
  + Scaffold from workday-copilot (MIT, WXT + React + TS boilerplate)
  + Reimplement AIHawk prompt patterns (AGPL, study only)
  + Add our copilot UX layer (NEW — our differentiator)
  + Add Supabase backend (NEW — auth, profiles, billing, LLM proxy)
  = Applicant Copilot
```

### Migration Plan
- **Week 1 MVP**: Fork JobMatchAI as-is (vanilla JS), add Supabase auth + copilot UX
- **Week 2-3**: Migrate to TypeScript + WXT (using workday-copilot as scaffold reference)
- **Week 2-3**: Port job_app_filler Workday handlers, write our own prompts

---

## Tech Stack

### Chrome Extension (Week 1 — vanilla JS fork)
- **Base**: JobMatchAI fork (Manifest V3, no build step)
- **UI**: Shadow DOM side panel (from JobMatchAI)
- **Content Scripts**: Vanilla JS (DOM reading, form detection, autofill)

### Chrome Extension (Week 2+ — migration target)
- **Framework**: WXT (Manifest V3, Vite-based, TypeScript-first)
- **UI**: React 19 + Tailwind CSS 4 (Side Panel)
- **Content Scripts**: TypeScript (DOM reading, form detection)
- **State Management**: Zustand

### Backend
- **Platform**: Supabase
  - **Auth**: Supabase Auth (Google OAuth + email/password)
  - **Database**: PostgreSQL (via Supabase)
  - **File Storage**: Supabase Storage (resume uploads)
  - **API**: Supabase Edge Functions (Deno runtime)

### LLM
- **Provider**: Multi-provider via AI service abstraction (from JobMatchAI)
  - Anthropic Claude, OpenAI, Groq, Cerebras, Together, Gemini, Mistral, DeepSeek, Cohere, OpenRouter
- **Default**: Claude Sonnet (best quality/cost for nuanced writing)
- **Architecture**: All LLM calls go through backend Edge Functions (never from extension directly)
  - Protects API key
  - Enables usage tracking + billing
  - Server-side system prompt injection with user context
  - Model swappable without extension update

### Key Dependencies
- `@supabase/supabase-js` — Supabase client
- `pdf.js` — Client-side PDF parsing (from JobMatchAI)
- `mammoth.js` — Client-side DOCX parsing (from JobMatchAI)
- `zod` — Schema validation
- *Week 2+:* `wxt`, `react`, `react-dom`, `tailwindcss`, `zustand`

---

## Database Schema (Initial)

### `profiles`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | Supabase auth user ID |
| full_name | text | User's full name |
| email | text | User's email |
| headline | text | Professional headline |
| summary | text | Free-form "about me" |
| target_roles | text[] | Top 5 target role types |
| resume_url | text | Supabase Storage path to uploaded resume |
| resume_parsed | jsonb | Parsed/structured resume data |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `experiences`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | |
| profile_id | uuid (FK) | → profiles.id |
| company | text | Company name |
| title | text | Job title |
| start_date | date | |
| end_date | date | Null if current |
| description | text | What you did |
| learnings | text | What you learned |
| impact | text | Measurable impact |
| skills | text[] | Skills used/developed |
| order_index | int | Display order |

### `applications`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | |
| profile_id | uuid (FK) | → profiles.id |
| company | text | Company applying to |
| role | text | Role title |
| jd_text | text | Full job description text |
| jd_url | text | URL of the job posting |
| status | text | draft, in_progress, submitted, rejected, interview, offer |
| notes | text | User notes |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `generated_answers`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | |
| application_id | uuid (FK) | → applications.id |
| question | text | The application question |
| answer | text | Generated/edited answer |
| field_selector | text | DOM selector of the form field (for auto-fill) |
| is_final | boolean | User approved this answer |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `usage_logs`
| Column | Type | Description |
|--------|------|-------------|
| id | uuid (PK) | |
| profile_id | uuid (FK) | → profiles.id |
| tokens_input | int | Input tokens used |
| tokens_output | int | Output tokens used |
| model | text | Model used |
| cost_usd | numeric | Raw API cost |
| billed_usd | numeric | Cost + margin |
| action_type | text | answer_generation, cover_letter, resume, chat |
| created_at | timestamptz | |

---

## Billing Model
- Pass-through token cost + **15-20% margin**
- User sees: "You used X tokens → cost: $Y"
- Payment: Stripe (or similar) — prepaid credits or pay-as-you-go
- Free tier: TBD (maybe first 10 applications or $5 in credits)

---

## Project Structure (Planned)

```
applicant-copilot/
├── extension/                  # Chrome extension (WXT)
│   ├── src/
│   │   ├── entrypoints/
│   │   │   ├── sidepanel/     # React side panel UI
│   │   │   ├── background/    # Service worker
│   │   │   ├── content/       # Content scripts (DOM scanning)
│   │   │   └── popup/         # Extension popup (minimal)
│   │   ├── components/        # Shared React components
│   │   ├── hooks/             # Custom React hooks
│   │   ├── lib/               # Utilities, API client, storage
│   │   ├── stores/            # Zustand stores
│   │   └── types/             # TypeScript types
│   ├── public/                # Extension assets
│   ├── wxt.config.ts
│   ├── tailwind.config.ts
│   └── package.json
├── supabase/                   # Supabase project
│   ├── functions/             # Edge Functions
│   │   ├── generate-answer/   # LLM answer generation
│   │   ├── generate-cover-letter/
│   │   ├── generate-resume/
│   │   ├── parse-resume/      # Resume upload processing
│   │   └── chat/              # General copilot chat
│   ├── migrations/            # SQL migrations
│   └── config.toml
├── PROJECT-CONTEXT.md          # This file
├── CLAUDE.md                   # Claude Code instructions
└── README.md
```

---

## Platform Priority

| Priority | Platform | Why | Source Repo |
|----------|----------|-----|-------------|
| P0 | **LinkedIn Easy Apply** | Highest volume for tech/consulting/PM roles | JobMatchAI |
| P0 | **Workday** | Most painful UX, longest forms, biggest time savings | job_app_filler + JobMatchAI |
| P1 | Greenhouse | Common in tech startups | job_app_filler (has handlers) |
| P1 | Lever | Common in tech startups | JobMatchAI (has selectors) |
| P2 | Indeed | High volume but simpler forms | JobMatchAI |
| P2 | Glassdoor | Secondary job board | JobMatchAI |

---

## MVP Scope (Week 1)

### In Scope
1. **Fork JobMatchAI** — Working Chrome extension with multi-platform support
2. **Supabase backend** — Auth (Google OAuth), user profiles, LLM proxy edge function
3. **Basic onboarding** — Resume upload + 5 structured questions (in side panel)
4. **JD extraction** — "Read this JD" from LinkedIn and Workday job pages
5. **Question → Answer copilot** — User pastes/sees a question, gets a tailored draft, can edit and copy/insert
6. **LinkedIn Easy Apply support** — Detect Easy Apply forms, generate answers for custom questions
7. **Workday basic support** — Use JobMatchAI's existing Workday selectors (enhanced with job_app_filler handlers in v1.1)

### Out of Scope (V1.1+)
- Full Workday field handler port from job_app_filler (Week 2)
- TypeScript + WXT migration (Week 2-3)
- Voice input for onboarding
- Cover letter generation
- Resume generation / ATS optimization
- Billing / payment system (free during MVP)
- Greenhouse / Lever specific support

---

## Conventions

### Code Style
- TypeScript strict mode everywhere
- Zod for all external data validation (API responses, form inputs)
- Functional components only (no class components)
- Named exports (no default exports except where required by framework)

### Naming
- Files: `kebab-case.ts`
- Components: `PascalCase.tsx`
- Functions/variables: `camelCase`
- Database: `snake_case`
- Constants: `UPPER_SNAKE_CASE`

### Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Feature branches: `feat/description`
- PR per feature/fix

### LLM Integration
- All prompts stored as template strings in dedicated files under `lib/prompts/`
- System prompts include user context (injected server-side)
- Never expose raw API errors to users
- Always log token usage for billing

---

## Current Status
**Phase 2: Complete** — Supabase backend deployed and operational.

### Phase 1: Fork & Project Setup — DONE (2026-03-26)
- Forked JobMatchAI as extension base
- Chrome extension loads, JD extraction working
- Deterministic EEO matcher with gender/gender_identity ordering fix
- Gemini Flash integrated for local resume parsing

### Phase 2: Supabase Backend Setup — DONE (2026-03-27)
- Supabase project created: `oeeatotpwtftmvlydgsg.supabase.co`
- Database migrations applied:
  - 5 tables: `profiles`, `experiences`, `applications`, `generated_answers`, `usage_logs`
  - Full RLS policies on all tables
  - Auto-create profile trigger on user signup
  - Auto-update `updated_at` triggers
- Storage policies for resume uploads (`resumes` bucket)
- Edge Function `generate-answer` deployed (Gemini Flash, free tier)
  - JWT auth, 50 req/hr rate limiting, usage logging
- Secrets configured: `GEMINI_API_KEY`

### Phase 2: Remaining Manual Steps
- [ ] Create `resumes` storage bucket in Supabase Dashboard
- [ ] Google OAuth setup (Google Cloud Console + Supabase Auth provider)
- [ ] End-to-end integration test (signup → profile trigger → edge function call)

### Next: Phase 3 — Connect Extension to Backend
- Wire extension to use Supabase Auth (Google OAuth sign-in)
- Replace local Gemini calls with Edge Function proxy
- Profile CRUD from extension side panel

### Repositories
- **GitHub**: https://github.com/suryafuturepath/Applicant-CoPilot

### Foundation Repos (local)
```
research/repos/
├── JobMatchAI/                    # Fork base (MIT)
├── job_app_filler/                # Port Workday handlers (BSD-3)
├── Jobs_Applier_AI_Agent_AIHawk/  # Study prompts only (AGPL)
└── workday-copilot/               # Architecture reference (MIT)
```
