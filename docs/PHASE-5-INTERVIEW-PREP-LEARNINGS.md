# Phase 5: Interview Prep + Infrastructure Learnings

**Date:** 2026-03-31
**Status:** Built and tested, reverted for re-implementation with fixes
**Author:** Surya + Claude Code session

---

## What We Built

### 1. Interview Prep Feature (MVP v2)
A complete interview preparation system inside the Saved Jobs tab.

**Architecture:**
- Entry point: "Prep" button on each saved job card in the Saved tab
- Sub-view inside the panel (not a new top-level tab — keeps nav bar at 5 tabs)
- Sessions stored in `chrome.storage.local` under `interviewPrepSessions` key
- Max 20 sessions (LRU eviction by `updatedAt`), max 20 questions per session (12 initial + 8 follow-ups)

**Features implemented:**
- **Timed practice**: Countdown timer (MM:SS) with green/yellow/red color states, auto-submit on expiry, pause/resume
- **AI-scored feedback**: 1-10 score with strengths[], improvements[], sampleAnswer for each answer
- **Adaptive follow-ups**: When score < 5, generates a targeted follow-up question (max 8 per session, 1 level deep)
- **4 question categories**: Behavioral (blue), Technical (purple), Situational (orange), Role-Specific (green)
- **In-panel analytics**: Readiness score (0-100), category breakdown bars, weak areas, stats
- **Full-page report**: Opens in profile.html via hash route `#interview-prep-report&jobId=<id>`, with Print + Copy
- **Positioning advice**: AI-generated strategic advice (STAR stories, themes, gap mitigation, questions to ask)
- **Configurable prompt**: `interviewPrep` added as 9th editable system prompt in Settings
- **Token budget slider**: `interviewPrep: 2048` (range 1024-8192) as 5th slider

**Files modified:**
| File | Changes | Lines Added |
|------|---------|-------------|
| `extension/aiService.js` | 4 prompt builders (questions, evaluation, follow-up, positioning) | ~237 |
| `extension/background.js` | 6 message handlers, session CRUD, analytics computation, prompt config | ~510 |
| `extension/content.js` | CSS (~150), HTML template, JS functions (~400), event wiring, Prep button on cards | ~895 |
| `extension/profile.js` | Full-page report renderer with hash routing | ~211 |
| `extension/profile.html` | Report container + "Use Backend AI" toggle | ~11 |
| `supabase/functions/generate-answer/index.ts` | OpenRouter provider, interview_prep action type, passthrough system prompt | ~131 |

### 2. "Mark Applied" Toggle on Saved Jobs
- Each saved job card gets a toggle button: "Mark Applied" / "Applied"
- Green badge + left border when applied
- Stored as `applied: boolean` on the saved job object
- Message handler: `TOGGLE_JOB_APPLIED`

### 3. Setup Guide (MVP v2)
- Expanded from 11 to 15 sections
- Added 8 verification tests (was 5)
- New sections: Configurable Prompts & Token Controls, Architecture Reference
- Fixed stale `.env.example` (added `GROQ_API_KEY`)

### 4. MVP v2 Zip Package
- `Applicant-Copilot-MVP-v2.zip` at project root
- Manifest version bumped to `0.2.0`
- Excludes: research/, .git/, secrets, IDE config, tests

---

## Key Technical Decisions

### Interview Prep as Saved Tab Sub-View (not a new tab)
- Adding a 6th nav button would crowd the tight 5-button bar
- Interview prep is context-sensitive to a specific saved job
- Pattern mirrors Ask AI chat: container with internal state machine (start → questions → answer → feedback → analytics)

### Timer Architecture
- `setInterval` based countdown with color transitions via CSS class toggling
- Timer state tracked in module-level variables (`_prepTimerInterval`, `_prepTimerRemaining`, `_prepTimerPaused`)
- Auto-submit on expiry calls `submitCurrentAnswer()` directly
- Time spent tracked even when timer is disabled (uses `Date.now()` delta)

