# Implementation Plan: Token Controls in AI Settings

**Overall Progress:** 0%
**Estimated phases:** 2
**Approach:** Settings UI first → wire into all handlers

## TLDR
Add a "Token Budgets" section to the AI Settings tab where users can control max output tokens per operation. Resume generation gets NO hard limit (uses 8192 by default). Other operations get sensible defaults that users can adjust. This gives power users control over cost vs quality tradeoff.

## Key Decisions
- **Resume has no artificial cap**: Default 8192 tokens (~6 pages). User can increase further. The AI should never truncate a resume.
- **4 user-controllable operations**: Job Analysis, Cover Letter, Resume, Chat. Other operations (digest, autofill, dropdown, parse, test) have fixed internal limits that don't benefit from user control.
- **Stored in existing `aiSettings` object**: No new storage keys. Just extend the settings shape with a `tokenBudgets` field.
- **Backward compatible**: If `tokenBudgets` is missing (old installs), fall back to current defaults.

## Current Token Limits (for reference)

| Operation | Current | New Default | User Editable |
|-----------|---------|-------------|---------------|
| Resume Generation | 4096 | **8192** | Yes |
| Job Analysis | 4096 | 4096 | Yes |
| Cover Letter | 2048 | 2048 | Yes |
| Ask AI Chat | 1024 | 1024 | Yes |
| JD Digest | 1024 | 1024 | No (internal) |
| Autofill | 4096 | 4096 | No (internal) |
| Resume Parse | 4096 | 4096 | No (internal) |
| Dropdown Match | 200 | 200 | No (internal) |
| Test Connection | 100 | 100 | No (internal) |

---

## Phase 1: Settings UI
**Goal:** AI Settings tab has a "Response Length" section with sliders/inputs for 4 operations.
**Files touched:** `extension/profile.html`, `extension/profile.js`

- [ ] Step 1.1: Add "Response Length" card HTML to the settings tab in `profile.html`
  - Section heading: "Response Length" with subtitle "Control how much the AI generates per operation"
  - 4 rows, each with: operation label, description, range slider + numeric display
  - Resume: slider 2048–16384, default 8192, label "Resume Generation (recommended: max)"
  - Analysis: slider 1024–8192, default 4096, label "Job Analysis"
  - Cover Letter: slider 512–4096, default 2048, label "Cover Letter"
  - Chat: slider 256–2048, default 1024, label "Ask AI Chat"
  - Each slider shows the token count and approximate word count (~0.75 words/token)
- [ ] Step 1.2: Update `saveSettings()` in `profile.js` to include `tokenBudgets`
  - Read all 4 slider values
  - Save as `settings.tokenBudgets = { resume, analysis, coverLetter, chat }`
- [ ] Step 1.3: Update settings load to populate sliders with saved values
  - On page load, set slider values from `settings.tokenBudgets` (or defaults)

**Verify:** Open AI Settings → see Response Length section → move sliders → save → reload → values persist.

---

## Phase 2: Wire Token Budgets into Handlers
**Goal:** All 4 user-controlled operations read their token budget from settings.
**Files touched:** `extension/background.js`

- [ ] Step 2.1: Update `getSettings()` default to include `tokenBudgets`
  - Default: `{ resume: 8192, analysis: 4096, coverLetter: 2048, chat: 1024 }`
- [ ] Step 2.2: Update `handleAnalyzeJob` to use `settings.tokenBudgets.analysis`
- [ ] Step 2.3: Update `handleGenerateCoverLetter` to use `settings.tokenBudgets.coverLetter`
- [ ] Step 2.4: Update `handleGenerateResume` to use `settings.tokenBudgets.resume`
  - Also update backend path `max_tokens` to use the setting
- [ ] Step 2.5: Update `handleChat` to use `settings.tokenBudgets.chat`

**Verify:** Set resume tokens to 16384 → generate resume → get a much longer/detailed resume. Set chat to 256 → get shorter chat responses. Values respected in both backend and local paths.

---

## Out of Scope
- Per-operation temperature controls (could add later but not requested)
- Token usage display/dashboard (already logged in usage_logs, UI for it is Phase 4+)
- Cost estimation based on token budgets (depends on billing implementation)
