# Applicant Copilot

A Chrome extension copilot that helps job applicants craft authentic, tailored responses using their deeply captured experience and the target job's context.

**Not auto-apply** — a copilot that works *with* you.

## What it does

- **Job Analysis** — Match score, skill gaps, and insights against any job description
- **Ask AI Chat** — In-panel AI chat with full context (your profile + JD + analysis)
- **Cover Letter** — Tailored 4-paragraph cover letter, one click to copy
- **ATS Resume** — Job-tailored resume with keyword optimization, PDF download
- **Autofill** — AI-drafted answers for application form fields
- **Interview Prep** — Timed practice questions, AI scoring (1-10), adaptive follow-ups, analytics dashboard
- **Smart Extraction** — Auto-expands and extracts full JDs from LinkedIn, Workday, Greenhouse, Lever, Indeed + any site via text-density fallback

## How it works

1. Upload your resume — the extension builds a rich experience profile
2. Navigate to any job posting — the extension extracts the JD automatically
3. Click **Analyze Job** — get a match score, skill gap analysis, and tailored insights
4. Use any tool: cover letter, resume, chat, interview prep — all tailored to *this* job + *your* profile

## Setup

See [SETUP-GUIDE.md](SETUP-GUIDE.md) for detailed instructions.

**Quick start:**
1. Clone this repo
2. Go to `chrome://extensions` → Enable Developer Mode → Load Unpacked → select the `extension/` folder
3. Get an API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (Gemini, free tier)
4. Open the extension → Settings → paste your API key → Save

## Tech Stack

- **Extension**: Vanilla JS, Manifest V3, Shadow DOM panel
- **Backend**: Supabase (Auth, PostgreSQL + RLS, Edge Functions)
- **AI**: Gemini 2.0 Flash (primary) + Groq Llama 3.3 70B (fallback), 10+ local provider options

## License

MIT — see [LICENSE](LICENSE)
