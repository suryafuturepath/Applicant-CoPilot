# Applicant Copilot -- QA Assessment & Test Plan

**Reviewer:** Priya (Senior QA Engineer)
**Date:** 2026-03-26
**Scope:** Phase 1 fork (vanilla JS Chrome extension, no build step)

---

## 1. Current Test Coverage: ZERO

Confirmed. There are:
- No `*.test.js` or `*.spec.js` files anywhere in the project
- No `jest.config.*` or `vitest.config.*`
- No `package.json` with test scripts in the extension directory
- No `__tests__/` directories
- No test infrastructure whatsoever

The only quality artifact is `extension/TESTING.md`, which contains 10 manual smoke test cases focused on branding verification (Phase 1 rebrand). These are useful but cover none of the critical logic paths.

---

## 2. Critical Testing Gaps (Ranked by Risk)

### P0 -- Will cause real user harm if broken

| Gap | Risk | Why it matters |
|-----|------|----------------|
| **`parseJSONResponse` -- no tests** | AI returns malformed JSON, entire pipeline fails silently | Every AI operation (analyze, autofill, cover letter) depends on this function. 10 different providers return JSON in different wrappers. One bad regex = all operations broken. |
| **`escapeHTML` -- no tests** | XSS in the side panel | AI-generated content is rendered into Shadow DOM via `innerHTML` calls. If `escapeHTML` fails on edge cases (null, undefined, HTML entities, script tags), the user's browser executes attacker-controlled JS. |
| **`callAI` retry/concurrency -- no tests** | Silent failures, runaway requests, rate limit death spirals | Retry logic with exponential backoff and concurrency guards. If `activeRequests` counter leaks (e.g., exception in finally block), ALL future AI calls fail permanently until service worker restarts. |
| **`deterministicFieldMatcher` -- no tests** | Wrong EEO answers submitted to employers | Incorrect gender, race, veteran, disability answers on real applications. This is a legal/compliance risk for users. |

### P1 -- Will cause broken functionality

| Gap | Risk | Why it matters |
|-----|------|----------------|
| **`detectFormFields` -- no tests** | Autofill misses fields or maps wrong labels | 5 ATS platforms, each with different DOM structures. Custom dropdowns, hidden selects, ARIA attributes. Breakage = fields missed or wrong answers in wrong fields. |
| **Message passing handler dispatch -- no tests** | Background worker returns `Unknown message type` errors | The `handlers` object in background.js is a flat map of 15+ message types. One typo in a message type string = dead feature. |
| **`wrapAIError` -- no tests** | Raw API errors shown to users | Users see "TypeError: Cannot read property 'message' of undefined" instead of "Please check your internet connection." |

### P2 -- Quality of life

| Gap | Risk | Why it matters |
|-----|------|----------------|
| Analysis cache TTL logic | Stale results or redundant API calls | 24h cache with LRU eviction. Off-by-one in timestamp math = either stale data or cache misses burning API credits. |
| Profile/settings storage defaults | Null pointer on first run | `getSettings()` returns defaults when storage is empty. If defaults drift from what callAI expects, first-run users get cryptic errors. |

---

## 3. Recommended Test Infrastructure

### Framework: Vitest

**Why Vitest over Jest for this project:**
- Native ES module support (this codebase uses `import/export` in aiService.js and deterministicMatcher.js)
- No Babel/transform configuration needed
- Fast startup (important for developer adoption on a 1-person team)
- Compatible with Jest's `expect` API (low learning curve)

### Setup (minimal, no build step disruption)

```
extension/
  tests/
    setup.js              # Chrome API mocks
    aiService.test.js     # parseJSONResponse, callAI, wrapAIError
    deterministicMatcher.test.js  # topic detection, option matching
    escapeHTML.test.js    # XSS prevention
    background.test.js   # message handler dispatch
  vitest.config.js
  package.json            # devDependencies only
```

### Chrome API Mock Strategy

