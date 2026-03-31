# Implementation Plan: Applicant Copilot MVP (Week 1)

**Overall Progress:** 0%
**Estimated phases:** 5
**Approach:** Vertical slice — fork working extension → add backend → build copilot UX → connect LinkedIn + Workday

## TLDR
Fork JobMatchAI (MIT, vanilla JS Chrome extension with multi-platform support) into our project root. Wire it to a Supabase backend for auth, user profiles, and LLM proxy. Replace the "analyze & autofill" UX with a copilot UX where the user works WITH the AI on each answer. Ship a working extension that handles LinkedIn Easy Apply and Workday basic forms in 1 week.

## Key Decisions
- **Fork vanilla JS, don't migrate yet**: JobMatchAI works today — shipping > perfection. TypeScript + WXT migration is Week 2-3.
- **Supabase backend from Day 1**: Even though JobMatchAI is client-side only, we need server-side LLM calls for billing + API key protection. This is non-negotiable.
- **Copilot UX is our differentiator**: Every competitor does "auto-fill and pray." We let the user see, edit, and refine each answer before inserting. This is the product bet.
- **LinkedIn + Workday P0**: These two cover ~70% of tech/consulting/PM applications. Everything else is P1+.
- **LLM calls through Edge Functions**: Extension calls Supabase → Edge Function calls Claude → response back. API keys never touch the browser.

---

## Phase 1: Fork & Project Setup
**Goal:** JobMatchAI code lives in our project root as a working Chrome extension we can load in Chrome.

- [ ] Step 1.1: Copy JobMatchAI source into project root
  - [ ] Copy all source files (`.js`, `.html`, `.css`, `manifest.json`, `icons/`, `libs/`) from `research/repos/JobMatchAI/` into project root
  - [ ] Remove `jobmatchai-1.0.3.zip`, `screenshots/`, `docs/`, `.git/` (not needed)
  - [ ] Update `manifest.json`: rename to "Applicant Copilot", update description, version to "0.1.0"
- [ ] Step 1.2: Initialize git repo
  - [ ] `git init` in project root
  - [ ] Create `.gitignore` (node_modules, .env, *.zip, research/)
  - [ ] Initial commit with forked codebase + PROJECT-CONTEXT.md + CLAUDE.md
- [ ] Step 1.3: Verify extension loads in Chrome
  - [ ] Load unpacked extension from project root in `chrome://extensions`
  - [ ] Navigate to a LinkedIn job posting — side panel should open and extract JD
  - [ ] Navigate to a Workday job posting — verify JD extraction works

**Verify:** Extension loads without errors in Chrome. Side panel opens. JD extraction works on LinkedIn and Workday job postings.

---

## Phase 2: Supabase Backend Setup
**Goal:** Supabase project running with auth, database schema, storage bucket, and one Edge Function (LLM proxy).

- [ ] Step 2.1: Create Supabase project
  - [ ] Install Supabase CLI (`brew install supabase/tap/supabase`)
  - [ ] `supabase init` in `supabase/` directory
  - [ ] Create new Supabase project (via dashboard or CLI)
  - [ ] Save project URL and anon key in `.env` (gitignored)
- [ ] Step 2.2: Database migration — create tables
  - [ ] Create migration file `supabase/migrations/001_initial_schema.sql`
  - [ ] Tables: `profiles`, `experiences`, `applications`, `generated_answers`, `usage_logs` (per PROJECT-CONTEXT.md schema)
  - [ ] Enable RLS policies: users can only read/write their own data
  - [ ] Run migration: `supabase db push`
- [ ] Step 2.3: Auth setup
  - [ ] Enable Google OAuth provider in Supabase dashboard
  - [ ] Enable email/password auth as fallback
  - [ ] Create `profiles` trigger: on auth.users insert → create matching profiles row
- [ ] Step 2.4: Storage setup
  - [ ] Create `resumes` bucket in Supabase Storage
  - [ ] Set policy: authenticated users can upload to their own path (`{user_id}/*`)
  - [ ] Set max file size: 10MB
- [ ] Step 2.5: LLM proxy Edge Function
  - [ ] Create `supabase/functions/generate-answer/index.ts`
  - [ ] Accepts: `{ question, jd_text, user_profile, model? }`
  - [ ] Calls Claude Sonnet API with system prompt + user context + JD + question
  - [ ] Returns: `{ answer, tokens_used, cost }`
  - [ ] Logs usage to `usage_logs` table
  - [ ] Store `ANTHROPIC_API_KEY` as Supabase secret
  - [ ] Deploy: `supabase functions deploy generate-answer`
- [ ] Step 2.6: Test backend end-to-end
  - [ ] Test auth flow (sign up, sign in, get session)
  - [ ] Test Edge Function via curl with a sample question + JD
  - [ ] Verify usage_logs row created

