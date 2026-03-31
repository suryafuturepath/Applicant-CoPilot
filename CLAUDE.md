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

## Repositories
- **GitHub**: https://github.com/suryafuturepath/Applicant-CoPilot

## Current Phase
Phase 4.5 complete. Key additions since Phase 3: Ask AI chat tab (in-panel, per-URL persistence), ATS Resume redesign (2-phase build→result, full preview tab), 8 configurable system prompts in AI Settings, token budget sliders, Home nav tab. Next: Phase 5 — Ship & Scale (admin prompt management, WXT migration, billing). See PROJECT-CONTEXT.md for full status.