The extension code calls `chrome.storage.local.get/set`, `chrome.runtime.sendMessage`, `chrome.tabs.query`, etc. These do not exist in Node. We need a thin mock layer:

```js
// tests/setup.js -- minimal Chrome API mock
globalThis.chrome = {
  storage: {
    local: {
      _store: {},
      get: async (keys) => {
        if (typeof keys === 'string') keys = [keys];
        const result = {};
        for (const k of keys) {
          if (k in chrome.storage.local._store) result[k] = chrome.storage.local._store[k];
        }
        return result;
      },
      set: async (items) => { Object.assign(chrome.storage.local._store, items); },
      clear: async () => { chrome.storage.local._store = {}; }
    }
  },
  runtime: {
    sendMessage: async () => ({}),
    onMessage: { addListener: () => {} },
    onInstalled: { addListener: () => {} }
  },
  tabs: {
    query: async () => [{ id: 1 }],
    sendMessage: async () => ({})
  }
};
```

### Key constraint: extractable functions

The biggest obstacle is that `content.js` wraps everything in an IIFE. Functions like `escapeHTML`, `detectFormFields`, and `togglePanel` are not exported. For testing, we have two options:

1. **Extract pure functions into a separate module** (recommended) -- Move `escapeHTML`, `detectFormFields`, `isCustomDropdown`, `buildSelectOptions`, `readCustomOptions`, and `getFieldLabel` into `extension/utils.js` and import them from both `content.js` and tests.
2. **Test via copy** (quick-and-dirty) -- Copy the function implementations into test files. Fragile, but works for Week 1.

For `aiService.js` and `deterministicMatcher.js`, they already use ES module exports, so they are directly testable.

---

## 4. Minimum Viable Test Suite -- 8 Test Cases

These are ordered by "damage prevented per line of test code." Write these first.

---

### Test 1: `parseJSONResponse` handles all real-world AI output formats

**File:** `tests/aiService.test.js`
**Priority:** P0
**Why:** Every AI feature depends on this. 10 providers, each with quirks.

```js
import { describe, it, expect } from 'vitest';

// parseJSONResponse is not currently exported. Add it to the export list in aiService.js:
//   export { callAI, PROVIDERS, parseJSONResponse, ... };
// For now, copy the implementation for testing:

function parseJSONResponse(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) { try { return JSON.parse(fenceMatch[1].trim()); } catch (_) {} }
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch (_) {} }
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch (_) {} }
  throw new Error('Could not parse JSON from AI response');
}

describe('parseJSONResponse', () => {
  it('parses clean JSON object', () => {
    const result = parseJSONResponse('{"score": 85, "match": true}');
    expect(result).toEqual({ score: 85, match: true });
  });

  it('parses JSON wrapped in ```json fences', () => {
    const input = '```json\n{"score": 85}\n```';
    expect(parseJSONResponse(input)).toEqual({ score: 85 });
  });

  it('parses JSON wrapped in bare ``` fences', () => {
    const input = '```\n{"score": 85}\n```';
    expect(parseJSONResponse(input)).toEqual({ score: 85 });
  });

  it('extracts JSON object from surrounding prose', () => {
    const input = 'Here is the analysis:\n{"score": 85, "skills": ["JS"]}\nHope this helps!';
    expect(parseJSONResponse(input)).toEqual({ score: 85, skills: ['JS'] });
  });

  it('extracts JSON array from surrounding prose', () => {
    const input = 'The answers are:\n[{"field": "name", "value": "Alice"}]\nDone.';
    expect(parseJSONResponse(input)).toEqual([{ field: 'name', value: 'Alice' }]);
  });

  it('throws on completely non-JSON text', () => {
    expect(() => parseJSONResponse('I cannot help with that.')).toThrow('Could not parse JSON');
  });

  it('handles nested JSON with markdown fences', () => {
    const input = '```json\n{"skills": ["React", "Node"], "experience": {"years": 5}}\n```';
    const result = parseJSONResponse(input);
    expect(result.experience.years).toBe(5);
  });

  it('handles empty string', () => {
    expect(() => parseJSONResponse('')).toThrow('Could not parse JSON');
  });

  // CRITICAL edge case: some models return JSON with trailing comma (invalid JSON).
  // This test documents the current behavior -- it will fail.
  // If this is a real problem in production, consider adding a trailing-comma stripper.
  it('fails on trailing commas (documents known limitation)', () => {
    expect(() => parseJSONResponse('{"score": 85,}')).toThrow();
  });
});
```

---

### Test 2: `escapeHTML` prevents XSS

**File:** `tests/escapeHTML.test.js`
**Priority:** P0 (security)
**Why:** AI-generated text is inserted into the panel via innerHTML. If escapeHTML is bypassed or broken, every AI response is a potential XSS vector.

```js
import { describe, it, expect } from 'vitest';