### Session Data Model
```js
{
  [jobId]: {
    jobId, jobTitle, company, jobUrl, createdAt, updatedAt,
    questions: [{
      id, category, difficulty, question, keyPoints[],
      isFollowUp, parentQuestionId,
      userAnswer, timeSpentSec, timeLimitSec,
      evaluation: { score, strengths[], improvements[], sampleAnswer, relevantSkills[] },
      answeredAt
    }],
    analytics: {
      overallReadiness, categoryScores, weakAreas[], strongAreas[],
      positioningAdvice, questionsAnswered, questionsTotal,
      avgTimePerAnswer, followUpsGenerated
    }
  }
}
```

### Edge Function Passthrough for interview_prep
- The default Edge Function system prompt says "Write in first person as the applicant" and "Respond with ONLY answer text" — this conflicts with interview prep which needs JSON output from a coach persona
- Solution: For `action_type === 'interview_prep'`, use a lightweight passthrough system prompt instead of the default career-coach prompt
- The prompt builder in aiService.js contains all context and format instructions

---

## Critical Bugs Discovered & Fixed

### 1. SUPABASE_ANON_KEY Format (ROOT CAUSE of all JWT errors)
**Problem:** The extension used `sb_publishable_7y8gnIiUPWgXZWDPIaa6fA_7BuPEfzT` (new Supabase key format). The Supabase Edge Function **gateway** requires the legacy JWT-format anon key (`eyJhbG...`). The `sb_publishable_` key works for Auth API and REST API but is rejected by the Edge Function gateway with "Invalid JWT" before the request even reaches our code.

**Fix:** Replace with legacy JWT-format anon key from Supabase Dashboard → Settings → API Keys → "Legacy anon, service_role API keys" tab.

**Lesson:** Supabase recently migrated to new key formats (`sb_publishable_`, `sb_secret_`). These work for most Supabase APIs but NOT for Edge Functions. Always use the legacy JWT keys for Edge Functions until Supabase updates their gateway.

### 2. callEdgeFunction JSON Parse Before Status Check
**Problem:** `response.json()` was called BEFORE checking `response.ok`. If the Edge Function returns an HTML error page (502 from Cloudflare), `response.json()` throws `SyntaxError: Unexpected token <` — a cryptic error that masks the real issue.

**Fix:**
```js
// BEFORE (broken):
const data = await response.json();
if (!response.ok) throw new Error(data.error || ...);

// AFTER (correct):
if (!response.ok) {
  const text = await response.text();
  try { throw new Error(JSON.parse(text).error || JSON.parse(text).message || ...); }
  catch (_) { throw new Error(`Edge function error: ${response.status} — ${text.substring(0, 150)}`); }
}
return await response.json();
```

### 3. Silent Backend Fallback Masking Real Errors
**Problem:** When `callEdgeFunction` failed (JWT error, 502, etc.), handlers caught the error silently and fell through to local `callAI()`. If local was also broken (rate limited, no key), the user saw a misleading "Rate limit exceeded" from the local provider, not the real JWT error from the backend.

**Fix:** Two approaches tried:
- **Approach A (aggressive):** Propagate backend errors, block local fallback → made it worse (users got stuck)
- **Approach B (graceful):** Always fall through to local, but with proper `console.warn` logging → correct approach
- **Approach C (best):** Add `useBackend` toggle so users can explicitly choose → implemented

### 4. Edge Function System Prompt Conflict for JSON Operations
**Problem:** The Edge Function's `buildSystemPrompt()` always prepends "Write in first person as the applicant" and "Respond with ONLY answer text". For operations that need JSON output (interview_prep, JD digest), this overrides the JSON format instruction in the user prompt, causing the AI to return prose instead of JSON.

**Fix:** Add `isPassthroughAction` flag for action types that manage their own system prompt. For `interview_prep`, use a lightweight "Follow the user's instructions exactly" system prompt.

### 5. Token Expiry Not Handled in getSession()
**Problem:** `getSession()` returned the in-memory `_currentSession` without checking if the access token had expired. After 1 hour, the token expires but the service worker might still be alive with the stale token.

