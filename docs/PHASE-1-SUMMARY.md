# Phase 1: Fork & Project Setup — Summary

**Date:** 2026-03-26
**Status:** Complete
**Linear Ticket:** [APP-6](https://linear.app/applicant-copilot/issue/APP-6/phase-1-fork-jobmatchai-and-project-setup)
**Commit:** `e0f820a` — `chore: fork JobMatchAI as Applicant Copilot extension base`

---

## What We Did

### 1. Research & Competitive Analysis
Analyzed **13 open-source repos** for job application automation tools. Cloned 9, deep-analyzed all with specialized agents.

**Full analysis:** [research/ANALYSIS.md](../research/ANALYSIS.md)

#### Final Selection: 4 Foundation Repos

| Repo | License | Role | Stars | Code Quality |
|------|---------|------|-------|-------------|
| **JobMatchAI** | MIT ✅ | Fork base | 3 | 8/10 |
| **job_app_filler** | BSD-3 ✅ | Port Workday handlers (Phase 2) | 22 | 8/10 |
| **AIHawk** | AGPL ⚠️ | Study prompts only | 29.5k | 7/10 |
| **workday-copilot** | MIT ✅ | Architecture reference | 1 | 8/10 |

#### Repos Evaluated & Dropped

| Repo | Why Dropped |
|------|-------------|
| ApplyEase | "Personal use only" license — can't commercialize |
| AutoApplyMax | AGPL + core features hidden in paid cloud |
| Auto_job_applier_linkedIn | AGPL + Python/Selenium (not Chrome extension) |
| InscribeAI | Too bare-bones (cover letter only) |
| workpls | Outdated Manifest V2, no AI |
| AI-Job-Autofill | Limited documentation |
| ApplyPilot | AGPL + Python/Playwright |
| linkedin-autoapply-chrome-extension | Basic, no AI |
| linkedin-easyapply-using-AI | Python bot, not extension |

---

### 2. Three-Way Architecture Review

Before forking, three specialized reviewers analyzed JobMatchAI:

#### CTO Review
- **Verdict:** Fork with confidence
- **Key insight:** Move extension files into `extension/` subdirectory for clean monorepo
- **Branding:** Found 14+ instances of "JobMatch AI" to rename
- **Storage keys:** `jm_*` → `ac_*` (5 keys)
- **CSS variables:** `--jm-*` → `--ac-*` (20+ variables)
- **Core logic:** Keep 100% untouched

#### Architect Review
- **Architecture:** Sound — clean message passing, Shadow DOM isolation, provider abstraction
- **Message flow:** content.js → chrome.runtime.sendMessage → background.js → handler → response
- **AI service:** 10 providers, strategy pattern (fetchAnthropic/fetchOpenAI/fetchGemini/fetchCohere)
- **Form detection:** 5 field types (select, text, custom dropdown, radio, checkbox)
- **Security:** escapeHTML used consistently, closed Shadow DOM, no XSS vectors in content.js

#### Standards Review
- **4 issues flagged as CRITICAL:**
  1. Async message handling — **False alarm** (code already has `return true`)
  2. Event listener memory leaks — **Deferred to Phase 2** (cleanup handlers)
  3. XSS in profile.js — **False alarm** (escapeHTML/escapeAttr used consistently on audit)
  4. API keys in plain text — **Deferred to Phase 3** (Supabase backend solves this)
- **Overall:** 8/10 code quality, well-documented, production-ready with known limitations

---

### 3. Fork Execution

#### Files Copied to `extension/`

| File | Size | Role |
|------|------|------|
| `manifest.json` | 1.5 KB | Extension config — Manifest V3 |
| `background.js` | 37 KB | Service worker — message routing, AI orchestration, storage |
| `content.js` | 136 KB | Content script — Shadow DOM panel, JD extraction, form detection, autofill |
| `aiService.js` | 54 KB | AI provider abstraction — 10 providers, retry logic, prompt builders |
| `deterministicMatcher.js` | 25 KB | Rule-based EEO/demographic dropdown matching |
| `profile.js` | 77 KB | Profile page — resume upload, Q&A management, settings |
| `profile.html` | 25 KB | Profile page markup + CSS |
| `styles.css` | 0.5 KB | Host element positioning |
| `icons/` | 3 files | 16px, 48px, 128px extension icons |
| `libs/` | 3 files | pdf.js, pdf.worker.js, mammoth.js (resume parsing) |

#### Rebranding Applied

| Category | Old | New | Instances |
|----------|-----|-----|-----------|
| Extension name | JobMatch AI | Applicant Copilot | manifest.json, profile.html |
| UI strings | "JobMatch AI" | "Applicant Copilot" | 7 in content.js, 2 in profile |
| Badge text | "Autofilled by JobMatch AI" | "Refined by Applicant Copilot" | content.js |
| Global guard | `window.__jobmatchAILoaded` | `window.__applicantCopilotLoaded` | content.js |
| Storage keys | `jm_analysisCache`, `jm_theme`, `jm_jobNotes` | `ac_analysisCache`, `ac_theme`, `ac_jobNotes` | content.js, profile.js |
| CSS variables | `--jm-primary`, `--jm-bg`, etc. | `--ac-primary`, `--ac-bg`, etc. | content.js, profile.html |
| DOM host IDs | `jobmatch-ai-panel-host` | `applicant-copilot-panel-host` | content.js, styles.css |
| FAB position key | `jm-fab-pos` | `ac-fab-pos` | content.js |
| OpenRouter header | `JobMatch AI` | `Applicant Copilot` | aiService.js |
| Version | 1.0.4 | 0.1.0 | manifest.json |

**Kept as-is:** `.jm-` CSS class prefix (113 references in Shadow DOM CSS — too risky to rename without tests, deferred to Week 2 TypeScript migration)

#### New Files Created

| File | Purpose |
|------|---------|
| `.gitignore` | Ignores node_modules, .env, research/, *.zip, .DS_Store |
| `LICENSE` | MIT license |
| `.env.example` | Template for Supabase + Anthropic keys (Phase 2) |
| `extension/TESTING.md` | 10 manual test cases for Phase 1 verification |

---

### 4. Project Structure (Post Phase 1)

```
Applicant Copilot/
├── extension/                     # Chrome extension (forked from JobMatchAI)
│   ├── manifest.json              # Manifest V3 config (v0.1.0)
│   ├── background.js              # Service worker (37KB)
│   ├── content.js                 # Content script + Shadow DOM panel (136KB)
│   ├── aiService.js               # AI provider abstraction (54KB)
│   ├── deterministicMatcher.js    # EEO dropdown matching (25KB)
│   ├── profile.html               # Profile/settings page (25KB)
│   ├── profile.js                 # Profile page logic (77KB)
│   ├── styles.css                 # Host element positioning
│   ├── icons/                     # Extension icons (16, 48, 128px)
│   ├── libs/                      # pdf.js + mammoth.js (resume parsing)
│   └── TESTING.md                 # Manual test cases
├── research/                      # Foundation repos (gitignored)
│   └── repos/
│       ├── JobMatchAI/            # Fork source (MIT)
│       ├── job_app_filler/        # Workday handlers (BSD-3)
│       ├── Jobs_Applier_AI_Agent_AIHawk/  # Prompt patterns (AGPL)
│       └── workday-copilot/       # WXT reference (MIT)
├── docs/
│   └── PHASE-1-SUMMARY.md        # This file
├── .gitignore
├── .env.example
├── LICENSE                        # MIT
├── PROJECT-CONTEXT.md             # Full project context
├── PLAN.md                        # Week 1 implementation plan
└── CLAUDE.md                      # Claude Code instructions
```

---

### 5. Key Architecture (What We Inherited)

#### Extension Communication Flow
```
Content Script (content.js)
  ↕ chrome.runtime.sendMessage / onMessage
Background Service Worker (background.js)
  ↕ imports
AI Service (aiService.js)
  ↕ fetch()
AI Providers (Anthropic, OpenAI, Gemini, Groq, etc.)
```

#### AI Providers Supported (10)
| Provider | API Style | Free Tier |
|----------|-----------|-----------|
| Anthropic (Claude) | Proprietary | No |
| OpenAI (GPT) | OpenAI | No |
| Google (Gemini) | Proprietary | Yes |
| Groq | OpenAI-compatible | Yes |
| Cerebras | OpenAI-compatible | Yes |
| Together AI | OpenAI-compatible | Yes |
| OpenRouter | OpenAI-compatible | Varies |
| Mistral AI | OpenAI-compatible | Yes |
| DeepSeek | OpenAI-compatible | Yes |
| Cohere | Proprietary v2 | Yes |

#### Platform Support (JD Extraction + Form Detection)
| Platform | JD Extraction | Form Autofill |
|----------|:---:|:---:|
| LinkedIn | ✅ | ✅ |
| Workday | ✅ | ✅ (basic) |
| Indeed | ✅ | ✅ |
| Glassdoor | ✅ | ✅ |
| Greenhouse | ✅ | ✅ |
| Lever | ✅ | ✅ |
| Generic sites | ✅ (heuristic) | ✅ |

---

### 6. Known Issues & Tech Debt

| Issue | Severity | Source | Fix Phase |
|-------|----------|--------|-----------|
| Event listener cleanup on panel close | HIGH | Standards Review | Phase 2 |
| API keys stored in plain text | HIGH | Standards Review | Phase 3 (Supabase) |
| `deterministicMatcher.js` gender/gender_identity ordering bug | MEDIUM | QA Review (Priya) | Phase 1 hotfix |
| content.js is 3700 lines (monolithic) | MEDIUM | All reviewers | Week 2 (TS migration) |
| `.jm-` CSS class prefix not renamed | LOW | CTO Review | Week 2 (TS migration) |
| No automated tests | HIGH | QA Review | Phase 2 |
| `<all_urls>` content script injection | MEDIUM | Architect Review | Phase 5 |
| Silent error suppression (empty catch blocks) | MEDIUM | Standards Review | Phase 3 |
| Magic numbers without comments | LOW | Standards Review | Phase 3 |

---

### 7. Linear Tickets

| Ticket | Title | Status |
|--------|-------|--------|
| [APP-5](https://linear.app/applicant-copilot/issue/APP-5) | [EPIC] Applicant Copilot MVP — Week 1 | In Progress |
| [APP-6](https://linear.app/applicant-copilot/issue/APP-6) | Phase 1: Fork & Project Setup | In Progress |
| [APP-7](https://linear.app/applicant-copilot/issue/APP-7) | Phase 2: Supabase Backend Setup | Todo |
| [APP-8](https://linear.app/applicant-copilot/issue/APP-8) | Phase 3: Connect Extension to Backend | Todo |
| [APP-9](https://linear.app/applicant-copilot/issue/APP-9) | Phase 4: Copilot UX Layer | Todo |
| [APP-10](https://linear.app/applicant-copilot/issue/APP-10) | Phase 5: Polish & Ship | Todo |

---

### 8. Next Steps (Phase 2)

1. **Test Phase 1** — Load extension in Chrome, run smoke tests
2. **Fix gender_identity bug** in deterministicMatcher.js
3. **Set up Supabase** — project, auth, DB schema, storage, Edge Function
4. **LLM proxy** — Edge Function that calls Claude, logs usage

See [PLAN.md](../PLAN.md) for full Phase 2 breakdown.
