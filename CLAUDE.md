# Applicant Copilot — Claude Code Instructions

## Project Overview
Chrome extension copilot for job applicants. Forked from JobMatchAI (MIT), enhanced with Workday handlers from job_app_filler (BSD-3), prompt patterns inspired by AIHawk, and architecture from workday-copilot.

## Foundation
- **Fork base**: `research/repos/JobMatchAI/` (vanilla JS, Manifest V3, multi-platform)
- **Workday handlers**: `research/repos/job_app_filler/` (TypeScript, 12+ field types)
- **Prompt patterns**: `research/repos/Jobs_Applier_AI_Agent_AIHawk/` (AGPL — study only, reimplement independently)
- **Architecture ref**: `research/repos/workday-copilot/` (WXT + React + TS)

## Tech Stack
- **Extension (Week 1)**: JobMatchAI fork (vanilla JS, Manifest V3, no build step)
- **Extension (Week 2+)**: WXT + React 19 + Tailwind CSS 4 + TypeScript + Zustand
- **Backend**: Supabase (Auth, PostgreSQL, Storage, Edge Functions)
- **LLM**: Gemini Flash (free tier) via Supabase Edge Functions; model-agnostic design for future upgrade to Claude
- **Validation**: Zod for all external data

## Key Rules
- All LLM calls go through Supabase Edge Functions — NEVER from the extension directly
- Prompts live in dedicated files under `lib/prompts/`
- Log all token usage for billing
- Do NOT copy code from AIHawk (AGPL) — study patterns, reimplement independently
- Code from JobMatchAI (MIT) and job_app_filler (BSD-3) can be used freely

## Platform Priority
1. LinkedIn Easy Apply (P0)
2. Workday (P0)
3. Greenhouse / Lever (P1)
4. Indeed / Glassdoor (P2)

## File Naming
- Files: `kebab-case.ts` (or `.js` during Week 1)
- Components: `PascalCase.tsx`
- Database columns: `snake_case`

## Git
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Feature branches: `feat/description`

## Repositories
- **GitHub**: https://github.com/suryafuturepath/Applicant-CoPilot (github)

## Current Phase
Phase 3 complete (extension connected to backend, all AI calls proxy through Edge Functions, ATS resume generator, code quality pass). Next: Phase 4 — Polish & Ship. See PROJECT-CONTEXT.md for full status.
