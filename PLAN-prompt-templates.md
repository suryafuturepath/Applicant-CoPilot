# Implementation Plan: Configurable System Prompts

**Overall Progress:** 0%
**Estimated phases:** 3
**Approach:** Data model → UI → Wire into handlers

## TLDR
Make ALL system prompts editable via the AI Settings page. Each operation shows its current prompt in a textarea — edit, save, test. Reset to defaults anytime. This lets the founder (you) iterate on prompt quality across multiple test runs. Later, an admin role will push the best-performing prompts to all extension users.

## Key Decisions
- **ALL prompts exposed**: Resume, Cover Letter, Chat, Job Analysis, Autofill, Resume Parse, JD Digest — everything. You're the founder testing this, not a random user. Hide nothing.
- **Simple textareas, not structured controls**: You're a power user who understands prompts. Dropdowns and chips add complexity without value for you right now. Structured controls can come later for end users.
- **Defaults are current hardcoded prompts**: Extracted verbatim from aiService.js and background.js into a `DEFAULT_PROMPTS` constant. If user hasn't customized, behavior is identical to today.
- **Stored in `chrome.storage.local` under `customPrompts`**: Separate from `aiSettings`. Each key is an operation name, value is the prompt string. Missing key = use default.
- **Future admin path**: Later, you create an `admin` role in Supabase. Admin can save prompts to a `system_prompts` table. Extension checks server-side prompts first → falls back to local custom → falls back to defaults. Out of scope for now.

## Operations & Their Prompts

| Operation | Key | Where Used | Editable Part |
|-----------|-----|-----------|---------------|
| Resume Generation | `resume` | aiService.js `buildResumeGeneratePrompt` + background.js Edge call | The instruction block (ATS rules, format, sections) |
| Cover Letter | `coverLetter` | aiService.js `buildCoverLetterPrompt` + background.js Edge call | Structure, tone, rules |
| Ask AI Chat | `chat` | aiService.js `buildChatPrompt` | System persona + style instructions |
| Job Analysis | `analysis` | aiService.js `buildJobAnalysisPrompt` + background.js Edge call | Analysis instructions + JSON format spec |
| Autofill | `autofill` | aiService.js `buildAutofillPrompt` | Field matching rules, demographic safety |
| Resume Parse | `resumeParse` | aiService.js `buildResumeParsePrompt` | Field extraction instructions + JSON schema |
| JD Digest | `jdDigest` | aiService.js `buildJDDigestPrompt` | Field list + JSON schema |
| Edge Function System | `edgeSystem` | Edge Function `buildSystemPrompt` | Global persona + guidelines |

---

## Phase 1: Defaults + Storage
**Goal:** All current hardcoded prompts extracted into a `DEFAULT_PROMPTS` object. Custom prompts can be saved/loaded.
**Files touched:** `extension/background.js`

- [ ] Step 1.1: Create `DEFAULT_PROMPTS` constant in background.js
  - Extract the instruction text from each prompt builder into named strings
  - 8 keys matching the table above
  - Each value is the exact text currently hardcoded in the prompt builders
- [ ] Step 1.2: Add `getCustomPrompts()` helper
  - Reads `customPrompts` from `chrome.storage.local`
  - Returns merged object: `{ ...DEFAULT_PROMPTS, ...saved }`
  - Missing keys fall back to defaults
- [ ] Step 1.3: Register `GET_CUSTOM_PROMPTS`, `SAVE_CUSTOM_PROMPTS`, `RESET_PROMPT` message handlers
  - `GET_CUSTOM_PROMPTS` → returns `{ prompts, defaults }` (both, so UI can show "modified" indicator)
  - `SAVE_CUSTOM_PROMPTS` → saves to `chrome.storage.local`
  - `RESET_PROMPT` → deletes a single key from `customPrompts` (reverts to default)

**Verify:** From console: `sendMessage({ type: 'GET_CUSTOM_PROMPTS' })` → returns all 8 prompts with defaults.

---

## Phase 2: Settings UI
**Goal:** AI Settings page has a "System Prompts" section with collapsible textareas for each operation.
**Files touched:** `extension/profile.html`, `extension/profile.js`

