# Implementation Plan: Ask AI Chat Interface

**Overall Progress:** 0%
**Estimated phases:** 4
**Approach:** Vertical slice — chat UI shell → backend handler → context wiring → polish & persistence

## TLDR
Replace the Q&A nav tab with an "Ask AI" in-panel chat interface. The chat has full context of the user's profile, JD digest, and job analysis — so users can ask anything about the job, their fit, interview prep, or company research. Messages persist per job URL. Quick-action chips guide first-time users. Accessible, keyboard-navigable, works in 350px side panel.

## Key Decisions
- **In-panel chat (not profile page)**: The Q&A tab currently redirects to profile.html. The new Ask AI tab stays in the side panel — users shouldn't leave the job page to chat.
- **Context = JD digest + profile + analysis**: All three are passed as system context. The user never has to re-explain what job they're looking at.
- **Persistent per URL**: Chat history stored in `chrome.storage.local` keyed by job URL. Switching jobs loads that job's chat. Capped at 20 most recent conversations.
- **Suggestion chips**: 4 pre-built chips shown on empty state AND after analysis completes. Reduces blank-page anxiety and teaches users what the chat can do.
- **Streaming feel**: Show a typing indicator (animated dots) while waiting for AI response. Not actual streaming — just perceived performance.
- **Same backend path**: Uses `callEdgeFunction('generate-answer', ...)` with `action_type: 'chat'` when signed in, `callAI()` when local.

## UX Flow (Rina-approved)

### State 1: No Job Analyzed
```
┌─────────────────────────────┐
│  Ask AI                     │
│                             │
│  💬 Analyze a job first     │
│  to start chatting.         │
│                             │
│  I'll have full context     │
│  of the JD and your         │
│  profile to help you.       │
│                             │
│  [Analyze Job →]            │
└─────────────────────────────┘
```

### State 2: Job Analyzed, No Messages Yet
```
┌─────────────────────────────┐
│  Ask AI  · Roku · Sr PM     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                             │
│  I know this role and       │
│  your profile. Ask me       │
│  anything.                  │
│                             │
│  ┌─────────┐ ┌───────────┐ │
│  │Am I a   │ │Interview  │ │
│  │good fit?│ │prep tips  │ │
│  └─────────┘ └───────────┘ │
│  ┌─────────┐ ┌───────────┐ │
│  │Company  │ │What to    │ │
│  │research │ │highlight? │ │
│  └─────────┘ └───────────┘ │
│                             │
│ ┌─────────────────────┐ [→] │
│ │ Ask anything...     │     │
│ └─────────────────────┘     │
└─────────────────────────────┘
```

### State 3: Active Conversation
```
┌─────────────────────────────┐
│  Ask AI  · Roku · Sr PM     │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│                             │
│  ┌─ You ──────────────────┐ │
│  │ Am I a good fit for    │ │
│  │ this role?             │ │
│  └────────────────────────┘ │
│                             │
│  ┌─ AI ──────────────────┐  │
│  │ Based on your profile  │ │
│  │ and this JD, you're a  │ │
│  │ 60% match. Your ML/AI  │ │
│  │ and content systems    │ │
│  │ experience aligns...   │ │
│  │                        │ │
│  │ [Copy]                 │ │
│  └────────────────────────┘ │
│                             │
│ ┌─────────────────────┐ [→] │
│ │ Ask anything...     │     │
│ └─────────────────────┘     │
└─────────────────────────────┘
```

---

## Phase 1: Chat UI Shell in Side Panel
**Goal:** The "Q&A" tab becomes "Ask AI" with a working chat UI — messages render, input works, but no AI calls yet.
**Files touched:** `extension/content.js`, `extension/styles.css`

- [ ] Step 1.1: Rename Q&A nav button to "Ask AI" in the panel HTML
  - Change `data-nav="qa"` to `data-nav="ask-ai"` and label to "Ask AI"
- [ ] Step 1.2: Add Ask AI tab content HTML inside `jm-body`
  - Chat container div `#jmAskAiTab` with:
    - Context badge (company + role, shows when analysis exists)
    - Messages area `#jmChatMessages` with `role="log"` and `aria-live="polite"`
    - Suggestion chips container `#jmChatChips`
    - Input row: `<textarea>` + send button with `aria-label="Send message"`
