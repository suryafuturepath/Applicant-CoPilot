# Applicant Copilot

A Chrome extension copilot that helps job applicants craft authentic, tailored responses using their deeply captured experience and the target job's context.

**Not auto-apply** — a copilot that works *with* you.

## What it does

- **Job Analysis** — Match score, skill gaps, and insights against any job description
- **AI Coach Chat** — In-panel AI chat with full context (your profile + JD + analysis)
- **Cover Letter** — Tailored 4-paragraph cover letter, one click to copy
- **ATS Resume** — Job-tailored resume with keyword optimization and instruction chips
- **Autofill** — AI-drafted answers for application form fields + deterministic matching (30+ field types)
- **Interview Prep** — Timed practice questions, AI scoring (1-10), adaptive follow-ups, analytics dashboard, full-page report
- **Job Tracker** — Full pipeline: Saved → Applied → Interview → Offer → Rejected → Withdrawn, with filter tabs
- **Auto-Scan** — Ambient match score widget on job pages (no click required)
- **Smart Extraction** — Auto-expands and extracts full JDs from LinkedIn, Workday, Greenhouse, Lever, Indeed + any site via text-density fallback

## How it works

1. Upload your resume — the extension builds a rich experience profile
2. Complete the guided intake flow — career goals, highlights, preferences
3. Navigate to any job posting — the extension extracts the JD automatically
4. Click **Analyze Job** — get a match score, skill gap analysis, and tailored insights
5. Use any tool: cover letter, resume, chat, interview prep — all tailored to *this* job + *your* profile

## Setup

See [SETUP-GUIDE.md](SETUP-GUIDE.md) for detailed instructions.

**Quick start:**
1. Clone this repo
2. Go to `chrome://extensions` → Enable Developer Mode → Load Unpacked → select the `extension/` folder
3. Get an API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (Gemini, free tier)
4. Open the extension → AI Settings → paste your API key → Save

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Extension** | Vanilla JS, Manifest V3, Shadow DOM panel, modular ESM (`src/`) |
| **Backend** | Supabase (Auth, PostgreSQL + RLS, Edge Functions) |
| **AI** | Gemini 2.0 Flash (primary) + Groq Llama 3.3 70B (fallback), 10+ local provider options |
| **Design** | "Organic Archive" sage design system, Manrope font, Material Symbols icons |

## Architecture

The extension injects a Shadow DOM side panel on any page with three tabs: **Analysis**, **Coaching**, and **Saved Jobs**. A separate full-page profile UI (`profile.html`) provides three sections via left sidebar navigation: **User Context**, **My Jobs**, and **AI Settings**.

Content script modules live under `extension/src/` — organized by domain:
- `panel/` — Shadow DOM panel UI (HTML, CSS, events, toggle button)
- `features/` — Feature logic (analysis, chat, resume, cover letter, interview prep, save/apply)
- `autofill/` — Form detection and fill pipeline
- `auto-scan/` — Ambient keyword matching and score widget
- `platform/` — Platform-specific JD extraction (LinkedIn, Workday, Greenhouse, etc.)
- `storage/` — Local caching (analysis results, job notes)

All backend AI calls route through a Supabase Edge Function — never directly from the extension.

## Project Status

**Phase 9 complete** (2026-04-11). All core features working end-to-end. See [PROJECT-CONTEXT.md](PROJECT-CONTEXT.md) for full development history.

## License

MIT — see [LICENSE](LICENSE)