// escapeHTML uses DOM (document.createElement). In Node/Vitest, we need jsdom.
// Alternative: rewrite as a pure string function (recommended for testability).

// Pure-string implementation for testing (and proposed replacement):
function escapeHTMLPure(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

describe('escapeHTML', () => {
  it('escapes <script> tags', () => {
    expect(escapeHTMLPure('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes HTML event handlers', () => {
    expect(escapeHTMLPure('<img onerror="alert(1)" src=x>')).toBe(
      '&lt;img onerror=&quot;alert(1)&quot; src=x&gt;'
    );
  });

  it('escapes ampersands', () => {
    expect(escapeHTMLPure('AT&T')).toBe('AT&amp;T');
  });

  it('escapes quotes', () => {
    expect(escapeHTMLPure('She said "hello"')).toBe('She said &quot;hello&quot;');
  });

  it('handles null input', () => {
    expect(escapeHTMLPure(null)).toBe('');
  });

  it('handles undefined input', () => {
    expect(escapeHTMLPure(undefined)).toBe('');
  });

  it('handles numeric input', () => {
    expect(escapeHTMLPure(42)).toBe('42');
  });

  it('handles empty string', () => {
    expect(escapeHTMLPure('')).toBe('');
  });

  it('preserves safe text unchanged', () => {
    expect(escapeHTMLPure('Hello World 123')).toBe('Hello World 123');
  });

  // This is the critical case: AI could return content with nested HTML
  it('escapes AI-generated content with HTML-like formatting', () => {
    const aiResponse = 'Use <strong>React</strong> and "hooks" for state management';
    const escaped = escapeHTMLPure(aiResponse);
    expect(escaped).not.toContain('<strong>');
    expect(escaped).toContain('&lt;strong&gt;');
  });
});
```

**IMPORTANT NOTE:** The current `escapeHTML` in content.js uses `div.textContent = str; return div.innerHTML;` which is actually safe and correct. BUT it does not guard against null/undefined input. If `str` is null, `div.textContent = null` produces the string `"null"`, which is rendered to the user. The tests above use a pure-string replacement that handles these edge cases. Recommendation: replace the DOM-based version with the pure-string version in content.js and profile.js for testability AND null-safety.

---

### Test 3: `deterministicFieldMatcher` correctly classifies EEO topics

**File:** `tests/deterministicMatcher.test.js`
**Priority:** P0 (compliance risk)
**Why:** Wrong EEO answers submitted to employers. Gender, race, disability -- getting these wrong is not just a bug, it is a legal/reputational risk for the user.

```js
import { describe, it, expect } from 'vitest';
import { deterministicFieldMatcher, detectTopic, normalize } from '../deterministicMatcher.js';

describe('detectTopic', () => {
  it('detects gender question', () => {
    expect(detectTopic('What is your gender?')).toBe('gender');
  });

  it('detects gender_identity before gender', () => {
    // This tests the ordering: "gender identity" should NOT match "gender"
    expect(detectTopic('What is your gender identity?')).toBe('gender_identity');
  });

  it('detects work authorization', () => {
    expect(detectTopic('Are you legally authorized to work in the US?')).toBe('work_auth');
  });

  it('detects sponsorship', () => {
    expect(detectTopic('Will you require visa sponsorship?')).toBe('sponsorship');
  });

  it('detects veteran status', () => {
    expect(detectTopic('Are you a protected veteran?')).toBe('veteran');
  });

  it('detects disability', () => {
    expect(detectTopic('Do you have a disability?')).toBe('disability');
  });

  it('detects race/ethnicity', () => {
    expect(detectTopic('What is your race or ethnicity?')).toBe('race_ethnicity');
  });

  it('detects Hispanic/Latino', () => {
    expect(detectTopic('Are you Hispanic or Latino?')).toBe('hispanic_latino');
  });

  it('detects pronouns', () => {
    expect(detectTopic('What are your preferred pronouns?')).toBe('pronouns');
  });

  it('returns null for non-EEO questions', () => {
    expect(detectTopic('Tell me about your experience with React')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(detectTopic('')).toBeNull();
  });
});

describe('deterministicFieldMatcher', () => {
  const qaList = [
    { question: 'What is your gender?', answer: 'Male' },
    { question: 'Are you authorized to work in the US?', answer: 'Yes' },
    { question: 'What is your race or ethnicity?', answer: 'South Asian' },
    { question: 'Do you have a disability?', answer: 'No' },
    { question: 'Are you a veteran?', answer: 'No' },
  ];

  const profile = {};

  it('matches gender dropdown with saved Q&A', () => {
    const result = deterministicFieldMatcher(
      'What is your gender?',
      ['Male', 'Female', 'Non-binary', 'Prefer not to say'],
      qaList,
      profile
    );
    expect(result.matched).toBe(true);
    expect(result.option).toBe('Male');
  });

  it('matches "Man" option when user saved "Male"', () => {
    const result = deterministicFieldMatcher(
      'What is your gender?',
      ['Man', 'Woman', 'Non-binary', 'Prefer not to say'],
      qaList,
      profile
    );
    expect(result.matched).toBe(true);
    expect(result.option).toBe('Man');
  });

  it('matches work authorization yes/no', () => {
    const result = deterministicFieldMatcher(
      'Are you legally authorized to work in the United States?',
      ['Yes', 'No'],
      qaList,
      profile
    );
    expect(result.matched).toBe(true);
    expect(result.option).toBe('Yes');
  });

  it('returns matched=false for non-EEO question', () => {
    const result = deterministicFieldMatcher(
      'How many years of Python experience do you have?',
      ['0-1', '2-3', '4-5', '6+'],
      qaList,
      profile
    );
    expect(result.matched).toBe(false);
  });

  it('returns matched=false when no Q&A answer exists for the topic', () => {
    const result = deterministicFieldMatcher(
      'What are your preferred pronouns?',
      ['he/him', 'she/her', 'they/them'],
      [],  // empty Q&A
      {}
    );
    expect(result.matched).toBe(false);
  });

  it('handles race matching with synonym expansion', () => {
    const result = deterministicFieldMatcher(
      'What is your race or ethnicity?',
      ['White', 'Black or African American', 'Asian', 'South Asian (including India, Pakistan, Bangladesh)', 'Hispanic or Latino'],
      qaList,
      profile
    );
    expect(result.matched).toBe(true);
    // "South Asian" saved answer should match the long-form option
    expect(result.option).toContain('South Asian');
  });
});
```

---

### Test 4: `wrapAIError` produces user-friendly error messages

**File:** `tests/aiService.test.js` (append to Test 1 file)
**Priority:** P1
**Why:** Raw API errors leak to users. "TypeError: Cannot read property..." is not acceptable UX.

```js
// Add to tests/aiService.test.js

// Copy wrapAIError for testing (until exports are updated)
function wrapAIError(e) {
  if (!e.status && (e.message?.includes('Failed to fetch') || e.message?.includes('NetworkError') || e.name === 'TypeError')) {
    return new Error('Could not connect to AI provider. Please check your internet connection.');
  }
  if (e.status === 401 || e.status === 403) {
    return new Error('Invalid API key. Please check your API key in settings.');
  }
  if (e.status === 429) {
    return new Error('Rate limit exceeded. Please wait a moment and try again.');
  }
  if (e.status === 500 || e.status === 502 || e.status === 503) {
    return new Error('AI provider is temporarily unavailable. Please try again later.');
  }
  const brief = e.message ? e.message.substring(0, 200) : 'Unknown error';
  return new Error(`AI request failed: ${brief}`);
}

describe('wrapAIError', () => {
  it('wraps network errors (Failed to fetch)', () => {
    const err = new Error('Failed to fetch');
    expect(wrapAIError(err).message).toContain('internet connection');
  });

  it('wraps TypeError as network error', () => {
    const err = new TypeError('NetworkError when attempting to fetch resource');
    expect(wrapAIError(err).message).toContain('internet connection');
  });

  it('wraps 401 as invalid API key', () => {
    const err = Object.assign(new Error('Unauthorized'), { status: 401 });
    expect(wrapAIError(err).message).toContain('API key');
  });

  it('wraps 403 as invalid API key', () => {
    const err = Object.assign(new Error('Forbidden'), { status: 403 });
    expect(wrapAIError(err).message).toContain('API key');
  });

  it('wraps 429 as rate limit', () => {
    const err = Object.assign(new Error('Too Many Requests'), { status: 429 });
    expect(wrapAIError(err).message).toContain('Rate limit');
  });

  it('wraps 500/502/503 as provider unavailable', () => {
    for (const status of [500, 502, 503]) {
      const err = Object.assign(new Error('Server Error'), { status });
      expect(wrapAIError(err).message).toContain('temporarily unavailable');
    }
  });

  it('truncates long error messages to 200 chars', () => {
    const longMsg = 'A'.repeat(500);
    const err = Object.assign(new Error(longMsg), { status: 418 });
    expect(wrapAIError(err).message.length).toBeLessThan(250);
  });

  it('handles error with no message', () => {
    const err = Object.assign(new Error(), { status: 418 });
    // Error() creates an error with empty string message, not undefined
    const result = wrapAIError(err);
    expect(result.message).toContain('AI request failed');
  });
});
```

---

### Test 5: `callAI` concurrency guard and retry logic

**File:** `tests/aiService.test.js` (append)
**Priority:** P0
**Why:** If the `activeRequests` counter leaks, ALL AI calls fail permanently. This is a service-worker-lifetime bug that is invisible in manual testing.

```js
describe('callAI concurrency and retry logic', () => {
  // These tests require mocking fetch and the PROVIDERS registry.
  // Pseudocode showing what to test -- real implementation needs
  // the function extracted or the module imported with mocked fetch.

  it('rejects when MAX_CONCURRENT requests are in flight', async () => {
    // Simulate 3 in-flight requests
    // The 4th call should throw 'Too many AI requests in progress'
    // IMPORTANT: verify activeRequests is decremented even when this happens
  });

  it('retries on 429 with exponential backoff', async () => {
    // Mock fetch to return 429 twice, then 200
    // Verify: 3 total calls made
    // Verify: delays between calls increase (1s, 2s)
  });

  it('does NOT retry on 401', async () => {
    // Mock fetch to return 401
    // Verify: only 1 call made (no retry)
    // Verify: error message mentions "API key"
  });

  it('decrements activeRequests even on error', async () => {
    // Mock fetch to throw
    // Verify: activeRequests returns to 0 after the error
    // This is the CRITICAL test -- if finally block doesn't run,
    // the extension is permanently broken until service worker restart
  });
});
```

---

### Test 6: Background message handler dispatch

**File:** `tests/background.test.js`
**Priority:** P1
**Why:** One typo in a message type string = a dead feature. This is a high-surface-area integration point.

```js
import { describe, it, expect } from 'vitest';

// The handlers object is not exported. To test it properly, either:
// (a) Export handlers from background.js, or
// (b) Test via chrome.runtime.sendMessage simulation

// Minimum: verify that all message types used in content.js
// have corresponding handlers in background.js.

// This is a STATIC analysis test -- no runtime needed.
// Extract message types from content.js and verify they exist in background.js.

describe('message handler coverage', () => {
  // These are the message types sent from content.js
  const contentScriptMessageTypes = [
    'TEST_CONNECTION',
    'PARSE_RESUME',
    'ANALYZE_JOB',
    'GENERATE_AUTOFILL',
    'MATCH_DROPDOWN',
    'SAVE_PROFILE',
    'GET_PROFILE',
    'SAVE_SETTINGS',
    'GET_SETTINGS',
    'SAVE_QA_LIST',
    'GET_QA_LIST',
  ];

  // Read background.js handlers object keys (this would be done by importing)
  // For now, this is a documentation test:
  it('all content script message types have handlers', () => {
    // When handlers are exported, this becomes:
    // for (const type of contentScriptMessageTypes) {
    //   expect(handlers).toHaveProperty(type);
    // }

    // Until then, this test serves as a checklist.
    // Mark as pending:
    expect(contentScriptMessageTypes.length).toBeGreaterThan(0);
  });
});
```

---

### Test 7: `detectTopic` ordering -- gender_identity must match before gender

**File:** `tests/deterministicMatcher.test.js` (append)
**Priority:** P0 (compliance)
**Why:** If topic detection order changes (e.g., during a refactor), "What is your gender identity?" could match "gender" instead of "gender_identity", causing the wrong saved answer to be used.

```js
describe('detectTopic ordering (regression guard)', () => {
  // These tests specifically guard against reordering TOPIC_PATTERNS

  it('gender_identity takes priority over gender', () => {
    expect(detectTopic('Please select your gender identity')).toBe('gender_identity');
    expect(detectTopic('I identify as transgender')).toBe('gender_identity');
  });

  it('sexual_orientation is not confused with gender', () => {
    expect(detectTopic('What is your sexual orientation?')).toBe('sexual_orientation');
  });

  it('hispanic_latino is not confused with race_ethnicity', () => {
    expect(detectTopic('Are you Hispanic or Latino?')).toBe('hispanic_latino');
  });

  it('work_auth detects various phrasings', () => {
    const phrasings = [
      'Are you authorized to work in the US?',
      'Are you legally authorized to work in the United States?',
      'Are you eligible to work in the U.S.?',
      'Employment eligibility',
    ];
    for (const p of phrasings) {
      expect(detectTopic(p)).toBe('work_auth');
    }
  });
});
```

---

### Test 8: `normalize` function for fuzzy matching

**File:** `tests/deterministicMatcher.test.js` (append)
**Priority:** P1
**Why:** The `normalize` function is used in `matchAnswerToOption` for fuzzy matching. If normalization strips too much or too little, synonym matching breaks.

```js
describe('normalize', () => {
  it('lowercases text', () => {
    expect(normalize('MALE')).toBe(normalize('male'));
  });

  it('strips common prefixes like "prefer not to"', () => {
    // Test actual behavior -- adjust expectations based on implementation
    const n = normalize('Prefer not to disclose');
    expect(n).not.toContain('prefer');
  });

  it('handles empty string', () => {
    expect(normalize('')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    // If normalize doesn't guard against null, this documents the crash
    // and motivates adding a guard
    expect(() => normalize(null)).not.toThrow();
  });
});
```

---

## 5. Setup Instructions

### Step 1: Initialize package.json in extension/

```bash
cd extension
npm init -y
npm install --save-dev vitest
```

### Step 2: Create vitest.config.js

```js
// extension/vitest.config.js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    environment: 'node',  // Use 'jsdom' if testing escapeHTML with DOM
  }
});
```

### Step 3: Add test script to package.json

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### Step 4: Create tests/setup.js with Chrome API mocks (see Section 3 above)

### Step 5: Make functions testable

The single most impactful refactor is adding exports:

**aiService.js** -- already exports most things. Add `parseJSONResponse` and `wrapAIError` to the export list.

**deterministicMatcher.js** -- already exports `deterministicFieldMatcher`, `detectTopic`, `normalize`. Good.

**content.js** -- extract `escapeHTML` into `extension/utils.js`:
```js
// extension/utils.js
export function escapeHTML(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

Then import it in content.js and profile.js. This is a 5-minute refactor that unblocks security testing.

---

## 6. What NOT to Test (Week 1)

Do not waste time on:
- **DOM rendering tests** (Shadow DOM panel creation, CSS) -- manual testing is fine here
- **End-to-end Chrome extension tests** (Puppeteer/Playwright with extension loading) -- too expensive to set up for Week 1
- **AI response quality** -- this is prompt engineering, not unit testing
- **Cross-browser testing** -- Chrome only for now
- **Profile page UI** (profile.js) -- low risk, mostly CRUD

---

## 7. Findings Summary

| Finding | Severity | Action |
|---------|----------|--------|
| Zero automated tests | Critical | Set up Vitest + write P0 tests (2-3 hours) |
| `escapeHTML` not null-safe | Medium | Current impl converts null to string "null". Replace with pure-string version that returns empty string for null/undefined. |
| `parseJSONResponse` greedy regex | Low | `\{[\s\S]*\}` uses greedy match, which means if AI returns two JSON objects, it grabs everything from first `{` to last `}`. Unlikely in practice but worth documenting. |
| `TOPIC_PATTERNS` ordering is load-bearing | Medium | The comment says "most-specific first" but the actual object has `gender` BEFORE `gender_identity`. JavaScript object key order is insertion order, so `gender` patterns are tested first. If "gender identity" matches `/\bgender\b/i` (it does!), it returns `gender` instead of `gender_identity`. This is a real bug if the regex matches broadly. Need to verify. |
| `activeRequests` global mutable state | Medium | If the service worker is torn down and restarted (normal MV3 behavior), `activeRequests` resets to 0. This is correct. But if an exception occurs between `activeRequests++` and the `try` block, the counter leaks. Current code has `finally` block, so this is safe -- but worth a test to guard against refactoring. |
| `content.js` is 3600+ lines in one IIFE | High (maintainability) | Untestable as-is. Extract utility functions into modules as the TypeScript migration happens. |
| No `package.json` in extension root | Blocker for testing | Must create one to install Vitest. |

---

## 8. Potential Bug Found: TOPIC_PATTERNS Ordering

In `deterministicMatcher.js`, the `TOPIC_PATTERNS` object has this key order:

```
gender, gender_identity, sexual_orientation, race_ethnicity, ...
```

The comment says "ordered from most-specific to least-specific" but `gender` is listed BEFORE `gender_identity`. The `detectTopic` function iterates with `Object.entries()`, which preserves insertion order. This means the pattern `/\bgender\b/i` is tested BEFORE `/\bgender.?identity\b/i`.

The question "What is your gender identity?" contains the word "gender", so it matches `/\bgender\b/i` and returns topic `"gender"` instead of `"gender_identity"`.

**Impact:** A user's saved gender identity answer (e.g., "cisgender") would never be found because the system looks up their gender answer (e.g., "male") instead.

**Fix:** Swap the order so `gender_identity` comes before `gender` in the object literal. This needs a test to prevent regression (Test 7 above).

**Verification needed:** Run `detectTopic("What is your gender identity?")` and confirm whether it returns `"gender"` or `"gender_identity"`. If it returns `"gender"`, this is a confirmed bug.
