# Functional Specification Document — Applicant Copilot

**Version:** 1.0.0
**Last updated:** 2026-04-13
**Status:** Phase 9 complete — all core features working, preparing for Chrome Web Store submission

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [System Architecture](#2-system-architecture)
3. [User Personas & Access Model](#3-user-personas--access-model)
4. [Features](#4-features)
   - 4.1 [Job Analysis](#41-job-analysis)
   - 4.2 [AI Coach Chat](#42-ai-coach-chat)
   - 4.3 [Cover Letter](#43-cover-letter)
   - 4.4 [ATS Resume](#44-ats-resume)
   - 4.5 [Autofill](#45-autofill)
   - 4.6 [Interview Prep](#46-interview-prep)
   - 4.7 [Job Tracker](#47-job-tracker)
   - 4.8 [Auto-Scan Widget](#48-auto-scan-widget)
   - 4.9 [Profile & Resume Management](#49-profile--resume-management)
   - 4.10 [LinkedIn Profile Import](#410-linkedin-profile-import)
   - 4.11 [AI Settings](#411-ai-settings)
   - 4.12 [JD Digest Pipeline](#412-jd-digest-pipeline)
   - 4.13 [Deterministic Field Matcher](#413-deterministic-field-matcher)
5. [Platform Support](#5-platform-support)
6. [AI Provider Architecture](#6-ai-provider-architecture)
7. [Data Model](#7-data-model)
8. [Authentication & Security](#8-authentication--security)
9. [Performance & Caching](#9-performance--caching)
10. [Privacy & Data Handling](#10-privacy--data-handling)
11. [Design System](#11-design-system)
12. [Phase History](#12-phase-history)

---

## 1. Product Overview

### What it is

Applicant Copilot is a Chrome extension (Manifest V3) that sits alongside job listing pages and helps applicants produce high-quality, personalized application artifacts — analyses, cover letters, ATS-optimized resumes, form answers, and interview practice — grounded in the applicant's own profile and the specific target job.

### Who it's for

Candidates applying to **tech, consulting, and product roles** who are tired of re-tailoring the same material for every application. The product is positioned as a *copilot*, not an auto-applier: it accelerates the applicant's own work, never submits on their behalf.

### Problem

- Tailoring a resume and cover letter per role takes 30-60 minutes each.
- Application forms repeat the same fields across platforms (EEO, work authorization, demographics).
- Interview prep is ad-hoc, unstructured, and lacks objective feedback.
- Generic AI tools (ChatGPT) require constant copy-pasting and lack memory of the applicant's profile.

### Solution

A single browser-native surface that:

- **Extracts** the job description from the active page (LinkedIn, Workday, Greenhouse, Lever, Indeed, Glassdoor, or any site via text-density fallback)
- **Scores** the applicant against the JD and surfaces matching/missing skills
- **Generates** tailored cover letters and ATS-friendly resumes on demand
- **Autofills** application forms using a two-tier (deterministic + AI) matcher
- **Coaches** the applicant through timed interview prep with AI-scored answers and adaptive follow-ups
- **Tracks** the full application pipeline (Saved → Applied → Interview → Offer → Rejected → Withdrawn)

### Key differentiators

| Capability | Applicant Copilot | Generic AI tools |
|---|---|---|
| Job-page aware | Extracts JD from DOM in real-time | Manual copy-paste |
| Profile-aware | Persistent profile + multi-resume slots | No memory |
| Form-aware | Detects fields, matches deterministically | N/A |
| Platform-aware | LinkedIn / Workday / Greenhouse / Lever / Indeed selectors + "Show more" auto-expansion | N/A |
| Cost-optimized | JD digest caching, profile slicing, deterministic matching | Full context every call |
| Multi-provider | 10+ local providers + Supabase backend with Gemini→Groq fallback | Single provider |

---

## 2. System Architecture

### High-level diagram

```
Chrome (Manifest V3 extension)
├── Content script (extension/content.js, bundled from src/)
│   ├── Shadow DOM side panel (3 bottom tabs: Analysis, Coaching, Saved)
│   ├── Floating toggle button (separate Shadow DOM, draggable)
│   ├── JD extraction (platform-specific → text-density fallback)
│   ├── JD expansion ("Show more" auto-click on LinkedIn/Workday/Indeed)
│   ├── Autofill pipeline (field detection → deterministic → AI)
│   ├── Auto-scan widget (ambient keyword match score)
│   └── SPA monitor (URL change detection for LinkedIn/Workday)
│
├── Service worker (extension/background.js)
│   ├── ~30 message handlers (AI ops, profile, jobs, chat, interview prep, LinkedIn import)
│   ├── Chrome storage read/write
│   ├── LinkedIn multi-page scraper (5 detail pages, per-page readiness detection)
│   └── Supabase client proxy (auth, edge function, db)
│
├── Profile page (extension/profile.html + profile.js)
│   ├── Left sidebar nav: User Context / My Jobs / AI Settings
│   ├── Resume upload (pdf.js + mammoth.js)
│   ├── Multi-slot resume management (up to 10 slots)
│   └── Full job tracker with filter tabs + status pipeline
│
└── AI service layer (extension/aiService.js)
    ├── 10+ provider adapters (Gemini, Groq, OpenAI, Anthropic, etc.)
    ├── 9 prompt builders, all accept promptOverride
    └── Token budget management

Supabase backend
├── Auth: Google OAuth
├── PostgreSQL + RLS (8 tables)
├── Edge Function: generate-answer (Deno)
│   ├── Gemini 2.0 Flash (primary)
│   └── Groq Llama 3.3 70B (fallback)
├── Storage: `resumes` bucket (private, 10 MB, PDF only)
└── Server-side jd_cache table (7-day TTL)
```

### Communication model

All components use the standard Chrome messaging pattern (`chrome.runtime.sendMessage` / `chrome.runtime.onMessage`):

- **Content script ↔ Service worker**: AI requests, storage, LinkedIn import, auth state
- **Profile page ↔ Service worker**: Profile saves, settings, job tracker CRUD, LinkedIn import, interview prep open
- **Service worker ↔ Supabase**: Edge Function calls, database upserts, OAuth flow

### Content script module layout (`extension/src/`)

```
src/
├── content-main.js           # Bootstrap: panel creation, JD extraction orchestration
├── messaging.js              # chrome.runtime.sendMessage wrapper
├── state.js                  # Shared state refs (panel, toggle, shadow root)
├── utils.js                  # Small helpers (escapeHTML, hashing, etc.)
├── panel/
│   ├── panel-core.js         # Shadow DOM setup, show/hide
│   ├── panel-html.js         # Panel markup (3 tabs + interview prep sub-view)
│   ├── panel-css.js          # Scoped CSS for Shadow DOM
│   ├── panel-events.js       # Tab switching, button wiring
│   ├── toggle-button.js      # Draggable floating toggle (separate Shadow DOM)
│   ├── slot-switcher.js      # Active resume slot indicator
│   ├── theme.js              # Light/dark theme toggle
│   ├── status.js             # Status bar messages
│   └── consent.js            # Data collection consent banner
├── features/
│   ├── analysis.js           # Job analysis (match score, gaps, insights)
│   ├── chat.js               # AI Coach chat with per-URL persistence
│   ├── cover-letter.js       # 4-paragraph cover letter
│   ├── ats-resume.js         # 2-phase ATS resume (chips → preview)
│   ├── interview-prep.js     # Timed practice, scoring, follow-ups, analytics, report
│   ├── save-applied.js       # Save job + mark applied + status changes
│   └── saved-jobs.js         # Saved-jobs list rendering in the panel
├── autofill/
│   ├── autofill-pipeline.js  # Orchestrator
│   ├── field-detection.js    # Detects inputs, selects, radios, checkboxes, custom dropdowns
│   ├── fill-strategies.js    # Per-field-type fill logic
│   ├── badges.js             # Field-level status pills
│   └── inline-chips.js       # Floating quick-fill chip bar
├── auto-scan/
│   ├── auto-scan.js          # Orchestrates ambient scoring on job pages
│   ├── keyword-matcher.js    # JD↔profile keyword overlap (zero AI)
│   └── score-widget.js       # Floating score pill, click-outside dismiss
├── platform/
│   ├── detector.js           # Platform detection from URL + DOM
│   ├── jd-extractor.js       # Dispatcher → provider
│   ├── spa-monitor.js        # URL-change watcher for SPAs
│   └── providers/
│       ├── linkedin.js
│       ├── workday.js
│       ├── greenhouse-lever.js
│       ├── indeed.js
│       ├── generic.js        # Text-density fallback
│       ├── apply-detector.js # Detects "apply" click on any platform
│       └── linkedin-profile.js # LinkedIn /in/me detail-page scraping helpers
└── storage/
    ├── analysis-cache.js     # Client-side analysis cache (24h TTL, max 50)
    └── job-notes.js          # Per-job notes
```

---

## 3. User Personas & Access Model

### Free user (no sign-in)

- Brings their own API key for any of 10+ local AI providers (default: Gemini Flash)
- All processing happens client-side
- Full feature access: analysis, chat, cover letter, resume, autofill, interview prep, job tracker
- Data stored in `chrome.storage.local` only

### Signed-in user (Google OAuth via Supabase)

All free-user capabilities, plus:

- Backend AI via Supabase Edge Function (no API key required — uses free-tier Gemini/Groq)
- Server-side JD digest caching (7-day TTL, faster repeat analyses)
- Usage logging and token audit trail
- Optional opt-in for aggregated market-intelligence data collection (JD metadata + activity metrics)

---

## 4. Features

### 4.1 Job Analysis

**Entry point:** Analysis tab → "Analyze Job" button.
**Backend handler:** `ANALYZE_JOB` in `background.js`.

Analyzes the current job description against the user's active resume slot and returns a structured match assessment.

**Flow:**

1. `extractJobDescription()` runs (platform-specific selectors → text-density fallback).
2. `expandTruncatedContent()` clicks any "Show more" / expand buttons on LinkedIn, Workday, Indeed.
3. `handleDigestJD()` creates (or retrieves from cache) a ~500-token structured digest.
4. `sliceProfileForOperation('analysis')` trims the profile to match-relevant fields only.
5. AI returns a JSON response with match score, matching/missing skills, recommendations, insights.

**Output schema:**

| Field | Type | Description |
|---|---|---|
| `matchScore` | 0-100 | Overall fit score |
| `matchingSkills` | string[] | Profile skills that match JD |
| `missingSkills` | string[] | JD requirements not in profile |
| `recommendations` | string[] | Actionable advice |
| `insights.strengths` | string | Narrative of strongest qualifications |
| `insights.gaps` | string | Narrative of qualification gaps |
| `insights.keywords` | string[] | ATS-relevant keywords to incorporate |
| `jdDigest` | object | Cached structured digest (reused downstream) |

**UI:**

- SVG circular score ring (green ≥70, amber 45-69, red <45)
- Matching-skills tags (green) and missing-skills tags (red)
- Expandable insights panel
- Match-score ring rendered on every saved-job card

**Caching:**

- **Client:** `ac_analysisCache` keyed by URL, 24-hour TTL, max 50 entries
- **Server:** `jd_cache` table keyed by (user_id, SHA-256(jd_text), action_type='analysis'), 7-day TTL

**Token budget:** 4,096 (configurable).

---

### 4.2 AI Coach Chat

**Entry point:** Coaching tab (second bottom-nav button).
**Backend handler:** `CHAT_MESSAGE`.

Contextual AI chat that answers career and application questions using the user's profile, the current JD analysis, and conversation history.

**Context assembly:**

Every message ships `buildRichContextForPrompt()` which includes:

- Sliced user profile (relevant fields)
- Applicant context (free-form Q&A, dumps)
- JD digest (if a job has been analyzed on this URL)
- Analysis summary (if available)

**Quick-start chips:**

"Am I a good fit?", "How to prepare?", "Company research", "What to highlight?".

**Persistence:**

- Per-URL chat history under `chatHistory_${urlHash}`
- Up to 20 active conversations, LRU eviction
- Up to 50 messages per conversation
- Clear button resets the current thread

**Token budget:** 1,024 (configurable).

---

### 4.3 Cover Letter

**Entry point:** Analysis tab → "Cover Letter" button (appears after analysis).
**Backend handler:** `GENERATE_COVER_LETTER`.

Produces a 4-paragraph, 400–500 word tailored cover letter.

**Structure:**

1. **Hook** — opens with the specific role and a concrete reason for excitement
2. **Skills match** — evidence of relevant qualifications drawn *only* from the stored profile
3. **Culture fit** — alignment with company values and mission
4. **Close** — enthusiastic, specific call-to-action

**Safety constraints:**

- Never invents experience, credentials, or metrics
- Only references content present in the user's profile
- Plain text, first person, professional tone

**UI:** Rendered in the Analysis tab with a copy-to-clipboard button.

**Token budget:** 2,048.

---

### 4.4 ATS Resume

**Entry point:** Analysis tab → "ATS Resume" button.
**Backend handler:** `GENERATE_RESUME`.

Two-phase flow for generating an ATS-friendly resume tailored to the current JD.

**Phase 1 — Instruction chips:**

Toggleable chips + custom instruction textarea:

- Leadership focus
- Technical depth
- Metrics & quantification
- Match JD keywords
- Fit on 1 page

**Phase 2 — Generate & preview:**

- AI produces a single-column, ATS-safe markdown resume
- Opens in a new tab with formatted preview, "Copy text", and "Download PDF" buttons
- Sections: Contact → Summary → Experience → Education → Skills → Certifications → Projects
- 3–5 action-verb bullets per role, quantified where profile data allows, keywords mirrored from JD

**Related:** `REWRITE_BULLETS` handler rewrites existing experience bullets to better target the JD without fabricating new experience.

**Token budget:** 8,192 (largest; configurable).

---

### 4.5 Autofill

**Entry point:** Analysis tab → "AutoFill Application" button on any application page.
**Backend handlers:** `GENERATE_AUTOFILL`, `MATCH_DROPDOWN`.
**Supporting files:** `extension/deterministicMatcher.js`, `src/autofill/*`.

Two-tier form fill pipeline.

**Tier 1 — Deterministic (zero AI cost):**

30+ field types matched via regex against the user's profile and Q&A list (see Section 4.13).

**Tier 2 — AI generation:**

Fields that don't match deterministically are sent to the AI along with available options. For dropdowns/radios, the AI's chosen value is validated against actual options to prevent hallucination.

**Field detection:**

- `<input type="text">`, `<textarea>`, `<select>`, `<input type="radio">`, `<input type="checkbox">`
- Custom dropdowns via `aria-role` / `data-testid` patterns (Greenhouse, Lever, Workday)

**Label resolution hierarchy:**

1. `<label for="id">`
2. Wrapping `<label>`
3. `aria-label`
4. `aria-labelledby`
5. `data-label`
6. `placeholder` (fallback)

**Delivery modes:**

| Mode | UX |
|---|---|
| Preview modal | All fields + answers with checkboxes; user opts in per field |
| Inline chips | Floating chip bar; click a chip to fill its field |
| Field badges | Small green pill overlaid on each field; click to apply |

---

### 4.6 Interview Prep

**Entry point:** My Jobs (profile page) → "Prep" button on any tracked job. Also accessible from the Saved tab in the side panel.
**Backend handlers:** `GENERATE_INTERVIEW_QUESTIONS`, `EVALUATE_INTERVIEW_ANSWER`, `GENERATE_FOLLOWUP_QUESTION`, `GENERATE_POSITIONING_ADVICE`.

Comprehensive interview preparation with timed practice, AI scoring, adaptive follow-ups, analytics, and a full-page report.

**Question generation:**

- Categories (user selects ≥1): **Behavioral**, **Technical**, **Situational**, **Role-specific**
- 10–12 questions per session, each with category, difficulty, key points (hints), time limit (default 120s)

**Practice UI:**

- Countdown timer (optional)
- Hint panel with key points
- Answer textarea with live word count
- Submit works with or without timer

**Scoring:**

- 1–10 score per answer
- Structured strengths + improvements lists
- Sample answer shown after submission
- Skills referenced tagged

**Adaptive follow-ups:**

- If score < 5, system offers a follow-up question targeting the weak area
- Max 8 follow-ups per session

**Analytics dashboard:**

- Overall readiness score
- Per-category averages as horizontal bars
- Stats: questions answered, avg time per answer, follow-ups completed
- Weak areas (categories with avg < 6)

**Positioning advice:**

- Available after 5+ answers
- 300–500 word narrative of interview strategy
- Focuses on weak areas + role context

**Persistence:**

- Full session in `interviewSession_${jobId}` (chrome.storage.local)
- Questions, answers, scores, analytics, positioning advice, timestamps

---

### 4.7 Job Tracker

**Entry point:** Side panel "Saved" tab, plus full-page My Jobs view on the profile page.
**Backend handlers:** `SAVE_JOB`, `TOGGLE_JOB_APPLIED`, `UPDATE_JOB_STATUS`, `DELETE_JOB`, `GET_SAVED_JOBS`.

A unified job pipeline with filter tabs and status dropdown per job.

**Pipeline statuses:**

Saved → Applied → Interview → Offer → Rejected → Withdrawn

**Job card (My Jobs view):**

- 80% match-score ring
- Title (links to source URL) + company + last-status date
- View JD button (inline expand of stored JD text)
- Status pill (colored dropdown — one of the six pipeline states)
- Prep button (launches in-page interview prep)
- Delete button (two-step confirm)

**Auto-detection:**

`apply-detector.js` monitors clicks on "Apply" buttons across platforms; when detected, the extension prompts to auto-mark the job as Applied.

**Limits:** Max 100 saved jobs, LRU eviction.

---

### 4.8 Auto-Scan Widget

**Entry point:** Automatic — appears on any recognized job posting page.
**Files:** `src/auto-scan/*`.

Ambient match score widget that floats on the bottom-right of a job page without requiring the user to open the side panel.

**How it works:**

- `keyword-matcher.js` computes the overlap between the page's visible text and the active profile's skills
- Uses keyword aliasing (JS→JavaScript, React.js→React, etc.) and deterministic scoring (zero AI, zero tokens)
- `score-widget.js` renders a circular badge with click-outside dismiss and tap-to-expand

---

### 4.9 Profile & Resume Management

**Entry point:** Profile page (`extension/profile.html`).
**Sidebar sections:** User Context / My Jobs / AI Settings.

**Resume upload:**

- Drag-and-drop PDF or DOCX
- PDF parsing via pdf.js (runs in extension context with `wasm-unsafe-eval`)
- DOCX parsing via mammoth.js
- Parsed text sent to AI via `PARSE_RESUME` handler → structured JSON → populates profile fields

**Profile fields:**

| Section | Fields |
|---|---|
| Contact | Full name, email, phone, location |
| Links | LinkedIn URL, portfolio website, GitHub |
| Summary | Professional summary (textarea) |
| Skills | Comma-separated tags |
| Experience | Company, title, start/end dates, description/bullets (repeatable) |
| Education | Degree, school, graduation year (repeatable) |
| Certifications | Name + issuer (list) |
| Projects | Name, description, technologies (list) |

**Multi-slot resumes:**

- Up to 10 resume slots (e.g., "PM resume", "IC engineering resume")
- Each slot stores a complete, independent profile
- One profile (identity, contact info, applicant context) is global — only documents differ per slot
- Quick-switch from the Analysis-tab header

**Applicant context (Q&A):**

- Free-form Q&A list for common application questions (motivation, why-this-company, etc.)
- Consumed by the deterministic matcher and included in AI prompts

---

### 4.10 LinkedIn Profile Import

**Entry point:** User Context → "Import from LinkedIn" button (onboarding + refresh).
**Backend handler:** `START_LINKEDIN_IMPORT`.
**Files:** `extension/background.js` (orchestrator), `src/platform/providers/linkedin-profile.js` (helpers).

Multi-page scraper that visits the user's own LinkedIn detail pages, waits for full hydration, scrolls + expands all "Show more" buttons, then extracts structured data.

**Pages visited (in order):**

1. `/in/me/details/experience/`
2. `/in/me/details/education/`
3. `/in/me/details/certifications/`
4. `/in/me/details/projects/`
5. `/in/me/details/skills/`

**Per-page readiness:** Polls for presence of `.pvs-list__paged-list-item`, absence of `.artdeco-loader` spinners, and stable `scrollHeight` across two consecutive polls (~600ms).

**Merge strategy:**

| Section | Strategy |
|---|---|
| Experience | Replace (LinkedIn is authoritative) |
| Education | Replace |
| Projects | Replace |
| Certifications | Union (preserve user-added entries) |
| Skills | Union |

Normalizes LinkedIn's appended duration strings (e.g., `" · 5 mos"`) and filters company-block artifacts.

**Snapshot:** Writes a Markdown snapshot of the imported data to local storage for the user's reference.

---

### 4.11 AI Settings

**Entry point:** AI Settings section of the profile page.
**File:** `extension/profile.js`, `extension/aiService.js`.

**Provider configuration:**

- Provider dropdown: **Anthropic**, **OpenAI**, **Google Gemini**, **Groq**, **Cerebras**, **Together AI**, **OpenRouter**, **Mistral**, **DeepSeek**, **Cohere**
- Model selector (populated per provider)
- API key input
- Temperature slider (0.0–1.0)
- "Use backend" toggle (on by default for signed-in users)
- "Test connection" button (4-layer diagnostic)

**Token budget sliders:**

| Operation | Default | Range |
|---|---|---|
| Resume generation | 8,192 | 1,024–16,384 |
| Job analysis | 4,096 | 1,024–8,192 |
| Cover letter | 2,048 | 512–4,096 |
| Chat | 1,024 | 256–4,096 |
| Interview prep | 4,096 | 1,024–8,192 |

**9 editable system prompts:**

Resume Generation, Cover Letter, Job Analysis, Autofill, Resume Parsing, JD Digest, Chat Persona, Backend AI Persona, Interview Prep. Each has "Modified" badge and per-prompt + global reset buttons.

**Diagnostic system:**

`TEST_CONNECTION` validates 4 layers with per-layer pass/fail and a debug log:

| Layer | Check |
|---|---|
| Settings | Provider + API key present |
| Auth | Supabase session valid, JWT not expired |
| Edge Function | Can call `generate-answer` and get 200 |
| Local AI | Can call selected provider API |

**Data consent:**

Opt-in checkbox controls aggregate data collection (JD intelligence + candidate activity metrics).

---

### 4.12 JD Digest Pipeline

**Backend handler:** `DIGEST_JD`.

Single AI call that converts a raw JD (~2,500 tokens) into a structured ~500-token digest. Every downstream operation (analysis, cover letter, resume, interview prep, chat) consumes the digest instead of the raw JD.

**Example output:**

```json
{
  "role_title": "Senior Product Manager",
  "company": "Acme Corp",
  "seniority": "senior",
  "employment_type": "full-time",
  "location": "San Francisco, CA (Hybrid)",
  "key_requirements": ["5+ years PM experience", "B2B SaaS"],
  "nice_to_haves": ["MBA", "SQL proficiency"],
  "responsibilities": ["Own product roadmap", "Lead cross-functional team"],
  "tech_stack": ["Jira", "Figma", "SQL", "Amplitude"],
  "soft_skills": ["Leadership", "Communication"],
  "culture_signals": ["Fast-paced", "Data-driven"],
  "ats_keywords": ["product strategy", "stakeholder management"],
  "years_experience": "5+",
  "education": "Bachelor's required, MBA preferred",
  "salary_range": "$150K-$180K",
  "industry": "Enterprise SaaS"
}
```

**Caching:**

- **Server-side:** `jd_cache` table keyed by SHA-256(jd_text) + user_id + action_type, 7-day TTL
- **Client-side:** Stored on each saved job as `jdDigest` for offline access
- **Reuse:** All downstream ops pull the digest; the raw JD is never re-sent

**Net effect:** ~80% reduction in JD tokens per operation, enabling aggressive profile slicing on top.

---

### 4.13 Deterministic Field Matcher

**File:** `extension/deterministicMatcher.js`.

Zero-AI-cost matcher that handles 30+ common application field types via regex.

**Covered field types:**

*Personal information:* First name, last name, full name, email, phone, LinkedIn URL, GitHub URL, portfolio, city/state/location.

*EEO / demographics:* Gender, gender identity, sexual orientation, race/ethnicity, Hispanic or Latino identification, veteran status, disability status, pronouns.

*Work preferences:* US work authorization, visa sponsorship requirement, start date, notice period, employment type, desired salary/hourly rate, work arrangement (remote/hybrid/onsite), relocation, travel, background check consent, drug test consent, driver's license, security clearance.

*Education:* Highest education level, certifications/licenses.

**Matching strategy:**

1. Regex pattern match against question text (e.g., `\bgender.?identity\b`)
2. If the profile or Q&A list has a stored answer → use it directly
3. Otherwise select a safe default (e.g., "Prefer not to say" for demographics)
4. Never fabricates sensitive answers (legal status, demographics)

---

## 5. Platform Support

### JD extraction

| Platform | Priority | Detection | JD expansion |
|---|---|---|---|
| LinkedIn | P0 | URL regex + DOM selectors | "Show more" auto-click |
| Workday | P0 | URL regex (myworkdayjobs.com) + selectors | "Show more" auto-click |
| Greenhouse | P1 | URL regex + `[data-section="job-details"]` | N/A |
| Lever | P1 | URL regex + `.posting-*` selectors | N/A |
| Indeed | P2 | URL regex + `#jobDescriptionText` | "Show more" auto-click |
| Glassdoor | P2 | URL regex + `[data-test="descriptionSection"]` | N/A |
| Generic ATS | Fallback | Text-density algorithm (largest contiguous block) | N/A |

### Metadata extraction

- **Title:** `<h1>`, `og:title` meta, platform selectors
- **Company:** `og:company`, platform selectors
- **Location:** Regex + geolocation hints
- **Salary:** Regex for common formats (`$X–$Y per year`, etc.)

### SPA navigation

`spa-monitor.js` watches `history.pushState` + `popstate` to re-trigger extraction when URL changes without a full reload (LinkedIn, Workday).

---

## 6. AI Provider Architecture

### Two-layer strategy

**Layer 1 — Backend (Supabase Edge Function):**

- Available to signed-in users
- No API key required
- Server-side caching (`jd_cache`, 7-day TTL)
- Provider chain: Gemini 2.0 Flash (primary) → Groq Llama 3.3 70B (fallback)
- 502 responses include `provider_errors[]` with per-provider failure context
- Retries: 2× on 429 before failing over to the next provider

**Layer 2 — Local (user's API key):**

- Always available when an API key is configured
- Direct calls from the extension to provider APIs
- No server-side caching
- Exponential backoff (1s → 2s) on transient failures

### Supported local providers

| Provider | Models | Free tier |
|---|---|---|
| Google Gemini | 2.0 Flash, 2.0 Flash-Lite, 2.5 Pro | Yes (generous) |
| Groq | Llama 3.3 70B | Yes (6K req/day) |
| Cerebras | Llama 3.3 70B | Yes |
| Anthropic | Claude Sonnet 4.5, Haiku 4.5, Opus 4.6 | No |
| OpenAI | GPT-4.1, GPT-4o, o4/o3 | No |
| Together AI | Various open models | Limited |
| OpenRouter | Multi-model router | Varies |
| Mistral | Mistral models | Limited |
| DeepSeek | DeepSeek Chat | Limited |
| Cohere | Command models | Limited |

### Edge Function: `generate-answer`

- **Runtime:** Deno, deployed via Supabase CLI
- **Deploy flag:** `--no-verify-jwt` (gateway JWT verification disabled; JWT validated internally via `supabase.auth.getUser()`)
- **Action types:** `answer_generation`, `cover_letter`, `resume`, `resume_generation`, `jd_digest`, `chat`, `classification`, `interview_prep`
- **Passthrough:** `interview_prep` uses a lightweight system prompt so the model returns clean JSON
- **Max tokens:** Up to 16,384 per request
- **Rate limiting:** Disabled during development (to be re-enabled at 200/hour before prod)
- **Logging:** All calls logged to `usage_logs` with token counts

---

## 7. Data Model

### Chrome local storage

| Key | Scope | Approx size |
|---|---|---|
| `profile` | Active slot profile | ~5 KB |
| `slotData_0 … slotData_9` | Per-slot profiles | ~5 KB each |
| `slotNames` | User-defined slot labels | <1 KB |
| `aiSettings` | Provider, model, key, temp | <1 KB |
| `customPrompts` | 9 editable system prompts | ~3 KB |
| `qaList` | Applicant Q&A list | ~2 KB |
| `applicantContext` | Conversational intake Q&A | ~5 KB |
| `savedJobs` | Max 100 tracked jobs | ~500 KB |
| `ac_analysisCache` | Max 50, 24h TTL | ~150 KB |
| `chatHistory_${urlHash}` | Max 20 chats, 50 msgs each | ~400 KB total |
| `interviewSession_${jobId}` | Per saved job | ~10 KB each |
| `linkedinImportSnapshot` | Last-import markdown | ~5 KB |
| `ac_theme` | Light/dark | <1 KB |

**Total estimated:** 2–3 MB of ~10 MB Chrome local-storage limit.

### Supabase database (8 tables)

| Table | Purpose | RLS |
|---|---|---|
| `profiles` | User identity, settings, consent | User owns their row |
| `experiences` | Work history entries | User owns via `profile_id` |
| `applications` | Tracked applications | User owns via `profile_id` |
| `generated_answers` | Per-application AI answers | User owns via application chain |
| `usage_logs` | Immutable token audit trail | User reads own |
| `jd_cache` | Server-side AI response cache | User owns cache rows |
| `jd_intelligence` | Market data from analyzed JDs | User inserts/reads own; service role reads all |
| `candidate_activity` | Aggregated engagement metrics | User upserts/reads own; service role reads all |

### Migrations

```
supabase/migrations/
├── 20260326085609_initial_schema.sql
├── 20260326085851_storage_policies.sql
├── 20260327100841_add_resume_generation_action_type.sql
├── 20260331120000_add_jd_cache_and_digest_action.sql
├── 20260331140000_add_interview_prep_action.sql
└── 20260401200000_add_data_collection_tables.sql
```

---

## 8. Authentication & Security

### Google OAuth flow

1. User clicks "Sign in with Google" in AI Settings
2. Extension opens Supabase OAuth URL in a new tab
3. Google consent screen → callback to `https://<ref>.supabase.co/auth/v1/callback`
4. JWT + refresh token stored in `chrome.storage.local`
5. JWT auto-refreshed when it's within 120 seconds of expiring

### Backend security

- Edge Function deployed with `--no-verify-jwt` because the gateway's built-in JWT check rejected legitimate Chrome-extension requests; JWT is validated inside the function via `getUser()`
- All tables use Row-Level Security — users can only see their own rows
- Service-role key is used only server-side for admin analytics queries
- Dynamic CORS: Edge Function accepts requests from any `chrome-extension://` origin and any `*.supabase.co` domain

### Client-side security

- API keys stored in Chrome local storage (encrypted at rest by Chrome)
- No API keys ever transmitted to the Supabase backend
- Side panel renders in a Shadow DOM — style and JS isolated from the host page
- Content Security Policy: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'` (WASM required for pdf.js)

---

## 9. Performance & Caching

### Caching layers

| Layer | Scope | TTL | Max size | Key |
|---|---|---|---|---|
| Analysis cache | Client | 24 h | 50 entries | URL |
| JD cache | Server | 7 d | Unlimited | SHA-256(jd_text) + user + action_type |
| Chat history | Client | No TTL | 20 chats × 50 msgs | URL hash |
| Interview sessions | Client | No TTL | Per saved job | Job ID |
| Saved jobs | Client | No TTL | 100 jobs | URL (deduped) |

### UI performance

- **Lazy panel creation:** Content script creates the side panel only after first toggle click
- **Shadow DOM isolation:** No style or event leaks in either direction
- **Debounced repositioning:** ResizeObserver + scroll listeners throttled to 60 fps
- **Bundled content script:** `extension/content.js` is bundled from `src/` by esbuild for fast injection

### Edge Function performance

- Cold start: ~2–3 s (Deno runtime)
- Warm response: <500 ms on cache hit, 2–5 s on LLM call
- Gemini Flash: ~1–2 s typical
- Groq: <1 s (hardware-accelerated)

### Token optimization summary

| Technique | Typical savings |
|---|---|
| JD digest | ~80% reduction on JD tokens |
| Profile slicing | 30–50% reduction on profile tokens |
| Deterministic matching | 100% (zero AI) for 30+ field types |
| Server-side cache | ~70% hit rate on repeat analyses |
| Client-side analysis cache | Eliminates redundant re-analyses within 24 h |

**Projected total:** ~70% reduction vs. a naïve "send full JD + full profile every time" implementation.

---

## 10. Privacy & Data Handling

| Principle | Implementation |
|---|---|
| Local-first | All core features work without any server communication |
| Explicit consent | Data collection requires opt-in checkbox |
| Minimal collection | Only structured digests and metrics synced — never raw resumes |
| User ownership | RLS ensures users can only see their own data |
| No third-party tracking | No analytics or telemetry to anyone but Supabase |
| No background transmission | No data leaves the browser without a direct user action |

### Data residency

- **Client-side:** User's local machine (Chrome storage)
- **Server-side:** Supabase project in user-selected region
- **AI providers:** Processed in-transit only (no persistent storage on free tiers)

### Sensitive field handling

- EEO/demographic fields default to "Prefer not to say"
- Legal-status fields (work auth, visa) never fabricated
- Salary data kept client-side
- Resume text never stored server-side; only the structured digest

---

## 11. Design System

**Name:** "The Organic Archive" — sage, natural, archive-feeling aesthetic.

| Token | Value |
|---|---|
| Primary | `#4f614d` (Sage green) |
| Primary dark | `#384937` |
| Primary gradient | `linear-gradient(145deg, #4f614d 0%, #384937 100%)` |
| Panel background | `#f9f9f8` |
| Profile background | `#ffffff` |
| Surfaces | `#f3f4f3` (low) → `#edeeed` (mid) → `#e4e5e3` (high) |
| Text | `#191c1c` primary, `#434842` secondary, `#727971` muted |
| Font | Manrope (variable, self-hosted woff2) |
| Icons | Material Symbols Outlined (self-hosted woff2, ligature-based) |
| Radius | 8 px small, 12 px medium, 16 px large |

**Icon rule:** Always render icons as `<span class="material-symbols-outlined">icon_name</span>`. No emoji characters anywhere in the codebase.

**Font loading:** Fonts are loaded from `chrome.runtime.getURL()` inside the Shadow DOM so they work on any host page without extra network requests.

---

## 12. Phase History

| Phase | Date | Deliverables |
|---|---|---|
| 1: Fork & setup | 2026-03-26 | Forked JobMatchAI, extension loads, basic JD extraction, EEO matcher |
| 2: Supabase backend | 2026-03-27 | 6 tables + RLS, Edge Function, JWT auth, usage logging |
| 3: Backend wiring | 2026-03-27 | Google OAuth, Edge Function routing, fallback to local AI, cover letter, ATS resume, JSON parser |
| 3.5: Token optimization | 2026-03-31 | JD digest pipeline, profile slicing, server-side cache, deterministic matcher (30+ types), Groq primary |
| 4: Chat + UX | 2026-03-31 | AI Coach chat, ATS resume redesign (2-phase), home nav tab |
| 4.5: Configurable prompts | 2026-03-31 | 8 editable prompts, token budget sliders, Edge Function prompt fixes |
| 5a: Edge Function fix | 2026-04-01 | Root-caused `verify_jwt` gateway rejection. Fixed with `--no-verify-jwt`. 4-layer diagnostic, `[EDGE]` logging, action_type on all calls |
| 5b: Interview prep + JD | 2026-04-01 | Timed practice, scoring, follow-ups, analytics, report. JD expansion. Digest cached on saved jobs. Token budget fix. |
| 6: Data collection | 2026-04-05 | Consent layer, scoring infra, `jd_intelligence`, `candidate_activity` |
| 6.5: Modular refactor | 2026-04-07 | Split monolithic content.js into 33 ESM modules under `src/`; esbuild bundler |
| 7: Auto-scan widget | 2026-04-08 | Ambient keyword match score widget on job pages |
| 7.5: Design system | 2026-04-09 | "Organic Archive" sage system, Manrope font, provider-specific JD extractors |
| 8: Unified job tracker | 2026-04-10 | Full pipeline (Saved → Applied → Interview → Offer → Rejected → Withdrawn), auto-detect applications, filter tabs |
| 8.5: UI rebuild | 2026-04-10 | Profile page rebuilt with Stitch layout — left sidebar nav (User Context / My Jobs / AI Settings), match-score rings |
| 9: Icon system | 2026-04-11 | Replaced all emojis with self-hosted Material Symbols Outlined icons |
| 9.5: LinkedIn import v3 | 2026-04-12 | Multi-page scraper, smart merge (replace vs. union), markdown snapshot |
| 9.6: In-page interview prep | 2026-04-12 | Full-page interview prep in My Jobs replaces broken LinkedIn redirect |

### Planned

- **Phase 10 — Ship & scale:** Chrome Web Store submission, WXT + TypeScript migration, server-side prompt management, billing (Stripe), full Workday field handler port from `job_app_filler`, cross-device sync.

---

*End of Functional Specification Document*
