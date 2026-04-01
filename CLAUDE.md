# Applicant Copilot — Claude Code Instructions

## Project Overview
Chrome extension copilot for job applicants. Forked from JobMatchAI (MIT), enhanced with Workday handlers from job_app_filler (BSD-3), prompt patterns inspired by AIHawk, and architecture from workday-copilot.

## Foundation
- **Fork base**: `research/repos/JobMatchAI/` (vanilla JS, Manifest V3, multi-platform)
- **Workday handlers**: `research/repos/job_app_filler/` (TypeScript, 12+ field types)
- **Prompt patterns**: `research/repos/Jobs_Applier_AI_Agent_AIHawk/` (AGPL — study only, reimplement independently)
- **Architecture ref**: `research/repos/workday-copilot/` (WXT + React + TS)

## Tech Stack
- **Extension**: Vanilla JS, Manifest V3, Shadow DOM panel, no build step
- **Backend**: Supabase (Auth, PostgreSQL + RLS, Storage, Edge Functions)
- **LLM Backend**: Groq Llama 3.3 70B (primary) → Gemini 2.0 Flash (fallback) via Edge Function
- **LLM Local**: 10+ providers via aiService.js abstraction (default: Claude Sonnet 4)
- **Validation**: Zod (planned for Week 2+ TypeScript migration)

## Key Architecture
- All backend LLM calls go through Supabase Edge Functions — NEVER from the extension directly
- **JD digest pipeline**: Raw JD → one AI call → structured digest (~500 tokens) → cached per URL → reused by all operations
- **Profile slicing**: `sliceProfileForOperation()` sends only relevant profile fields per operation
- **Deterministic matcher**: 30+ field types handled without AI (name, email, EEO, yes/no, URLs)
- **Server-side cache**: `jd_cache` table caches AI responses per user/JD/operation (7-day TTL)
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
Phase 5b complete (2026-04-01). All features working: Job Analysis, Ask AI Chat, Cover Letter, ATS Resume, Autofill, Interview Prep (timed practice, AI scoring, follow-ups, analytics, report). Edge Function: Gemini (primary) → Groq (fallback), deployed with `--no-verify-jwt`. JD expansion clicks "Show more" on LinkedIn/Workday/Indeed. Digest saved with jobs as `jdDigest` for reliable offline access. 9 configurable prompts, 5 token budget sliders. Next: Phase 6 — WXT migration, billing, Workday handlers. See PROJECT-CONTEXT.md for full status.