- [ ] Step 1.3: Wire nav button click to show/hide Ask AI tab
  - Same pattern as `activateSavedTab()` / `deactivateSavedTab()`
  - New functions: `activateAskAiTab()` / `deactivateAskAiTab()`
- [ ] Step 1.4: Add chat CSS styles to the panel stylesheet
  - Message bubbles (user = right-aligned blue, AI = left-aligned gray)
  - Max bubble width: 85% of container (prevents wall-to-wall text in 350px)
  - Suggestion chips: 2-column grid, 44px min touch target
  - Input area: sticky bottom, textarea auto-grows up to 3 lines
  - Typing indicator: 3 animated dots
  - Scrollable messages area with `overflow-y: auto`
- [ ] Step 1.5: Implement local message rendering functions
  - `renderMessage(role, text)` — appends a message bubble to the chat area
  - `renderTypingIndicator()` / `removeTypingIndicator()`
  - `renderSuggestionChips()` — renders 4 chips, each fires its text as a message on click
  - `scrollToBottom()` — smooth scroll to latest message
- [ ] Step 1.6: Wire input handling
  - Send on Enter (Shift+Enter for newline)
  - Send on click of send button
  - Disable send while AI is responding
  - Focus input after chip click
  - Clear input after send
- [ ] Step 1.7: Handle empty states
  - No analysis: show "Analyze a job first" with button that triggers analysis
  - Analysis done, no messages: show context badge + suggestion chips

**Verify:** Click "Ask AI" tab → see chat UI with suggestion chips. Type a message → it appears as a user bubble. No AI response yet (just the user bubble). Chips clickable. Enter key sends. Tab accessible via keyboard.

---

## Phase 2: Chat Backend Handler
**Goal:** Messages get AI responses through background.js → Edge Function (or local AI).
**Files touched:** `extension/background.js`, `extension/aiService.js`

- [ ] Step 2.1: Add `buildChatPrompt()` to `aiService.js`
  - System context: profile summary + JD digest + analysis highlights
  - Conversation history: last 10 messages as `[{role, content}]`
  - User's latest message
  - Instructions: "You are a career advisor with full context of this applicant and this job. Be specific, reference the JD and profile. Be concise (under 200 words unless asked for more)."
- [ ] Step 2.2: Add `handleChat()` to `background.js`
  - Accepts: `{ message, history, jobUrl }`
  - Loads profile (sliced for 'chat' — name, summary, skills, top 2 experiences)
  - Loads cached JD digest for the URL (if available)
  - Loads current analysis result (if available)
  - Builds system context from all three
  - Backend path: `callEdgeFunction` with `action_type: 'chat'`
  - Local path: `callAI` with the built prompt
  - Returns: `{ reply: string }`
- [ ] Step 2.3: Add `'chat'` profile slice to `sliceProfileForOperation()`
  - name, summary, skills, top 2 experiences (with descriptions), education
- [ ] Step 2.4: Register `CHAT_MESSAGE` in the handler registry
  - `'CHAT_MESSAGE': (msg) => handleChat(msg.message, msg.history, msg.jobUrl)`
- [ ] Step 2.5: Export `buildChatPrompt` from `aiService.js`

**Verify:** Send a message from the chat UI → background.js receives it → AI responds → response appears in chat. Test with both signed-in (Edge Function) and signed-out (local API key) paths.

---

## Phase 3: Context Wiring & Persistence
**Goal:** Chat knows about the current job, persists across tab switches, and suggestion chips work end-to-end.
**Files touched:** `extension/content.js`, `extension/background.js`

- [ ] Step 3.1: Pass context to chat on analysis complete
  - After `handleAnalyzeJob` returns, store analysis + digest in module-level state
  - When Ask AI tab activates, show context badge: "Roku · Senior PM · 60% match"
  - If no analysis, show empty state with "Analyze Job" CTA
- [ ] Step 3.2: Implement chat history persistence in `chrome.storage.local`
  - Key: `chatHistory_<url_hash>` (SHA-like simple hash of URL to keep keys short)
  - Value: `{ messages: [{role, content, timestamp}], jobTitle, company, updatedAt }`
  - Save after every AI response
  - Load when Ask AI tab activates (matching current URL)
  - Cap: 50 messages per conversation, 20 conversations total (LRU eviction)