**Verify:** Can sign up via Google OAuth, call Edge Function with a test question, get a generated answer back, see usage logged in database.

---

## Phase 3: Connect Extension to Backend
**Goal:** Extension authenticates with Supabase, loads user profile, and routes LLM calls through Edge Functions instead of direct API calls.

- [ ] Step 3.1: Add Supabase client to extension
  - [ ] Download `supabase-js` UMD bundle (no build step, vanilla JS)
  - [ ] Add to `libs/` directory
  - [ ] Add to `manifest.json` web_accessible_resources
  - [ ] Create `supabaseClient.js` — initialize client with project URL + anon key
- [ ] Step 3.2: Auth flow in extension
  - [ ] Add login/signup UI to side panel (below the existing panel header)
  - [ ] Google OAuth flow: `supabase.auth.signInWithOAuth({ provider: 'google' })` — opens tab
  - [ ] Listen for auth state changes, store session in `chrome.storage.local`
  - [ ] Show logged-in state in panel (user name, avatar)
  - [ ] Gate all copilot features behind auth
- [ ] Step 3.3: Profile sync
  - [ ] On login, fetch profile from Supabase (`profiles` + `experiences` tables)
  - [ ] Cache profile in `chrome.storage.local` for offline/fast access
  - [ ] Merge with existing JobMatchAI local profile data (resume, Q&A)
- [ ] Step 3.4: Route LLM calls through Edge Function
  - [ ] Modify `background.js` → `handleGenerateAutofill()`: instead of calling AI providers directly, call Supabase Edge Function `generate-answer`
  - [ ] Pass auth token in request headers
  - [ ] Keep existing direct-AI-call as fallback (user can choose "use own API key" in settings)
  - [ ] Remove host_permissions for AI providers from manifest (optional, can keep for fallback)
- [ ] Step 3.5: Test connected flow
  - [ ] Load extension → sign in → verify profile loaded
  - [ ] Navigate to job posting → extract JD → generate an answer via Edge Function
  - [ ] Verify answer appears in side panel
  - [ ] Verify usage_logs row in Supabase

**Verify:** Full flow works: sign in → extract JD → ask question → get AI answer via backend → see answer in panel.

---

## Phase 4: Copilot UX Layer
**Goal:** Replace JobMatchAI's "auto-analyze and batch-fill" UX with an interactive copilot that works one question at a time, letting the user refine before inserting.

- [ ] Step 4.1: Redesign side panel layout (in `content.js` Shadow DOM)
  - [ ] **Header**: App name + user avatar + settings gear
  - [ ] **JD Context Bar**: Shows extracted company + role + "Change JD" button (compact, collapsible)
  - [ ] **Copilot Chat Area**: Scrollable area showing question-answer pairs
  - [ ] **Input Area**: Text input + "Ask" button + "Scan Page" button
- [ ] Step 4.2: "Read JD" flow enhancement
  - [ ] Keep existing JD extraction logic (multi-platform selectors)
  - [ ] After extraction, show JD summary in context bar (company, role, 3 key requirements)
  - [ ] Add "Approve & Start" button — saves application to `applications` table
  - [ ] Show extracted JD text in expandable panel for user review
- [ ] Step 4.3: Question → Answer copilot interaction
  - [ ] User types/pastes a question in input area
  - [ ] Show loading state while Edge Function generates answer
  - [ ] Display answer in a card with:
    - [ ] Editable text area (user can refine)
    - [ ] "Copy" button (copies to clipboard)
    - [ ] "Insert" button (inserts into focused form field on page)
    - [ ] "Regenerate" button (calls Edge Function again)
    - [ ] "Refine" mini-input (user types "make it shorter" → sends refinement request)
  - [ ] Save question + final answer to `generated_answers` table
- [ ] Step 4.4: "Scan Page" for form fields
  - [ ] Reuse JobMatchAI's `detectFormFields()` function
  - [ ] When user clicks "Scan Page", detect all form fields on current page
  - [ ] Show detected fields as a list in the copilot panel: question label + current value + "Generate" button
  - [ ] User clicks "Generate" on a field → generates answer → shows in copilot with edit/insert
  - [ ] Works on LinkedIn Easy Apply and Workday pages
- [ ] Step 4.5: Basic onboarding flow (first-time user)
  - [ ] After first login, show onboarding overlay in side panel
  - [ ] Step 1: Upload resume (PDF/DOCX) — parse with existing pdf.js/mammoth.js
  - [ ] Step 2: 5 guided questions:
    1. "What are your top 5 target roles?" (multi-select/tags)
    2. "What's your most recent role and key achievement?" (text)
    3. "What technical skills are you strongest in?" (tags)
    4. "What's your years of experience?" (number)
    5. "Tell us about yourself in 2-3 sentences" (textarea)
  - [ ] Save to `profiles` + `experiences` tables
  - [ ] Show "Setup complete!" → redirect to main copilot panel