**Fix:** Check `_currentSession.expires_at` against current time (with 120s buffer). If expired, call `client.auth.refreshSession()` before returning.

---

## Infrastructure Changes

### OpenRouter as Primary LLM Provider
- Added as primary in Edge Function: OpenRouter → Groq → Gemini fallback chain
- Model: `google/gemini-2.0-flash-001` (paid, ~$0.00001/call)
- Headers: `HTTP-Referer: https://applicant-copilot.app`, `X-Title: Applicant Copilot`
- API key stored as Supabase secret: `OPENROUTER_API_KEY`

### Rate Limit Disabled for Testing
- `MAX_REQUESTS_PER_HOUR` bumped to 200, then commented out entirely
- TODO: Re-enable before production launch
- The old 50/hour limit was hit repeatedly during development

### Database Migration
- `20260331140000_add_interview_prep_action.sql` — adds `interview_prep` to `usage_logs` action_type CHECK constraint
- This migration was pushed to production (`supabase db push`)

### "Use Backend AI" Toggle
- `aiSettings.useBackend` boolean (default: `true`)
- When `false`, all 11 handlers skip `callEdgeFunction` and go straight to local `callAI()`
- UI: checkbox in AI Settings above provider dropdown

---

## What Needs to Happen Before Re-implementation

1. **Fix the anon key FIRST** — use legacy JWT-format key from Supabase Dashboard
2. **Test auth flow end-to-end** before building features:
   - Sign in → verify token in service worker console → call Edge Function → verify 200 response
3. **Keep the `useBackend` toggle** — it's essential for users who want to use their own keys
4. **Keep silent fallback** — never block users from local AI when backend fails
5. **Re-enable rate limiting** with a reasonable cap (200/hour for power users)
6. **Consider the DB migration** — `interview_prep` action type is already in production; don't re-run
7. **The Edge Function OpenRouter integration works** — verified via direct curl test

---

## Prompt Builders Reference

### buildInterviewQuestionsPrompt(profile, jdDigest, analysis, categories, promptOverride)
- Generates 10-12 categorized questions with keyPoints and timeLimitSec per question
- Uses JD digest for role-specific calibration, analysis for gap targeting
- Timer defaults: behavioral=120s, technical=150s, situational=120s, role-specific=90s

### buildAnswerEvaluationPrompt(profile, jdDigest, question, answer, keyPoints, timeSpent, promptOverride)
- Scores 1-10 with strengths[], improvements[], sampleAnswer, relevantSkills[]
- `shouldFollowUp: true` when score < 5
- Time factor: notes rushed answers (< 30s) and verbose answers (> 180s)

### buildFollowUpQuestionPrompt(profile, jdDigest, originalQuestion, userAnswer, evaluation, category, promptOverride)
- Generates 1 targeted follow-up in the same category
- Drills into the specific gap from evaluation.improvements

### buildPositioningAdvicePrompt(profile, jdDigest, analysis, sessionSummary, promptOverride)
- Returns structured markdown: STAR stories, themes, gap mitigation, opening/closing statements, interviewer questions, time management tips
- Requires 5+ answered questions

---

## Message Types Added

| Message | Handler |
|---------|---------|
| `GENERATE_INTERVIEW_QUESTIONS` | `handleGenerateInterviewQuestions(jobId, jobUrl, categories)` |
| `EVALUATE_INTERVIEW_ANSWER` | `handleEvaluateAnswer(jobId, questionId, question, userAnswer, category, keyPoints, timeSpentSec)` |
| `GENERATE_FOLLOWUP_QUESTION` | `handleGenerateFollowUp(jobId, parentQuestionId, question, userAnswer, evaluation, category)` |
| `GET_INTERVIEW_SESSION` | `getInterviewSession(jobId)` |
| `SAVE_INTERVIEW_SESSION` | `saveInterviewSession(session)` |
| `GENERATE_POSITIONING_ADVICE` | `handleGeneratePositioningAdvice(jobId)` |
| `TOGGLE_JOB_APPLIED` | Toggle applied status on saved job |