- [ ] Step 3.3: Add storage helpers in background.js
  - `handleSaveChatHistory(urlHash, messages, meta)`
  - `handleGetChatHistory(urlHash)`
  - `handleClearChatHistory(urlHash)`
  - Register message types: `SAVE_CHAT`, `GET_CHAT`, `CLEAR_CHAT`
- [ ] Step 3.4: Wire suggestion chips to send real messages
  - Chip texts:
    - "Am I a good fit for this role?"
    - "Help me prepare for the interview"
    - "Tell me about this company"
    - "What should I highlight from my experience?"
  - On click: insert as user message → send to AI → render response
  - Hide chips after first message sent (they're onboarding, not permanent)
- [ ] Step 3.5: Handle SPA navigation (job change)
  - When URL changes (already detected by existing SPA watcher), clear chat UI
  - Load chat history for new URL (if exists)
  - Show appropriate empty state
- [ ] Step 3.6: Add "Clear chat" button in chat header
  - Small icon button (trash) with `aria-label="Clear conversation"`
  - Confirmation: "Clear this conversation?" with Cancel/Clear
  - Clears both UI and storage for this URL

**Verify:** Analyze a job → open Ask AI → chips visible → click "Am I a good fit?" → get response → navigate to different job → chat clears → go back → previous chat loads from storage.

---

## Phase 4: Polish & Accessibility
**Goal:** The chat is production-ready — accessible, themed, handles all edge cases.
**Files touched:** `extension/content.js`, `extension/styles.css`

- [ ] Step 4.1: Accessibility pass
  - `role="log"` on messages container (screen readers announce new messages)
  - `aria-live="polite"` on messages area
  - `aria-label` on send button, clear button, each chip
  - Focus management: after sending, focus returns to input
  - Typing indicator has `aria-label="AI is thinking"`
  - Copy button on AI messages has `aria-label="Copy response"`
- [ ] Step 4.2: Theme support
  - Chat bubbles respect all 3 themes (Blue, Dark, Warm)
  - User bubbles: primary accent color
  - AI bubbles: muted background
  - Input area: matches panel styling
  - Test all themes for contrast (WCAG AA)
- [ ] Step 4.3: Copy button on AI responses
  - Small "Copy" text button at bottom-right of each AI bubble
  - Click → copies text → button changes to "Copied!" for 2 seconds
- [ ] Step 4.4: Error handling
  - AI call fails → show error message inline as a system bubble (red border)
  - "Something went wrong. Try again." with [Retry] button
  - Retry resends the last user message
  - Network offline → "You're offline. Connect to the internet to chat."
- [ ] Step 4.5: Token-efficient context management
  - Only send last 10 messages as history (not full conversation)
  - Profile sliced for chat (minimal — name, summary, skills, top 2 exp)
  - JD digest used (not raw JD) — already cached
- [ ] Step 4.6: Edge case handling
  - Very long AI response: scrollable bubble, no horizontal overflow
  - Very long user message: textarea auto-grows, max 5 lines, then scrolls
  - Rapid double-send: disable input while AI is thinking
  - Service worker dies mid-response: show timeout error after 30s

**Verify:** Full accessibility audit with keyboard-only navigation. Test all 3 themes. Test error states (disconnect wifi, invalid API key). Test with screen reader (VoiceOver). Test rapid message sending.

---

## Risks & Watchouts
- **Service worker termination**: Long AI responses may exceed the 30s idle timeout. Mitigation: the `return true` in onMessage keeps the channel open during async work, and the Edge Function has a 150s timeout.
- **Storage bloat**: 20 conversations × 50 messages × ~500 chars = ~500KB. Well within chrome.storage.local's 10MB limit. LRU eviction prevents unbounded growth.
- **Context window**: System context (profile + digest + analysis + 10 messages) could be ~2000-3000 tokens. With Groq's 128K context window, this is not a concern.
- **Chat vs analysis conflict**: User might try to chat while analysis is running. Mitigation: disable chat input during analysis, show "Analyzing..." state.

## Out of Scope
- **Streaming responses**: Would require WebSocket or SSE from Edge Function. Nice-to-have for V2 but not MVP.
- **Message editing/deletion**: Users can clear the whole chat but not edit individual messages.
- **File/image sharing in chat**: Text-only for V1.
- **Chat across devices**: History is local-only (chrome.storage.local). Cloud sync is a future feature.
- **Proactive suggestions**: The AI doesn't initiate — user always sends first. Proactive "You should know..." nudges are V2.
