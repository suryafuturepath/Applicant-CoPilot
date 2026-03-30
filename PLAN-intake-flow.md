# Implementation Plan: Conversational Intake Flow

**Overall Progress:** 100%
**Estimated phases:** 4
**Approach:** Vertical slice — conversational engine first → intake sections → text dump → context builder

## TLDR
Replace the static Q&A form (40+ predefined fields) with a guided conversational intake flow that builds a rich applicant context. The flow walks users through career goals, experiences, education, and aspirations via a chat-like interface, supports bulk text/document dumps, and produces a detailed applicant profile that powers all downstream AI features (autofill, cover letters, resume generation).

## Key Decisions

- **Keep it client-side (chrome.storage.local)**: Same as current Q&A — no new Supabase tables yet. The output `applicantContext` object replaces `qaList` in storage. Cloud sync can come later.
- **Conversational UI, not chatbot**: This is a guided flow with structured sections and progress tracking, not a free-form chat. Each section has specific questions, but the UX feels conversational (one question at a time, contextual follow-ups).
- **Text dump as a section**: Users can paste resume text, LinkedIn "About" section, cover letters, or any freeform text. This gets parsed into structured context alongside the conversational answers.
- **Backward compatible with existing consumers**: The output format will still produce a Q&A-compatible list so `aiService.js`, `deterministicMatcher.js`, and the autofill pipeline continue to work without changes in Phase 1. We refactor consumers in Phase 4.
- **Progressive disclosure**: Not all sections are mandatory. Core sections (career goals, experience highlights, basics) first, optional sections (demographics, preferences) later.
- **Keep existing Q&A data**: Migration path — existing Q&A answers get imported into the new context format.

## Phase 1: Conversational Engine + UI Shell
**Goal:** The Q&A tab is replaced with a conversational intake UI. Users can start the flow and answer questions one at a time. Answers persist to chrome.storage.local.

**Files touched:**
- `extension/profile.html` — Replace Q&A tab markup with intake flow container
- `extension/profile.js` — New intake flow engine (replaces Q&A rendering logic)
- `extension/profile.css` (extracted or inline) — Conversational UI styles

### Steps
- [ ] Step 1.1: Define the intake flow data model in `profile.js`
  - [ ] `applicantContext` object structure: `{ sections: [...], completedAt, version }`
  - [ ] Each section: `{ id, title, description, questions: [...], status: 'not_started' | 'in_progress' | 'complete' }`
  - [ ] Each question: `{ id, text, type: 'text' | 'textarea' | 'select' | 'multi-select', answer, followUp?, required }`
- [ ] Step 1.2: Define the intake sections and questions
  - [ ] **Section 1 — Career Goals** (required): "What kind of roles are you targeting?", "What's your ideal next role?", "What industries interest you?", "Where are you in your job search?" (just started / actively applying / selective)
  - [ ] **Section 2 — Professional Summary** (required): "Give me a 2-3 sentence elevator pitch", "What are your top 3-5 skills?", "How many years of professional experience do you have?"
  - [ ] **Section 3 — Experience Highlights** (required): "Tell me about your most recent role — what did you do, what was the impact?", "What's your proudest professional achievement?", "What technical tools/frameworks do you use daily?"
  - [ ] **Section 4 — Education** (required): "What's your highest level of education?", "What did you study?", "Any relevant certifications?"
  - [ ] **Section 5 — Work Preferences** (optional): Salary expectations, location preferences, remote/hybrid/onsite, work authorization, sponsorship needs, availability/notice period
  - [ ] **Section 6 — Personal Details** (optional): First name, last name, phone, address, LinkedIn URL, portfolio/website, gender, veteran status, disability status, race/ethnicity
  - [ ] **Section 7 — Text Dump** (optional): Free-form paste area (covered in Phase 3)
- [ ] Step 1.3: Build the conversational UI in `profile.html`
  - [ ] Replace Q&A tab content with: section sidebar (progress tracker) + main conversation area
  - [ ] Section sidebar: list of sections with status indicators (not started / in progress / complete)
  - [ ] Main area: current question displayed as a "prompt", answer input below, "Next" / "Skip" / "Back" buttons
  - [ ] Progress bar at the top showing overall completion