**Verify:** Full copilot interaction works: onboard → read JD → scan page → generate answer for a question → edit → insert into form field. Test on both LinkedIn Easy Apply and a Workday application page.

---

## Phase 5: Polish & Ship
**Goal:** Extension is installable, tested on real applications, and ready for beta users.

- [ ] Step 5.1: Error handling & edge cases
  - [ ] Handle: no JD found on page (show "Navigate to a job posting" message)
  - [ ] Handle: Edge Function timeout/error (show retry button, fallback message)
  - [ ] Handle: empty profile (prompt to complete onboarding)
  - [ ] Handle: page with no form fields (show "No form fields detected" message)
- [ ] Step 5.2: Prompt engineering for answer quality
  - [ ] Create system prompt template in `lib/prompts/answer-generation.js`:
    - Include user profile (name, headline, skills, experience summary)
    - Include JD context (role, company, key requirements)
    - Instructions: "Write a tailored answer that references specific experience. Professional but authentic tone. 100-200 words unless the question requires more."
  - [ ] Create prompt routing (inspired by AIHawk patterns — independently written):
    - Detect question type: behavioral, technical, motivation, logistics, EEO
    - Route to specialized prompt template per type
  - [ ] Test with 10+ real application questions from LinkedIn and Workday
- [ ] Step 5.3: Update extension metadata
  - [ ] New icons (Applicant Copilot branding)
  - [ ] Updated `manifest.json` description
  - [ ] Privacy policy page (`docs/privacy-policy.html`)
- [ ] Step 5.4: End-to-end testing
  - [ ] Test: Complete LinkedIn Easy Apply flow (read JD → scan → generate → insert → submit)
  - [ ] Test: Complete Workday application first page (read JD → scan → generate → insert)
  - [ ] Test: Onboarding flow from scratch (new user, no profile)
  - [ ] Test: Answer regeneration and refinement
  - [ ] Test: Copy to clipboard works
- [ ] Step 5.5: Package for distribution
  - [ ] Create `.zip` for Chrome Web Store upload (or manual distribution)
  - [ ] Write minimal README.md with install instructions

**Verify:** A new user can install the extension, sign up, complete onboarding, navigate to a LinkedIn job, read the JD, scan the Easy Apply form, generate tailored answers, refine them, and insert them into the form. Same flow works on a Workday application.

---

## Risks & Watchouts

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Supabase OAuth in Chrome extension** | Auth flow may have quirks with popup/redirect in extension context | Use `chrome.identity` API or tab-based OAuth flow; test early in Phase 2 |
| **JobMatchAI's 3000-line content.js** | Hard to modify safely for copilot UX | Isolate new copilot code in separate functions; minimize changes to existing detection logic |
| **LinkedIn DOM changes** | Selectors break if LinkedIn updates layout | JobMatchAI's selectors have fallback chains; monitor and patch |
| **Edge Function cold starts** | First LLM call may be slow (2-3s) | Show loading indicator; consider Supabase Pro for faster cold starts |
| **Supabase-js UMD bundle size** | May slow extension load | Lazy-load after auth needed; or use fetch-based client instead of full SDK |
| **AGPL contamination from AIHawk** | Accidentally copying code creates legal risk | Never open AIHawk files while writing code; only reference the ANALYSIS.md notes |

---

## Out of Scope (V1.1+)

- [ ] TypeScript + WXT migration (Week 2-3)
- [ ] Port job_app_filler's 12+ Workday field handlers (Week 2)
- [ ] Voice input for onboarding Q&A
- [ ] Cover letter generation + PDF download
- [ ] Resume generation with ATS keyword optimization
- [ ] Billing / Stripe integration (free during MVP)
- [ ] Greenhouse / Lever specific form support
- [ ] Application tracking dashboard
- [ ] Answer history / favorites
- [ ] Multi-model selection in UI
- [ ] Batch mode (generate all answers at once)

---

## Timeline Estimate

| Phase | Duration | Days |
|-------|----------|------|
| Phase 1: Fork & Setup | 0.5 day | Day 1 AM |
| Phase 2: Supabase Backend | 1.5 days | Day 1 PM – Day 2 |
| Phase 3: Connect Extension | 1 day | Day 3 |
| Phase 4: Copilot UX | 2 days | Day 4 – Day 5 |
| Phase 5: Polish & Ship | 1 day | Day 6 |
| **Buffer** | 1 day | Day 7 |
| **Total** | **7 days** | |
