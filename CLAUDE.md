# Applicant Copilot — Claude Code Instructions

## Project Overview
Chrome extension copilot for job applicants. Forked from JobMatchAI (MIT), enhanced with Workday handlers from job_app_filler (BSD-3), prompt patterns inspired by AIHawk, and architecture from workday-copilot.

## Foundation
- **Fork base**: `research/repos/JobMatchAI/` (vanilla JS, Manifest V3, multi-platform)
- **Workday handlers**: `research/repos/job_app_filler/` (TypeScript, 12+ field types)
- **Prompt patterns**: `research/repos/Jobs_Applier_AI_Agent_AIHawk/` (AGPL — study only, reimplement independently)
- **Architecture ref**: `research/repos/workday-copilot/` (WXT + React + TS)

## Tech Stack
- **Extension**: Vanilla JS, Manifest V3, Shadow DOM panel, modular ESM under `extension/src/`
- **Backend**: Supabase (Auth, PostgreSQL + RLS, Storage, Edge Functions)
- **LLM Backend**: Gemini 2.0 Flash (primary) → Groq Llama 3.3 70B (fallback) via Edge Function
- **LLM Local**: 10+ providers via aiService.js abstraction (default: Gemini Flash)
- **Design**: "Organic Archive" sage design system, Manrope font, Material Symbols Outlined icons
- **Validation**: Zod (planned for TypeScript migration)

## Key Architecture
- All backend LLM calls go through Supabase Edge Functions — NEVER from the extension directly
- **Modular ESM**: Content script split into `src/` modules (panel, features, autofill, auto-scan, platform, storage)
- **JD digest pipeline**: Raw JD → one AI call → structured digest (~500 tokens) → cached per URL → reused by all operations
- **Profile slicing**: `sliceProfileForOperation()` sends only relevant profile fields per operation
- **Deterministic matcher**: 30+ field types handled without AI (name, email, EEO, yes/no, URLs)
- **Server-side cache**: `jd_cache` table caches AI responses per user/JD/operation (7-day TTL)
- **Icons**: Use Material Symbols Outlined (`<span class="material-symbols-outlined">icon_name</span>`) — never emoji characters
- **Fonts**: Self-hosted woff2 (Manrope + Material Symbols), loaded via `chrome.runtime.getURL()` in Shadow DOM
- Prompts live in dedicated builder functions in `aiService.js`
- Log all token usage for billing
- Do NOT copy code from AIHawk (AGPL) — study patterns, reimplement independently
- Code from JobMatchAI (MIT) and job_app_filler (BSD-3) can be used freely

## Platform Priority
1. LinkedIn Easy Apply (P0)
2. Workday (P0)
3. Greenhouse / Lever (P1)
4. Indeed / Glassdoor (P2)

## File Naming
- Files: `kebab-case.js` (or `.ts` after migration)
- Components: `PascalCase.tsx`
- Database columns: `snake_case`
- Constants: `UPPER_SNAKE_CASE`

## Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Feature branches: `feat/description`

## Skill Workflow

### Standard feature pipeline
`/cto` → `/explore` → `/plan` → `/execute` → `/peer-review` → `/document`

### Domain specialists (invoke during any workflow stage)
- `/chrome-ext` — Chrome extension architecture, service workers, messaging, content scripts
- `/supabase-arch` — Database schema, RLS, Edge Functions, auth flows, migrations

### Quick patterns
- **Bug fix**: `/explore` → `/execute` → `/review`
- **Architecture decision**: `/cto` (+ domain specialist if needed)
- **Quality gate**: `/peer-review` (4 personas debate to consensus)
- **Focused review**: `/review-ux`, `/review-perf`, `/review-standards`, or `/review-test`
- **Capture idea mid-flow**: `/create-issue`
- **Learn a concept**: `/learn`

### How it works
- All skills read `PROJECT-CONTEXT.md` first — that's what grounds them in this tech stack
- Plan files (`PLAN-*.md`) pass context from `/plan` to `/execute` to `/review`
- CTO decides which stages to activate — not every task needs all 6 stages

## Repositories
- **GitHub**: https://github.com/suryafuturepath/Applicant-CoPilot

## Current Phase
Phase 9 complete (2026-04-11). All features working: Job Analysis, AI Coach Chat, Cover Letter, ATS Resume, Autofill, Interview Prep, Job Tracker (full pipeline), Auto-Scan Widget. Codebase modularized into 33 ESM modules under `src/`. UI rebuilt with "Organic Archive" sage design system — left sidebar nav (User Context / My Jobs / AI Settings), Material Symbols icons throughout, Manrope font. Edge Function: Gemini (primary) → Groq (fallback), deployed with `--no-verify-jwt`. Next: Phase 10 — Chrome Web Store submission, WXT migration, billing, Workday handlers. See PROJECT-CONTEXT.md for full status.