- [ ] Step 1.4: Build the flow engine in `profile.js`
  - [ ] `startIntakeFlow()` — initializes or resumes from saved state
  - [ ] `renderCurrentQuestion()` — shows the current question with appropriate input type
  - [ ] `saveAnswer(sectionId, questionId, answer)` — saves to in-memory state
  - [ ] `nextQuestion()` / `prevQuestion()` / `skipQuestion()` — navigation
  - [ ] `completeSection(sectionId)` — marks section done, moves to next
  - [ ] Auto-save on every answer (debounced, like current Q&A live-sync)
- [ ] Step 1.5: Wire up storage persistence
  - [ ] New message type: `SAVE_APPLICANT_CONTEXT` in `background.js`
  - [ ] New message type: `GET_APPLICANT_CONTEXT` in `background.js`
  - [ ] Storage key: `applicantContext` in chrome.storage.local
  - [ ] Resume from saved state on page load

**Verify:** Open profile page → Q&A tab shows the new conversational flow → can walk through Section 1 (Career Goals) → answers persist after closing and reopening the page.

## Phase 2: All Sections + Section Navigation
**Goal:** All 6 intake sections are fully functional. Users can navigate between sections freely, see progress, and complete the full flow.

**Files touched:**
- `extension/profile.js` — Complete all section question sets, section navigation
- `extension/profile.html` — Polish section sidebar, completion states

### Steps
- [ ] Step 2.1: Implement all 6 question sections with full question sets
  - [ ] Career Goals (4-5 questions)
  - [ ] Professional Summary (3-4 questions)
  - [ ] Experience Highlights (3-4 questions)
  - [ ] Education (3 questions)
  - [ ] Work Preferences (6-8 questions — maps to current Q&A: salary, location, work auth, availability)
  - [ ] Personal Details (8-10 questions — maps to current Q&A: name, address, demographics)
- [ ] Step 2.2: Section navigation
  - [ ] Click any section in sidebar to jump to it
  - [ ] Sections can be completed in any order
  - [ ] Required sections show warning if skipped
  - [ ] "Review & Finish" screen at the end showing all answers grouped by section
- [ ] Step 2.3: Edit mode
  - [ ] After completing a section, user can click to re-enter and edit any answer
  - [ ] Clicking a specific answer in the review screen jumps to that question
- [ ] Step 2.4: Migrate existing Q&A data
  - [ ] On first load, if `qaList` exists in storage but `applicantContext` doesn't:
    - Map existing Q&A answers into the new `applicantContext` structure
    - Personal/Address → Personal Details section
    - Work Authorization → Work Preferences section
    - Salary → Work Preferences section
    - Demographics → Personal Details section
    - Custom Q&A → Preserved as-is in a "Custom" subsection
  - [ ] Show "We've imported your existing answers" toast

**Verify:** Complete all 6 sections → review screen shows all answers → close and reopen → all state preserved → existing Q&A data (if any) migrated correctly.

## Phase 3: Text Dump + Document Paste
**Goal:** Users can paste or dump text (resume, cover letter, LinkedIn About, any freeform text) and it gets incorporated into the applicant context.

**Files touched:**
- `extension/profile.js` — Text dump section logic
- `extension/profile.html` — Text dump UI (large textarea + paste zone)

### Steps
- [ ] Step 3.1: Build the Text Dump section UI
  - [ ] Large textarea with placeholder: "Paste your resume, LinkedIn About section, cover letter, or any text that describes your experience..."
  - [ ] Support for multiple dumps (user can add more text blocks with labels)
  - [ ] Each dump has: label (e.g., "Resume", "LinkedIn About", "Cover Letter", "Other"), text content, timestamp
  - [ ] Character count display
- [ ] Step 3.2: Text dump storage
  - [ ] Store as `applicantContext.textDumps: [{ label, content, createdAt }]`
  - [ ] Persist alongside the rest of applicantContext
  - [ ] Max 5 text dumps, each up to 20,000 characters
