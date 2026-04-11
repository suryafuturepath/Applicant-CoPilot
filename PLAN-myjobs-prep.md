# Implementation Plan: My Jobs Interview Prep

**Overall Progress:** 0%
**Estimated phases:** 3
**Approach:** Data fix → UI build → Wire everything

## TLDR
The "Prep" button on My Jobs cards currently just opens the job URL in a new tab (broken — redirects to LinkedIn). We're replacing it with a full-page interview prep experience inside profile.html that reuses the existing backend handlers (question generation, scoring, follow-ups, analytics) but renders in the larger profile page layout instead of the narrow 380px panel. JD text is already being saved with jobs.

## Key Decisions
- **Reuse existing backend handlers**: All 5 message types already exist (`GENERATE_INTERVIEW_QUESTIONS`, `EVALUATE_INTERVIEW_ANSWER`, `GENERATE_FOLLOWUP_QUESTION`, `GET_INTERVIEW_SESSION`, `GENERATE_POSITIONING_ADVICE`) — no backend changes needed
- **New tab-content in profile.html**: Add a `tab-content#tab-prep` view that takes over the main content area (like the report view does), rather than navigating to a new page
- **No new files**: All UI lives in `profile.html` (styles) + `profile.js` (logic) — consistent with how the report view already works
- **JD already saved**: `save-applied.js` already saves `jdText` (capped at 5KB) and `jdDigest` on every job — no data layer changes needed

## Phase 1: Fix Prep Button + Create Prep View Shell
**Goal:** Prep button opens an in-page interview prep view instead of redirecting. View shows job header + category selection + "Generate Questions" button.
**Files touched:** `extension/profile.html`, `extension/profile.js`

- [ ] Step 1.1: Add a new `<div class="tab-content" id="tab-prep">` section in `profile.html` after `tab-applied`, containing:
  - Back button (arrow_back icon + "Back to My Jobs")
  - Job header area (title, company, match score)
  - Category checkboxes (Behavioral, Technical, Situational, Role-Specific)
  - Timer toggle checkbox
  - "Generate Questions" button
  - Placeholder containers for: question list, answer view, feedback view, analytics view
- [ ] Step 1.2: Add CSS styles for the prep view in `profile.html` `<style>` block — reuse the Organic Archive design tokens, cards, buttons. Wider layout (max-width ~800px) compared to the panel's 380px.
- [ ] Step 1.3: Replace the Prep button click handler in `profile.js` (~line 2202-2212) — instead of `window.open(url)`, call a new function `openPrepView(jobId)` that:
  - Hides `tab-applied`, shows `tab-prep`
  - Updates the sidebar nav to deselect "My Jobs" (or keep it selected but visually indicate sub-view)
  - Loads the job data from `_allJobs` array to populate the header
  - Checks for existing session via `GET_INTERVIEW_SESSION` message
  - If session exists with questions, jumps to question list view
  - If no session, shows category selection (start view)
- [ ] Step 1.4: Wire the "Back to My Jobs" button to hide `tab-prep` and show `tab-applied` again

**Verify:** Click "Prep" on any job card in My Jobs → see the prep view with job title, category checkboxes, and Generate button (no redirect). Click "Back" → return to My Jobs.

## Phase 2: Question Generation + Answer + Scoring Flow
**Goal:** Full interview practice loop works — generate questions, answer them, get AI scoring with strengths/improvements/sample answer, follow-ups for weak answers.
**Files touched:** `extension/profile.js`

- [ ] Step 2.1: Wire "Generate Questions" button to call `GENERATE_INTERVIEW_QUESTIONS` with selected categories, jobId, jobUrl. Show loading state during generation.
- [ ] Step 2.2: Render the question list view — each question as a card with category pill, difficulty badge, question text, and "Answer" button. Show progress indicator (X of Y answered).
- [ ] Step 2.3: Wire "Answer" button to show the answer view — display the question prominently, optional countdown timer (2 min default), hints toggle (key points to cover), textarea for answer, word count, "Submit Answer" button.
- [ ] Step 2.4: Wire "Submit Answer" to call `EVALUATE_INTERVIEW_ANSWER`. Show loading state. On response, render feedback view: score circle (color-coded), strengths list, improvements list, sample answer (in collapsible), time badge.
- [ ] Step 2.5: If score < 5, show "Practice Follow-Up" button. Wire it to call `GENERATE_FOLLOWUP_QUESTION`. Insert the new question after the parent in the list and navigate to it.
- [ ] Step 2.6: Wire "Next Question" and "Try Again" buttons in feedback view. "Next" goes to the next unanswered question in the list. "Try Again" clears the answer and re-shows the answer view.
- [ ] Step 2.7: Wire "Back to Questions" button in answer/feedback views to return to question list.

**Verify:** Generate questions for a saved job → see list of 10-12 questions. Click Answer → type response → Submit → see score + feedback. Low score shows follow-up button. Navigate between questions.

## Phase 3: Analytics + Positioning + Polish
**Goal:** Analytics dashboard, positioning advice, and full report link all work. UI polish for the larger viewport.
**Files touched:** `extension/profile.js`, `extension/profile.html`

- [ ] Step 3.1: Enable "View Analytics" button when ≥3 questions answered. Render analytics view: readiness circle, category score bars, stats grid (questions answered, avg time, follow-ups generated), weak areas list.
- [ ] Step 3.2: Enable "Generate Positioning Advice" button when ≥5 questions answered. Wire to `GENERATE_POSITIONING_ADVICE`. Show loading state. Render advice in a styled section below analytics.
- [ ] Step 3.3: Add "View Full Report" button that navigates to `profile.html#interview-prep-report&jobId=XXX` (reuses existing `renderInterviewPrepReport` function).
- [ ] Step 3.4: Hide the floating save bar when prep view is active (same pattern as My Jobs tab).
- [ ] Step 3.5: Handle edge case — if job has no `jdText` and no `jdDigest`, show a notice: "No job description available. Questions will be based on the job title and your profile only."
- [ ] Step 3.6: Handle session persistence — if user navigates away and comes back (clicks Prep again on same job), resume where they left off (session is already persisted by the backend handlers).

**Verify:** Answer 3+ questions → analytics button enables → see readiness score + category bars. Answer 5+ → positioning advice button works. "View Full Report" opens the existing report page. Navigating away and back preserves session.

## Risks & Watchouts
- **Message passing**: `profile.js` uses `chrome.runtime.sendMessage` (already has a `sendMessage` wrapper) — same pattern as the panel. The existing background handlers don't care where the message comes from.
- **Timer state**: The countdown timer needs to be managed within profile.js scope. If user navigates to Back while timer is running, it should be cleared.
- **Large viewport**: The prep UI in the panel is designed for 380px. The profile page gives us ~800px+ — need to use the extra space well (2-column layouts for feedback, wider cards) without looking sparse.

## Out of Scope
- Saving JD when job is saved (already works — `jdText` is saved)
- Modifying the panel's interview prep (it stays as-is)
- Modifying background.js handlers (they already support everything we need)
- New message types or storage schemas