- [ ] Step 2.1: Add "System Prompts" card HTML to the settings tab in `profile.html`
  - Heading: "System Prompts" with subtitle "Customize how the AI behaves for each operation"
  - 8 collapsible sections, each with:
    - Operation name + short description
    - "Modified" badge (shown when prompt differs from default)
    - Textarea (monospace, ~8 rows, auto-expandable)
    - "Reset to default" link button
  - Sections collapsed by default (click to expand)
- [ ] Step 2.2: Add CSS for collapsible prompt sections
  - Collapse/expand animation
  - Modified badge styling
  - Monospace textarea
  - Reset button styling
- [ ] Step 2.3: Wire profile.js
  - On init: load prompts via `GET_CUSTOM_PROMPTS`, populate textareas
  - Show "Modified" badge when value differs from default
  - On "Save Settings": collect all textarea values, save via `SAVE_CUSTOM_PROMPTS`
  - On "Reset to default" per section: call `RESET_PROMPT`, repopulate textarea with default
- [ ] Step 2.4: Add a "Reset All Prompts" button at the bottom of the card

**Verify:** Open AI Settings → expand "Resume Generation" → see current prompt → edit it → save → reload → edit persists. Click "Reset to default" → prompt reverts. Modified badge appears/disappears correctly.

---

## Phase 3: Wire Custom Prompts into AI Handlers
**Goal:** All prompt builders use custom prompts when available, falling back to defaults.
**Files touched:** `extension/background.js`, `extension/aiService.js`

- [ ] Step 3.1: Update all prompt builders in `aiService.js` to accept an optional `customInstructions` parameter
  - `buildResumeGeneratePrompt(resumeData, jobData, jobTitle, company, customInstructions, promptOverride)`
  - `buildCoverLetterPrompt(resumeData, jobData, analysis, promptOverride)`
  - `buildChatPrompt(context, history, userMessage, promptOverride)`
  - `buildJobAnalysisPrompt(resumeData, jobData, jobTitle, company, promptOverride)`
  - `buildAutofillPrompt(resumeData, qaList, formFields, promptOverride)`
  - `buildResumeParsePrompt(rawText, promptOverride)`
  - `buildJDDigestPrompt(rawJD, jobTitle, company, promptOverride)`
  - When `promptOverride` is provided, use it as the instruction block instead of the hardcoded text
- [ ] Step 3.2: Update each handler in `background.js` to load custom prompts and pass to builders
  - At the start of each handler: `const prompts = await getCustomPrompts();`
  - Pass `prompts.resume` to `buildResumeGeneratePrompt`
  - Pass `prompts.coverLetter` to `buildCoverLetterPrompt`
  - etc.
- [ ] Step 3.3: Update Edge Function question strings in background.js
  - The backend path builds question strings inline (e.g., "Generate an ATS-optimized resume...")
  - Replace these hardcoded strings with the custom prompt value
  - Keep the dynamic parts (richContext, customInstructions from UI) appended after

**Verify:** Edit the resume prompt to say "Write in French" → generate resume → output is in French. Edit the chat persona to "You are a pirate" → chat → AI responds as a pirate. Reset to defaults → back to normal. All 8 operations work with both custom and default prompts.

---

## Risks & Watchouts
- **Broken JSON prompts**: If user edits the analysis prompt and removes "Return ONLY valid JSON", the parser breaks. Mitigation: For analysis/parse/digest, always append the JSON format requirement AFTER the custom prompt. The user can change the instructions but not remove the output format.
- **Empty prompts**: If user clears a textarea and saves, the prompt is empty. Mitigation: treat empty string as "use default" (same as missing key).
- **Storage size**: 8 prompts × ~3KB each = ~24KB. Fine for chrome.storage.local.

## Out of Scope (Future: Admin Push)
- Supabase `system_prompts` table for admin-managed prompts
- Admin role with UI to edit + push prompts to all users
- Prompt versioning / A-B testing
- Structured controls (dropdowns/chips) for non-technical end users
- Per-job prompt overrides
