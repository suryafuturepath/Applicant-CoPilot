# Functional Specification Document — Applicant Copilot

**Version:** 1.0
**Date:** 2026-04-02
**Status:** Phase 6 (Data Collection) Complete
**Author:** Surya / Claude Code

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [System Architecture](#2-system-architecture)
3. [User Personas & Access Model](#3-user-personas--access-model)
4. [Feature Specifications](#4-feature-specifications)
   - 4.1 [Job Analysis](#41-job-analysis)
   - 4.2 [Ask AI Chat](#42-ask-ai-chat)
   - 4.3 [Cover Letter Generation](#43-cover-letter-generation)
   - 4.4 [ATS Resume Builder](#44-ats-resume-builder)
   - 4.5 [AutoFill](#45-autofill)
   - 4.6 [Interview Prep](#46-interview-prep)
   - 4.7 [Job Saving & Application Tracking](#47-job-saving--application-tracking)
   - 4.8 [Profile Management](#48-profile-management)
   - 4.9 [Settings & Configuration](#49-settings--configuration)
   - 4.10 [JD Digest Pipeline](#410-jd-digest-pipeline)
   - 4.11 [Deterministic Field Matcher](#411-deterministic-field-matcher)
   - 4.12 [Diagnostic System](#412-diagnostic-system)
   - 4.13 [Data Collection & Analytics (Phase 6)](#413-data-collection--analytics-phase-6)
5. [Platform Support](#5-platform-support)
6. [AI Provider Architecture](#6-ai-provider-architecture)
7. [Data Model](#7-data-model)
8. [Authentication & Security](#8-authentication--security)
9. [Performance & Caching Strategy](#9-performance--caching-strategy)
10. [Privacy & Compliance](#10-privacy--compliance)
11. [Phase History](#11-phase-history)

---

## 1. Product Overview

### What It Is

Applicant Copilot is a Chrome extension that acts as an AI-powered copilot for job seekers. It sits alongside job listing pages (LinkedIn, Workday, Greenhouse, etc.) and provides real-time job analysis, application autofill, tailored content generation, and interview preparation — all from a single side panel.

### Problem Statement

Job seekers waste hours per application customizing resumes, writing cover letters, and filling repetitive forms. They lack objective feedback on job fit and enter interviews underprepared. Existing tools are either too generic (ChatGPT copy-paste) or too locked-in (single ATS platform).

### Solution

A browser-native copilot that:

- **Analyzes** any job description and scores profile match (0-100)
- **Generates** tailored cover letters, ATS-optimized resumes, and form answers
- **Autofills** application forms with deterministic + AI matching
- **Prepares** for interviews with timed practice, AI scoring, and adaptive follow-ups
- **Learns** user context progressively for increasingly personalized outputs

### Key Differentiators

| Capability | Applicant Copilot | Generic AI Tools |
|---|---|---|
| Job-page aware | Extracts JD from DOM in real-time | User copy-pastes |
| Profile-aware | Persistent user profile + multi-resume | No memory |
| Form-aware | Detects fields, matches deterministically | N/A |
| Platform-aware | LinkedIn, Workday, Greenhouse selectors | N/A |
| Cost-optimized | JD digest caching, profile slicing, deterministic matching | Full context every call |
| Multi-provider | 10+ local providers + backend Edge Functions | Single provider |

---

## 2. System Architecture

### High-Level Diagram

```
Browser (Chrome Extension - Manifest V3)
├── Content Script (content.js)
│   ├── Shadow DOM Side Panel (5 tabs)
│   ├── JD Extraction (platform-specific selectors)
│   ├── Form Detection & AutoFill
│   └── JD Expansion ("Show more" click)
│
├── Service Worker (background.js)
│   ├── 11 AI Message Handlers
│   ├── Chrome Storage Management
│   └── Supabase Client Proxy
│
├── Profile Page (profile.html + profile.js)
│   ├── Resume Upload (PDF/DOCX parsing)
│   ├── Profile Form Editor
│   └── Settings Panel
│
└── AI Service Layer (aiService.js)
    ├── 10+ Local Provider Adapters
    ├── 9 Configurable Prompt Builders
    └── Token Budget Management

Supabase Backend
├── Auth (Google OAuth)
├── PostgreSQL + RLS (8 tables)
├── Edge Function: generate-answer
│   ├── Gemini Flash (primary)
│   └── Groq Llama 3.3 70B (fallback)
└── JD Cache (7-day TTL)
```

### Communication Model

All inter-component communication uses Chrome's `chrome.runtime.sendMessage()` and `chrome.runtime.onMessage` pattern:

- **Content Script -> Service Worker**: AI requests, storage reads/writes
- **Profile Page -> Service Worker**: Profile saves, settings updates
- **Service Worker -> Supabase**: Edge Function calls, auth, database operations

---

## 3. User Personas & Access Model

### Free User (No Sign-In)

- Uses their own API key with any of 10+ local AI providers
- All processing happens client-side
- Full feature access (analysis, chat, cover letter, resume, autofill, interview prep)
- Data stored in Chrome local storage only

### Signed-In User (Google OAuth via Supabase)

- Everything from Free User, plus:
- Backend AI via Supabase Edge Functions (no API key needed — uses free-tier Gemini/Groq)
- Server-side JD digest caching (7-day TTL, faster repeat analysis)
- Usage logging and token audit trail
- Cross-device data sync (future)
- Optional data consent for JD intelligence + candidate activity analytics

---

## 4. Feature Specifications

### 4.1 Job Analysis

**Location:** Home tab, "Analyze Job" button
**Files:** `background.js` (ANALYZE_JOB handler), `content.js` (UI rendering)

#### Description

Analyzes the current job description against the user's profile and produces a structured match assessment.

#### Input

- Raw job description text (auto-extracted from page DOM)
- Job title, company, location (parsed from page metadata)
- User profile (skills, experience, education — sliced to match-relevant fields)

#### Process

1. Auto-triggers JD Digest extraction (or reuses cached digest)
2. Slices user profile to only match-relevant fields via `sliceProfileForOperation('analysis')`
3. Sends digest + sliced profile to AI with analysis system prompt
4. AI returns structured JSON response

#### Output

| Field | Type | Description |
|---|---|---|
| `matchScore` | Number (0-100) | Overall profile-to-job fit score |
| `matchingSkills` | String[] | Skills from profile that match JD requirements |
| `missingSkills` | String[] | JD requirements not found in profile |
| `recommendations` | String[] | Actionable advice for improving candidacy |
| `insights.strengths` | String | Narrative of strongest qualifications |
| `insights.gaps` | String | Narrative of qualification gaps |
| `insights.keywords` | String[] | ATS-relevant keywords to incorporate |
| `jdDigest` | Object | Cached structured digest (~500 tokens) |

#### UI Rendering

- Circular match score badge (color-coded: green >70, yellow 40-70, red <40)
- Green skill tags (matching) and red skill tags (missing)
- Bulleted recommendations list
- Expandable insights section (strengths, gaps, ATS keywords)
- Truncation notice if JD or resume exceeded token limits

#### Caching

- Client-side: `ac_analysisCache` keyed by URL (24-hour TTL, max 50 entries)
- Server-side: `jd_cache` table keyed by (user_id, jd_hash, 'analysis') with 7-day TTL

#### Token Budget

4,096 tokens (configurable via Settings)

---

### 4.2 Ask AI Chat

**Location:** Ask AI tab (Tab 2)
**Files:** `background.js` (CHAT_MESSAGE handler), `content.js` (chat UI)

#### Description

A contextual chat interface that answers career questions using the user's profile, current JD analysis, and conversation history.

#### Pre-Conditions

- A job must be analyzed first (empty state shown otherwise)
- Suggested quick-start chips: "Am I a good fit?", "Interview prep", "Company research", "What to highlight?"

#### Input

- User's text message
- Conversation history (up to 50 messages, rolling window)
- Rich context: JD digest + sliced profile + analysis highlights

#### Output

- AI response text (career advisor persona, specific, concise, <200 words default)
- Copy and retry buttons on each AI message
- Typing indicator during generation

#### Context Assembly

Uses `buildRichContextForPrompt()` which includes:
- Sliced user profile (relevant fields only)
- Applicant context (Q&A, text dumps)
- JD digest (if available)
- Analysis summary (if available)

#### Storage

- Per-URL chat history in `chatHistory_${urlHash}`
- Max 20 active conversations (LRU eviction)
- Clear button resets current conversation

#### Token Budget

1,024 tokens (configurable via Settings)

---

### 4.3 Cover Letter Generation

**Location:** Home tab, "Cover Letter" button
**Files:** `background.js` (GENERATE_COVER_LETTER handler), `content.js` (output display)

#### Description

Generates a personalized, professional cover letter tailored to the specific job and user's background.

#### Input

- Job description (digest or raw)
- Analysis object (match score, matching/missing skills)
- Sliced user profile (experience, skills, summary)

#### Output

- Plain text cover letter (no markdown formatting)
- 4-paragraph structure:
  1. **Hook** — attention-grabbing opening referencing the specific role
  2. **Skills Match** — evidence of relevant qualifications from actual experience
  3. **Culture Fit** — alignment with company values and mission
  4. **Closing** — enthusiastic call-to-action
- 400-500 words target length

#### UI

- Full letter displayed in Home tab output area
- Copy button for clipboard
- Rewritable inline (user can request modifications via chat)

#### Safety Constraints

- Never fabricates experience or credentials
- Only references skills/experience from the user's profile
- First-person voice, professional tone

#### Token Budget

2,048 tokens (configurable via Settings)

---

### 4.4 ATS Resume Builder

**Location:** Home tab, "ATS Resume" button
**Files:** `background.js` (GENERATE_RESUME handler), `content.js` (instruction UI + preview)

#### Description

Generates an ATS-optimized resume targeting a 90+ ATS compatibility score, customized for the specific job description.

#### Two-Phase Flow

**Phase 1: Instruction Collection**
- Instruction chips (toggle on/off):
  - Leadership focus
  - Technical depth
  - Metrics & quantification
  - Match JD keywords
  - Fit on 1 page
- Custom instructions textarea for additional guidance
- "Generate" button triggers Phase 2

**Phase 2: Generation & Preview**
- AI generates markdown-formatted resume
- Preview rendered in modal with:
  - Formatted resume display
  - "Download as PDF" button
  - "Copy" button for raw text

#### Output Format

- Single-column markdown (no tables, graphics, or columns)
- Sections: Contact → Summary → Experience → Education → Skills → Certifications
- 3-5 action-verb bullets per role
- Quantified achievements where data exists in profile
- ATS keywords mirrored from JD

#### Related: Bullet Rewriting

`REWRITE_BULLETS` handler rewrites existing experience bullets to better target the JD and address missing skills — without fabricating experience.

#### Token Budget

8,192 tokens (largest budget — configurable via Settings)

---

### 4.5 AutoFill

**Location:** Home tab, "AutoFill Application" button
**Files:** `background.js` (GENERATE_AUTOFILL + MATCH_DROPDOWN handlers), `content.js` (form detection + fill), `deterministicMatcher.js`

#### Description

Detects application form fields on the current page and generates answers using a two-tier strategy: deterministic matching (zero AI cost) for known field types, and AI generation for complex/novel questions.

#### Form Detection

Detects these HTML element types:
- `<input type="text">` — text fields
- `<textarea>` — long-form answers
- `<select>` — native dropdowns
- `<input type="radio">` — radio button groups
- `<input type="checkbox">` — checkboxes
- Custom dropdowns (aria-role, data-testid patterns for Greenhouse/Lever/etc.)

#### Field Labeling Hierarchy

1. `<label for="id">` association
2. Wrapping `<label>` element
3. `aria-label` attribute
4. `aria-labelledby` reference
5. `data-label` custom attribute
6. `placeholder` attribute (fallback)

#### Two-Tier Matching

**Tier 1: Deterministic (Zero AI Cost)**

30+ field type patterns matched by regex — see Section 4.11 for full list.

**Tier 2: AI Generation**

For fields not matched deterministically:
1. Question text + available options sent to AI
2. AI generates answer from profile + Q&A context
3. Dropdown validation: AI's choice verified against actual options (prevents hallucination)

#### Output Delivery Methods

| Method | Trigger | UX |
|---|---|---|
| Preview Modal | Default | Shows all fields + answers with checkboxes; user selects which to apply |
| Inline Chips | Quick mode | Floating action bar with answer chips; click to fill |
| AutoFill Badges | Overlay mode | Green pills overlaid on each field; click to fill individually |

#### Answer Format

```json
{
  "question_id": "field_label",
  "field_type": "text|select|radio|textarea|checkbox",
  "selected_option": "For dropdowns/radios — exact option text",
  "generated_text": "For text/textarea — generated answer"
}
```

---

### 4.6 Interview Prep

**Location:** Saved Jobs tab -> "Prep" button on any saved job
**Files:** `background.js` (4 interview handlers), `content.js` (interview prep UI views)

#### Description

A comprehensive interview preparation system with timed practice, AI-scored answers, adaptive follow-up questions, and performance analytics.

#### 4.6.1 Question Generation

**Handler:** `GENERATE_INTERVIEW_QUESTIONS`

- **Input:** Saved job data + JD digest + analysis + selected categories
- **Categories:** Behavioral, Technical, Situational, Role-specific (user selects 1+)
- **Output:** 10-12 questions, each with:
  - Category, difficulty level (easy/medium/hard)
  - Question text
  - Key points (hints for answer structure)
  - Time limit in seconds (default: 120s)

#### 4.6.2 Answer Practice

**UI:** Timed answer view

- Countdown timer (optional, default 2:00 per question)
- Key points displayed as hints
- Textarea for user's answer
- Live word count
- Submit button (works with or without timer)

#### 4.6.3 Answer Evaluation

**Handler:** `EVALUATE_INTERVIEW_ANSWER`

- **Input:** Question, user's answer, category, key points, time spent
- **Output:**
  - Score (1-10 scale)
  - Strengths list (what the answer did well)
  - Improvements list (specific, actionable feedback)
  - Sample answer (model response for comparison)
  - Relevant skills referenced
- **Follow-up trigger:** If score < 5, system suggests a follow-up question

#### 4.6.4 Follow-Up Questions

**Handler:** `GENERATE_FOLLOWUP_QUESTION`

- Triggered when answer scores below threshold
- Adaptive: targets specific weak areas from the evaluation
- Max 8 follow-ups per session (prevents infinite loops)
- Same structure as original questions (scorable, timed)

#### 4.6.5 Analytics & Positioning

**Handler:** `GENERATE_POSITIONING_ADVICE`

**Analytics Dashboard:**
- Overall readiness score
- Category breakdowns (avg score per category)
- Stats: questions answered, average time per answer, follow-ups completed
- Weak areas identified (categories with avg score < 6)

**Positioning Advice:**
- Available after 5+ answered questions
- AI generates interview strategy (300-500 words)
- Focuses on weak areas + role context
- Actionable tips for improving identified gaps

#### Session Persistence

- Full session stored in `interviewSession_${jobId}`
- Includes: questions[], analytics{}, positioning advice, timestamps
- Synced to Supabase if signed in

---

### 4.7 Job Saving & Application Tracking

**Location:** Home tab, "Save Job" and "Mark as Applied" buttons
**Files:** `content.js` (UI + storage logic)

#### Save Job

- Stores job metadata: title, company, location, salary, URL, match score, analysis snapshot, JD digest
- Max 100 saved jobs (LRU eviction)
- Card view in Saved Jobs tab with score badge and action buttons
- "Prep" button launches Interview Prep for saved job
- "View Analysis" restores cached analysis
- Delete button removes from saved list

#### Mark as Applied

- URL-deduped application tracking
- Max 500 tracked applications
- Prevents duplicate "Applied" entries for same URL
- Used for personal tracking (no external sync)

---

### 4.8 Profile Management

**Location:** Profile tab (opens full-page profile.html)
**Files:** `profile.html`, `profile.js`

#### Resume Upload

- Drag-and-drop zone for PDF or DOCX files
- **PDF parsing:** pdf.js (WASM-based, runs in extension context)
- **DOCX parsing:** mammoth.js (pure JS)
- Extracted text sent to AI for structured parsing via `PARSE_RESUME` handler
- Parsed data populates profile form fields automatically

#### Profile Fields

| Section | Fields |
|---|---|
| Contact | Full name, email, phone, location |
| Links | LinkedIn URL, portfolio website |
| Summary | Professional summary textarea |
| Skills | Comma-separated or dynamic tags |
| Experience | Company, title, start/end dates, description/bullets (multiple entries) |
| Education | Degree, school, graduation year (multiple entries) |
| Certifications | Name, issuer (list) |
| Projects | Name, description, technologies (list) |

#### Multi-Slot Resume System

- 3 independent resume profiles (Resume 1, Resume 2, Resume 3)
- Each slot stores a complete profile independently
- Rename slots for clarity (e.g., "PM Resume", "Engineering Resume")
- Quick-switch from Home tab header
- Active slot indicator in panel

#### Q&A List (Legacy)

- Pre-filled common application questions and answers
- Searchable by category
- Used by deterministic matcher and autofill AI context
- Being migrated to `applicantContext` structure

---

### 4.9 Settings & Configuration

**Location:** Settings tab (opens full-page profile.html#settings)
**Files:** `profile.html`, `profile.js`, `aiService.js`

#### AI Provider Configuration

- **Provider dropdown:** Anthropic, OpenAI, Google Gemini, Groq, Together AI, OpenRouter, Mistral, DeepSeek, Cohere, Cerebras
- **Model selector:** Dynamically populated per provider
- **API key input:** With placeholder hint per provider
- **Temperature slider:** 0.0 to 1.0
- **Backend toggle:** "Use Supabase Edge Functions" (default: on if signed in)

#### Token Budget Sliders

| Operation | Default Budget | Range |
|---|---|---|
| Resume generation | 8,192 | 1,024 - 16,384 |
| Job analysis | 4,096 | 1,024 - 8,192 |
| Cover letter | 2,048 | 512 - 4,096 |
| Chat | 1,024 | 256 - 4,096 |
| Interview prep | 4,096 | 1,024 - 8,192 |

#### 9 Editable System Prompts

| # | Prompt | Purpose |
|---|---|---|
| 1 | Resume Generation | ATS-optimized format, 90+ score target |
| 2 | Cover Letter | 4-paragraph structure, professional tone |
| 3 | Job Analysis | JSON output format, scoring criteria |
| 4 | AutoFill | Deterministic selection, no invention |
| 5 | Resume Parsing | Structured JSON extraction from text |
| 6 | JD Digest | Structured extraction of job metadata |
| 7 | Chat Persona | Career advisor, concise, specific |
| 8 | Backend AI Persona | Edge Function system prompt |
| 9 | Interview Prep | Senior coach, STAR method, honest scoring |

Each prompt has: label, description, editable textarea, "Reset to default" button.

#### Data Consent

- Opt-in checkbox for JD intelligence and candidate activity sharing
- Controls Phase 6 data collection behavior

---

### 4.10 JD Digest Pipeline

**Files:** `background.js` (DIGEST_JD handler), `aiService.js` (prompt builder)

#### Description

The foundational data pipeline that converts raw job descriptions (~2,500 tokens) into structured digests (~500 tokens) for reuse across all AI operations.

#### Process

1. Raw JD text extracted from page DOM
2. Single AI call with JD digest system prompt
3. Returns structured JSON:

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

#### Caching Strategy

- **Server-side:** `jd_cache` table, keyed by SHA-256(jd_text), 7-day TTL
- **Client-side:** Stored with saved jobs as `jdDigest` field for offline access
- **Reuse:** All downstream operations (analysis, cover letter, resume, interview prep, chat) consume the digest instead of raw JD

#### Token Savings

~80% reduction in JD tokens across all operations (500 vs. 2,500 per call).

---

### 4.11 Deterministic Field Matcher

**File:** `deterministicMatcher.js`

#### Description

A zero-AI-cost matching system that handles 30+ common application field types using regex pattern matching against the user's profile data.

#### Field Types Handled

**Personal Information:**
- First name, last name, full name
- Email address, phone number
- LinkedIn URL, GitHub URL, portfolio website
- Location / city / state

**Compliance & EEO:**
- Gender, gender identity
- Sexual orientation
- Race / ethnicity
- Hispanic / Latino identification
- Veteran status
- Disability status
- Pronouns

**Work Preferences:**
- US work authorization
- Visa sponsorship requirement
- Start date / availability
- Notice period
- Employment type preference
- Desired salary / hourly rate
- Work arrangement (remote/hybrid/onsite)
- Relocation willingness
- Travel willingness
- Background check consent
- Drug test consent
- Driver's license
- Security clearance

**Education:**
- Highest education level
- Certifications / licenses

#### Matching Strategy

1. Question text matched against regex patterns (e.g., `\bgender.?identity\b`)
2. If profile/Q&A has a stored answer -> use it directly
3. If no stored answer -> select safe default (e.g., "Prefer not to say" for demographics)
4. Sensitive fields (demographics, legal status) never fabricated

---

### 4.12 Diagnostic System

**Location:** Settings, "Test Connection" button
**Files:** `background.js` (TEST_CONNECTION handler)

#### Description

A 4-layer health check that validates the full AI pipeline end-to-end.

#### Layers

| Layer | Checks | Pass Criteria |
|---|---|---|
| Settings | Provider + API key present | Both non-empty |
| Auth | Supabase session valid | JWT valid and not expired |
| Edge Function | Can call generate-answer endpoint | 200 response with answer |
| Local AI | Can call chosen provider API | Successful minimal completion |

#### Output

Returns structured status with per-layer results plus a debug log array for troubleshooting.

---

### 4.13 Data Collection & Analytics (Phase 6)

**Files:** `background.js` (sync functions), Supabase migration `20260401200000`

#### Description

Opt-in data collection system that aggregates anonymized job market intelligence and candidate activity metrics. Designed to power a future recruiter-facing analytics product.

#### JD Intelligence Collection

When user analyzes a job (with consent enabled):
- Captures: role_title, company, seniority, tech_stack[], key_requirements[], industry, location
- One row per unique JD analyzed
- Powers market insights: trending roles, hot skills, hiring patterns

#### Candidate Activity Tracking

Aggregated per-user metrics (upserted on each action):

| Metric | Incremented On |
|---|---|
| `jobs_analyzed` | Job analysis |
| `jobs_saved` | Save job |
| `jobs_applied` | Mark as applied |
| `avg_match_score` | Running average of analysis scores |
| `cover_letters_generated` | Cover letter generation |
| `resumes_generated` | Resume generation |
| `prep_sessions` | Interview prep session start |
| `prep_total_time_sec` | Cumulative interview prep time |
| `prep_avg_score` | Running average of interview scores |
| `chat_messages_sent` | Chat message sent |

#### Seriousness Score

- Derived metric computed from activity velocity and consistency
- Weighted by recency and breadth of engagement
- Updated on each analysis action
- Intended for recruiter-side filtering of serious candidates

#### Consent Model

- Explicit opt-in checkbox on Settings tab
- `data_consent` boolean on `profiles` table
- No data collected without consent
- User's own data visible only to them (RLS)
- Service role can read all data for admin/analytics

---

## 5. Platform Support

### Job Description Extraction

| Platform | Priority | Detection Method | JD Expansion |
|---|---|---|---|
| LinkedIn | P0 | URL regex + DOM selectors | "Show more" auto-click |
| Workday | P0 | URL regex (myworkdayjobs.com) + selectors | "Show more" auto-click |
| Greenhouse | P1 | URL regex + `[data-section="job-details"]` | N/A |
| Lever | P1 | URL regex + `.posting-*` selectors | N/A |
| Indeed | P2 | URL regex + `#jobDescriptionText` | "Show more" auto-click |
| Glassdoor | P2 | URL regex + `[data-test="descriptionSection"]` | N/A |
| Generic ATS | Fallback | Text-density extraction (largest contiguous text block) | N/A |

### JD Expansion

For platforms that truncate job descriptions, the content script:
1. Detects platform-specific "Show more" / expand buttons
2. Programmatically clicks to reveal full JD text
3. Polls up to 3 seconds for new content to load
4. Extracts expanded text for analysis

### Metadata Extraction

- **Job title:** H1 tags, `og:title` meta, platform-specific selectors
- **Company:** `og:company` meta, DOM patterns
- **Location:** Regex patterns + geolocation hints
- **Salary:** Regex for common formats (e.g., "$X-$Y per year")

---

## 6. AI Provider Architecture

### Two-Layer Strategy

**Layer 1: Backend (Supabase Edge Functions)**
- Available to signed-in users
- No API key required (uses free-tier models)
- Server-side caching (7-day TTL)
- Provider chain: Gemini Flash (primary) -> Groq Llama 3.3 70B (fallback)
- Retry: 2 retries on 429 (rate limit) before falling to next provider

**Layer 2: Local (User's API Key)**
- Always available if API key configured
- Direct calls from extension to provider APIs
- No server-side caching
- Retry: Exponential backoff (1s -> 2s)

### Supported Local Providers

| Provider | Models | Free Tier |
|---|---|---|
| Google Gemini | 2.5 Flash/Pro, 2.0 Flash/Lite | Yes (500K req/month) |
| Groq | Llama 3.3 70B | Yes (6K req/day) |
| Anthropic | Claude Sonnet 4, Haiku 4.5, Opus 4 | No |
| OpenAI | GPT-4.1, GPT-4.1 Mini, GPT-4o, o4/o3 | No |
| Together AI | Various open models | Limited |
| OpenRouter | Multi-model router | Varies |
| Mistral | Mistral models | Limited |
| DeepSeek | DeepSeek models | Limited |
| Cohere | Command models | Limited |
| Cerebras | Fast inference models | Limited |

### Token Optimization

| Technique | Savings | Applied To |
|---|---|---|
| JD Digest | ~80% token reduction | All JD-consuming operations |
| Profile Slicing | 30-50% reduction | Per-operation (only relevant fields) |
| Deterministic Matching | 100% (zero AI) | 30+ common field types |
| Server-side Cache | ~70% cache hit rate | Repeat analyses on same JD |
| Client-side Cache | Avoids redundant calls | 24h TTL for analysis results |

---

## 7. Data Model

### Chrome Local Storage

| Key | Type | Scope | Size Estimate |
|---|---|---|---|
| `profile` | Object | Active resume slot | ~5KB |
| `slotData_0/1/2` | Object | Per resume slot | ~5KB each |
| `slotNames` | Array | Global | <1KB |
| `aiSettings` | Object | Global | <1KB |
| `customPrompts` | Object | Global | ~3KB |
| `qaList` | Array | Global | ~2KB |
| `applicantContext` | Object | Global | ~5KB |
| `savedJobs` | Array | Max 100 | ~500KB |
| `appliedJobs` | Array | Max 500 | ~50KB |
| `ac_analysisCache` | Object | Max 50, 24h TTL | ~150KB |
| `chatHistory_${urlHash}` | Object | Max 20 conversations | ~400KB |
| `interviewSession_${jobId}` | Object | Per saved job | ~10KB each |
| `ac_theme` | String | Global | <1KB |

**Total estimated usage:** 2-3MB of ~10MB Chrome local storage limit.

### Supabase Database (8 Tables)

| Table | Purpose | RLS Policy |
|---|---|---|
| `profiles` | User identity + settings + consent | Users own their row |
| `experiences` | Work history entries | Users own via profile_id |
| `applications` | Tracked job applications | Users own via profile_id |
| `generated_answers` | Per-application AI answers | Users own via application chain |
| `usage_logs` | Immutable token audit trail | Users read own |
| `jd_cache` | Server-side AI response cache | Users own cache rows |
| `jd_intelligence` | Market data from analyzed JDs | Users insert/read own; service reads all |
| `candidate_activity` | Aggregated user engagement metrics | Users upsert/read own; service reads all |

---

## 8. Authentication & Security

### Google OAuth Flow

1. User clicks "Sign In with Google" in Settings
2. Extension generates OAuth URL via Supabase Auth
3. Browser tab opens -> Google consent screen -> callback
4. JWT + refresh token stored in `chrome.storage.local`
5. JWT auto-refreshed when expiring within 120 seconds

### Backend Security

- Edge Function deployed with `--no-verify-jwt` (required for Chrome extension CORS compatibility)
- JWT validated via `supabase.auth.getUser()` on each Edge Function call
- Row Level Security (RLS) on all tables — users can only access their own data
- Service role key used only server-side for admin analytics queries

### Client-Side Security

- API keys stored in Chrome local storage (encrypted by Chrome)
- No API keys transmitted to Supabase backend
- Shadow DOM isolates extension UI from page scripts
- Content Security Policy allows `wasm-unsafe-eval` (for pdf.js only)

---

## 9. Performance & Caching Strategy

### Caching Layers

| Layer | Scope | TTL | Max Size | Key |
|---|---|---|---|---|
| Analysis Cache | Client | 24 hours | 50 entries | URL |
| JD Cache | Server | 7 days | Unlimited | SHA-256(jd_text) + user + operation |
| Chat History | Client | No TTL | 20 conversations | URL hash |
| Interview Sessions | Client | No TTL | Per saved job | Job ID |
| Saved Jobs | Client | No TTL | 100 jobs | URL (deduped) |

### UI Performance

- **Lazy initialization:** Content script panel not created until first user interaction
- **Shadow DOM:** Prevents style leaks in both directions
- **Debounced repositioning:** ResizeObserver + scroll listeners throttled
- **No build step:** Vanilla JS, zero compile-time overhead

### Edge Function Performance

- Cold start: ~2-3 seconds (Deno runtime)
- Warm response: <500ms (cache hit) or 2-5 seconds (LLM call)
- Gemini Flash: Fastest inference (~1-2s for typical call)
- Groq: Sub-second inference (hardware-accelerated)

---

## 10. Privacy & Compliance

### Data Handling Principles

| Principle | Implementation |
|---|---|
| Local-first | All core features work without any server communication |
| Explicit consent | Data collection requires opt-in checkbox |
| Minimal collection | Only structured digests synced, never raw resumes |
| User ownership | RLS ensures users can only see their own data |
| No tracking | No analytics, telemetry, or phone-home to third parties |
| No background transmission | No data sent without explicit user action |

### Data Residency

- **Client-side:** User's local machine (Chrome storage)
- **Server-side:** Supabase project (region-specific)
- **AI providers:** Processed in-transit only (no storage by providers on free tier)

### Sensitive Field Handling

- EEO/demographic fields default to "Prefer not to say"
- Legal status fields (work auth, visa) never fabricated
- No salary data transmitted to backend
- Resume text never stored server-side (only structured digests)

---

## 11. Phase History

| Phase | Date | Key Deliverables |
|---|---|---|
| Phase 1 | 2026-03 | Core extension scaffold, JD extraction, basic analysis, profile management |
| Phase 2 | 2026-03 | Cover letter generation, autofill MVP, deterministic matcher |
| Phase 3 | 2026-03 | ATS resume builder, multi-slot resumes, bullet rewriting |
| Phase 4 | 2026-03 | Ask AI chat, ATS resume redesign, token optimization, 9 configurable prompts |
| Phase 4.5 | 2026-03 | Conversational intake flow, applicant context wiring |
| Phase 5a | 2026-04-01 | Edge Function connectivity fix, diagnostic system, interview prep MVP |
| Phase 5b | 2026-04-01 | Interview prep fixes (timed practice, scoring, follow-ups, analytics, positioning), JD expansion, digest-only storage |
| Phase 6 | 2026-04-01 | Data collection layer (jd_intelligence, candidate_activity), seriousness scoring, consent model |

### Planned (Not Yet Built)

- WXT migration (TypeScript + React build system)
- Server-side prompt management
- Billing and usage limits
- Workday platform-specific autofill handlers
- Cross-device sync
- Recruiter-facing analytics dashboard

---

*End of Functional Specification Document*
