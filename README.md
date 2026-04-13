# Applicant Copilot

> Your AI copilot for job applications — not auto-apply, a *copilot* that works with you.

A Chrome extension (Manifest V3) that helps job applicants craft authentic, tailored applications. It sits alongside job listing pages, extracts the full JD, and uses your captured experience profile to produce analyses, cover letters, ATS-optimized resumes, form answers, and interview practice — all grounded in your own material.

## What it does

- **Job Analysis** — Match score, skill gaps, insights, and ATS keywords against any JD
- **AI Coach Chat** — In-panel chat with full context (your profile + JD + analysis); per-URL history
- **Cover Letter** — Tailored 4-paragraph letter, 400–500 words, one click to copy
- **ATS Resume** — Two-phase build (instruction chips → formatted preview with PDF download)
- **Autofill** — Two-tier form fill: deterministic matcher for 30+ common field types, AI for the rest
- **Interview Prep** — Timed practice, AI scoring (1-10), adaptive follow-ups, analytics, positioning advice
- **Job Tracker** — Full pipeline: Saved → Applied → Interview → Offer → Rejected → Withdrawn, with filter tabs and per-job status dropdowns
- **Auto-Scan Widget** — Ambient match score on job pages (no click required, zero AI tokens)
- **LinkedIn Import** — Multi-page scraper that pulls Experience, Education, Skills, Certifications, Projects from your own LinkedIn profile
- **Smart JD Extraction** — Auto-expands "Show more" and extracts the full JD from LinkedIn, Workday, Greenhouse, Lever, Indeed, Glassdoor — and any site via a text-density fallback

## How it works

1. Upload your resume (PDF or DOCX) — or import from LinkedIn — the extension builds a structured profile.
2. Navigate to any job posting — the extension extracts the JD automatically.
3. Click **Analyze Job** — get a match score, skill-gap analysis, and tailored insights.
4. Use any tool: cover letter, ATS resume, chat, autofill, interview prep — everything is tailored to *this* job and *your* profile.
5. Track the full pipeline in **My Jobs** and practice with **Interview Prep** before your interviews.

## Setup

See [SETUP-GUIDE.md](SETUP-GUIDE.md) for detailed instructions (~30 minutes for full local setup).

**Quick start (no setup, your own API key):**

1. Clone this repo
2. Open `chrome://extensions` → enable Developer Mode → **Load unpacked** → select the `extension/` folder
3. Get a Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free tier is generous)
4. Open the extension → AI Settings → paste your API key → Save
5. Navigate to any job posting and click Analyze Job

For signed-in mode (backed by Supabase Edge Functions, no personal API key required), follow the full SETUP-GUIDE.

## Tech stack

| Layer | Technology |
|---|---|
| Extension | Vanilla JS, Manifest V3, Shadow DOM panel, modular ESM (`src/`), esbuild bundler |
| Backend | Supabase (Auth, PostgreSQL + RLS, Edge Functions, Storage) |
| Backend AI | Gemini 2.0 Flash (primary) + Groq Llama 3.3 70B (fallback) via Deno Edge Function |
| Local AI | 10+ providers: Gemini, Groq, OpenAI, Anthropic, Mistral, DeepSeek, Together, OpenRouter, Cohere, Cerebras |
| Document parsing | pdf.js (WASM), mammoth.js |
| Design | "Organic Archive" sage design system, Manrope font, Material Symbols icons |

## Architecture

The extension injects a Shadow DOM side panel on any page with three bottom tabs: **Analysis** (job analysis + cover letter + ATS resume + autofill), **Coaching** (AI chat), and **Saved** (the job pipeline). A separate full-page UI (`profile.html`) provides three sections via left sidebar navigation: **User Context** (profile + LinkedIn import), **My Jobs** (full pipeline tracker with interview prep), and **AI Settings**.

Content-script modules live under `extension/src/`, organized by domain:

- `panel/` — Shadow DOM panel UI (HTML, CSS, events, toggle button)
- `features/` — Feature logic (analysis, chat, resume, cover letter, interview prep, save/apply)
- `autofill/` — Form detection and fill pipeline
- `auto-scan/` — Ambient keyword matching and score widget
- `platform/` — Platform-specific JD extraction (LinkedIn, Workday, Greenhouse, Lever, Indeed, generic)
- `storage/` — Local caching (analysis results, job notes)

All backend AI calls route through a single Supabase Edge Function — never directly from the extension.

See [PROJECT-CONTEXT.md](PROJECT-CONTEXT.md) for the full repository map and [docs/FSD-Applicant-Copilot.md](docs/FSD-Applicant-Copilot.md) for the functional specification.

## Privacy

- **Local-first.** All core features work without any server communication if you bring your own API key.
- **Explicit consent.** Aggregate data collection (JD intelligence + activity metrics) is opt-in only.
- **Minimal collection.** The backend never stores raw resumes — only structured digests and token metrics.
- **User ownership.** Row-Level Security ensures you can only see your own data.
- **No third-party tracking.** No analytics or telemetry to anyone but your own Supabase project.

## Project status

**Phase 9.6 complete** (2026-04-12). All core features working end-to-end. Currently preparing for Chrome Web Store submission. See [PROJECT-CONTEXT.md](PROJECT-CONTEXT.md) for the full development history and roadmap.

## License

MIT — see [LICENSE](LICENSE).

## Repository

https://github.com/suryafuturepath/Applicant-CoPilot