- [ ] Step 3.3: Smart context extraction (optional enhancement)
  - [ ] When user pastes text, auto-detect type (resume vs cover letter vs freeform) based on content patterns
  - [ ] Pre-fill the label based on detection
  - [ ] Highlight: "We'll use this text to give better, more personalized answers on your applications"

**Verify:** Paste resume text → saves with label → paste LinkedIn About → saves as second dump → close and reopen → both dumps preserved → text dump content is accessible in storage.

## Phase 4: Wire New Context into AI Pipeline
**Goal:** The new `applicantContext` (conversational answers + text dumps) replaces the old `qaList` in all AI prompts and form-filling logic.

**Files touched:**
- `extension/background.js` — Replace `getQAList()` calls with `getApplicantContext()`
- `extension/aiService.js` — Update prompt builders to use new context format
- `extension/deterministicMatcher.js` — Update to read from new context
- `extension/profile.js` — Remove old Q&A rendering code (dead code cleanup)

### Steps
- [ ] Step 4.1: Create `buildContextForPrompt(applicantContext)` helper
  - [ ] Converts the structured applicantContext into a rich text block for AI prompts
  - [ ] Includes: career goals, experience highlights, skills, education, preferences
  - [ ] Includes: relevant excerpts from text dumps
  - [ ] Output format replaces the current `qaText` variable in prompt builders
- [ ] Step 4.2: Update `getQAList()` to return backward-compatible format
  - [ ] `getApplicantContext()` returns the full new object
  - [ ] `getQAListCompat()` converts applicantContext back to `[{ question, answer, category, type }]` format for `deterministicMatcher.js`
  - [ ] This ensures deterministic matching (gender, work auth, etc.) still works
- [ ] Step 4.3: Update autofill prompt builder in `aiService.js`
  - [ ] Replace `qaText` construction with richer context from `buildContextForPrompt()`
  - [ ] Include text dump excerpts in the prompt (truncated to fit token limits)
- [ ] Step 4.4: Update `handleGenerateAutofill` in `background.js`
  - [ ] Use `getApplicantContext()` instead of `getQAList()`
  - [ ] Pass the richer context to the edge function
- [ ] Step 4.5: Clean up old Q&A code
  - [ ] Remove `DEFAULT_QA_QUESTIONS` array
  - [ ] Remove old `renderQA()` function
  - [ ] Remove `migrateQAList()` (replaced by the Phase 2 migration)
  - [ ] Keep `qaList` storage read for migration path only

**Verify:** Complete intake flow → navigate to a job application → click autofill → AI uses the new rich context (check prompt in console/network tab) → deterministic matching still works for dropdowns (gender, work auth, etc.) → cover letter generation uses new context.

## Risks & Watchouts
- **Q&A backward compat**: The deterministic matcher relies on exact Q&A format (`{ question, answer }`). The compat layer in Phase 4 must preserve this exactly, or dropdown matching breaks.
- **Storage size**: Text dumps (up to 5 x 20KB = 100KB) plus context could approach chrome.storage.local limits (5MB per extension). Should be fine but worth monitoring.
- **Prompt length**: Richer context means longer prompts. Need to be mindful of token limits in the edge function (currently using Gemini Flash with 1M context — not a concern, but cost increases with token count).
- **Migration edge cases**: Users who have partially filled Q&A, users with custom Q&A entries, users with empty Q&A — all need clean migration paths.
- **No backend sync yet**: This phase keeps everything client-side. Users who switch browsers lose their intake data. Cloud sync is a future enhancement.

## Out of Scope
- **AI-powered conversational follow-ups**: "Tell me more about X" type follow-up questions generated by AI. Future enhancement — would require edge function calls during intake.
- **Voice input**: Mentioned in PROJECT-CONTEXT.md as a future feature. Not part of this plan.
- **Supabase sync for intake data**: No new backend tables. The existing profile sync (`profiles` + `experiences` tables) continues to work separately.
- **Resume file upload in intake flow**: Resume upload already exists in the Profile tab. Text dump covers pasting resume text.
- **WXT/TypeScript migration**: This is built in the current vanilla JS stack. Migration happens separately.
