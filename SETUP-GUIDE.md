# Applicant Copilot — Setup Guide (MVP v2)

Step-by-step guide to set up Applicant Copilot on your own machine with your own Supabase backend, Google OAuth, and LLM providers.

**Version:** 0.2.0 (Phase 4.5)
**Time required:** ~30 minutes
**Prerequisites:** Chrome browser, a Google account, Supabase CLI (see step 3)

---

## Table of Contents

1. [Clone the Repository](#1-clone-the-repository)
2. [Create a Supabase Project](#2-create-a-supabase-project)
3. [Install the Supabase CLI](#3-install-the-supabase-cli)
4. [Link and Push Database Schema](#4-link-and-push-database-schema)
5. [Create the Resume Storage Bucket](#5-create-the-resume-storage-bucket)
6. [Get LLM API Keys](#6-get-llm-api-keys)
7. [Deploy the Edge Function](#7-deploy-the-edge-function)
8. [Set Up Google OAuth](#8-set-up-google-oauth)
9. [Configure Supabase Auth](#9-configure-supabase-auth)
10. [Configure the Extension](#10-configure-the-extension)
11. [Load the Extension in Chrome](#11-load-the-extension-in-chrome)
12. [Test the Setup](#12-test-the-setup)
13. [Post-Install: Configurable Prompts & Token Controls](#13-post-install-configurable-prompts--token-controls)
14. [Troubleshooting](#troubleshooting)
15. [Architecture Reference](#architecture-reference)

---

## 1. Clone the Repository

```bash
git clone https://github.com/suryafuturepath/Applicant-CoPilot.git
cd Applicant-CoPilot
```

**If using the MVP v2 zip** instead of git:
```bash
unzip Applicant-Copilot-MVP-v2.zip -d Applicant-CoPilot
cd Applicant-CoPilot
```

---

## 2. Create a Supabase Project

1. Go to https://supabase.com and sign up (free tier is fine)
2. Click **"New Project"**
3. Fill in:
   - **Organization:** Create one or select existing
   - **Project name:** `applicant-copilot` (or any name you like)
   - **Database password:** Click "Generate a password" — **save this somewhere safe**
   - **Region:** Pick the one closest to you (e.g., `us-east-1`)
   - **Plan:** Free
4. Click **"Create new project"** and wait ~2 minutes for it to provision

### Save these values (you'll need them later):

Once the project is ready, go to **Settings → API** and copy:

| Value | Where to find it | Example |
|-------|-----------------|---------|
| **Project URL** | Settings → API → Project URL | `https://abcdefghijk.supabase.co` |
| **Anon Key** | Settings → API → `anon` `public` key | `eyJhbGciOiJI...` |
| **Service Role Key** | Settings → API → `service_role` key | `eyJhbGciOiJI...` (keep this secret!) |
| **Project Ref** | The random string in your project URL | `abcdefghijk` |

---

## 3. Install the Supabase CLI

**macOS (Homebrew):**
```bash
brew install supabase/tap/supabase
```

**Windows (Scoop):**
```bash
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase
```

**npm (any platform):**
```bash
npm install -g supabase
```

Verify it's installed:
```bash
supabase --version
```

Then log in:
```bash
supabase login
```
This opens your browser — authorize the CLI with your Supabase account.

---

## 4. Link and Push Database Schema

Link your local project to your remote Supabase project:

```bash
supabase link --project-ref <YOUR_PROJECT_REF>
```

It will ask for your database password (the one you saved in step 2).

Now push the database schema (creates all tables, RLS policies, and triggers):

```bash
supabase db push
```

You should see:
```
Applying migration 20260326085609_initial_schema.sql...
Applying migration 20260326085851_storage_policies.sql...
Applying migration 20260327100841_add_resume_generation_action_type.sql...
Applying migration 20260331120000_add_jd_cache_and_digest_action.sql...
Finished supabase db push.
```

### What this creates:

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (name, email, skills, resume data) |
| `experiences` | Work experience entries linked to profiles |
| `applications` | Job applications the user is tracking |
| `generated_answers` | AI-generated answers for application questions |
| `usage_logs` | Token usage tracking for every AI call |
| `jd_cache` | Server-side JD digest and response cache (7-day TTL) |

All tables have **Row Level Security (RLS)** — users can only see their own data.

### Triggers:
- `handle_updated_at` — Auto-updates `updated_at` on profiles, experiences, applications, generated_answers
- `handle_new_user` — Auto-creates a profile row when a new auth user signs up

---

## 5. Create the Resume Storage Bucket

This step must be done manually in the Supabase Dashboard:

1. Go to Supabase Dashboard → **Storage**
2. Click **"New Bucket"**
3. Settings:
   - Name: `resumes`
   - Public: **No** (toggle off)
   - File size limit: `10485760` (10 MB)
   - Allowed MIME types: `application/pdf`
4. Click **"Create bucket"**

---

## 6. Get LLM API Keys

The backend Edge Function uses **Groq** (primary, free tier) with **Gemini Flash** as fallback. You need at least one.

### A. Groq API Key (Primary — recommended)

1. Go to https://console.groq.com/keys
2. Sign up / sign in
3. Click **"Create API Key"**
4. Copy the key

```bash
supabase secrets set GROQ_API_KEY="<YOUR_GROQ_API_KEY>"
```

**Why Groq?** Free tier with 6,000 requests/day, Llama 3.3 70B model, ~200ms latency.

### B. Gemini API Key (Fallback — optional but recommended)

1. Go to https://aistudio.google.com/apikey
2. Click **"Create API Key"**
3. Select your Google Cloud project (or create one)
4. Copy the API key

```bash
supabase secrets set GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
```

### C. Local AI Provider Key (Optional — for offline/signed-out use)

The extension supports 10+ local AI providers for use without the backend. You can configure these later in the extension's AI Settings tab. Supported providers:

| Provider | Model | Free Tier |
|----------|-------|-----------|
| Google Gemini | Gemini 2.0 Flash | Yes (generous) |
| Groq | Llama 3.3 70B | Yes (6K req/day) |
| Cerebras | Llama 3.3 70B | Yes |
| Anthropic | Claude Sonnet 4 (default) | No |
| OpenAI | GPT-4o | No |
| Mistral | Mistral Large | No |
| DeepSeek | DeepSeek Chat | Yes (limited) |
| Together | Various | Yes (limited) |
| OpenRouter | Various | Pay-per-use |
| Cohere | Command R+ | Yes (limited) |

Verify secrets are set:
```bash
supabase secrets list
```
Should show `GROQ_API_KEY` and optionally `GEMINI_API_KEY` in the list.

---

## 7. Deploy the Edge Function

```bash
supabase functions deploy generate-answer
```

You should see:
```
Deployed Functions on project <your-ref>: generate-answer
```

### Verify it's running:

Go to Supabase Dashboard → **Edge Functions** — you should see `generate-answer` with status "Active".

### What the Edge Function does:

- Receives AI requests from signed-in users
- Routes to **Groq** (primary) → **Gemini Flash** (fallback)
- Rate limits: 50 requests/user/hour
- Logs all token usage to `usage_logs` table
- Caches responses in `jd_cache` table (7-day TTL, SHA-256 keyed)
- Supports action types: `answer_generation`, `cover_letter`, `resume`, `resume_generation`, `jd_digest`, `chat`, `classification`
- Accepts custom `max_tokens` (up to 16,384) per request

---

## 8. Set Up Google OAuth

This lets users sign in with their Google account.

### A. Create Google Cloud OAuth Credentials

1. Go to https://console.cloud.google.com
2. Select your project (or create a new one called `applicant-copilot`)
3. Go to **APIs & Services → OAuth consent screen** (may be under "Google Auth Platform → Branding")
   - User type: **External**
   - App name: `Applicant Copilot`
   - User support email: your email
   - Developer contact email: your email
   - Click **Save**
4. Go to **Audience** (or "OAuth consent screen → Test users")
   - Click **"Add users"**
   - Add your email address (required while app is in "Testing" status)
5. Go to **APIs & Services → Credentials**
   - Click **"Create Credentials" → "OAuth 2.0 Client ID"**
   - Application type: **Web application**
   - Name: `Applicant Copilot`
   - Authorized redirect URIs: Add this exact URL:
     ```
     https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
     ```
     (Replace `<YOUR_PROJECT_REF>` with your actual project ref)
   - Click **"Create"**
6. **Copy the Client ID and Client Secret** — you'll need them in the next step

### B. Add Authorized Domain

Still in Google Cloud Console:
1. Go to **Branding** (or OAuth consent screen)
2. Under **Authorized domains**, add:
   ```
   <YOUR_PROJECT_REF>.supabase.co
   ```
3. Click **Save**

---

## 9. Configure Supabase Auth

### A. Enable Google Provider

1. Go to Supabase Dashboard → **Authentication → Sign In / Providers**
2. Click on **Google**
3. **Toggle "Enable Sign in with Google" → ON**
4. Paste your **Client ID** from step 8
5. Paste your **Client Secret** from step 8
6. Click **Save**

### B. Set Redirect URLs

1. Go to **Authentication → URL Configuration**
2. **Site URL:** Set to `chrome-extension://<YOUR_EXTENSION_ID>`
   (You'll get this ID in step 11 — come back and set it after loading the extension)
3. **Redirect URLs:** Click "Add URL" and add:
   ```
   https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
   ```
4. Click **Save**

---

## 10. Configure the Extension

If you created your **own Supabase project** (step 2), update the extension to point to it. If you're using the shared/default project, skip to step 11.

### A. Update Supabase URL and Anon Key

Open `extension/supabase-client.js` and update lines 16-17:

```js
export const SUPABASE_URL = 'https://<YOUR_PROJECT_REF>.supabase.co';
const SUPABASE_ANON_KEY = '<YOUR_ANON_KEY>';
```

Replace `<YOUR_PROJECT_REF>` with your project ref and `<YOUR_ANON_KEY>` with your anon key from step 2.

> **Note:** The anon key is safe to put in the extension code — it's a public key that only grants access through RLS policies.

### B. CORS (no action needed)

The Edge Function already handles CORS dynamically — it accepts requests from any `chrome-extension://` origin and any `*.supabase.co` domain. No manual CORS configuration is required.

---

## 11. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **"Developer mode"** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `extension/` folder inside the cloned repo
5. The extension should appear with its icon
6. **Copy the Extension ID** — it's the long string shown on the extension card (e.g., `khidbpecgknkokppgjaopamgglcmbkgd`)

### Now go back and set the Site URL:

1. Go to Supabase Dashboard → **Authentication → URL Configuration**
2. Set **Site URL** to:
   ```
   chrome-extension://<YOUR_EXTENSION_ID>
   ```
3. Click **Save**

---

## 12. Test the Setup

Run through these tests in order. If any fail, check [Troubleshooting](#troubleshooting).

### Test 1: Extension Loads
- Go to any job posting on LinkedIn — you should see a floating button in the bottom-right corner
- Click it to open the side panel
- You should see the **Home** tab with navigation: Home | Ask AI | Saved | Profile | Settings

### Test 2: Profile Page
- Open `chrome-extension://<YOUR_EXTENSION_ID>/profile.html`
- You should see the profile page with tabs and a "Sign in" button
- Try uploading a resume (PDF or DOCX) — it should parse and populate fields

### Test 3: AI Without Sign-in (Local Mode)
- In the side panel, go to **Settings** tab
- Select a provider (e.g., "Google Gemini") and paste your API key
- Click "Test Connection" — should show success
- Click "Save Settings"
- Navigate to a LinkedIn job posting, open the panel, click "Analyze Job"
- You should see a match score and analysis

### Test 4: Google Sign-in
- On the profile page, click **"Sign in"**
- Google consent screen opens — select your account
- Profile page should show your name and "Sign out" button
- Go to Supabase Dashboard → **Authentication → Users** — your account should appear
- Go to **Table Editor → profiles** — your profile row should exist

### Test 5: Backend AI (Signed In)
- While signed in, analyze a job on LinkedIn
- Go to Supabase Dashboard → **Table Editor → usage_logs** — a new row should appear
- Check **Table Editor → jd_cache** — a cached JD digest entry should appear

### Test 6: Ask AI Chat
- On a job posting, open the panel → **Ask AI** tab
- Type a question like "Am I a good fit for this role?" or click a suggestion chip
- You should get a contextual AI response using the JD + your profile
- Close and reopen the panel — chat history should persist (per URL)

### Test 7: ATS Resume Generator
- On a job posting, open the panel → scroll to the **Resume** section on the Home tab
- Select instruction chips (e.g., Leadership, Match JD, Fit 1 Page)
- Click "Generate" — a mini preview should appear
- Click "Open Full Preview" — a new tab opens with the formatted resume
- Test "Copy Text" and "Download PDF" buttons in the action bar

### Test 8: Cover Letter
- On a job posting, click **Generate Cover Letter**
- Should produce a 400-500 word, 4-paragraph tailored cover letter
- Test the copy button

If all 8 tests pass, your MVP v2 setup is complete.

---

## 13. Post-Install: Configurable Prompts & Token Controls

MVP v2 includes user-configurable AI prompts and token budget controls.

### Configurable Prompts

Go to **Settings → AI Settings** (scroll down to "System Prompts"):

| Prompt | Controls |
|--------|----------|
| Resume Generation | System prompt for ATS resume building |
| Cover Letter | System prompt for cover letter generation |
| Chat | System prompt for Ask AI conversations |
| Job Analysis | System prompt for job match analysis |
| Autofill | System prompt for form field answer generation |
| Resume Parse | System prompt for resume PDF/DOCX parsing |
| JD Digest | System prompt for JD extraction and structuring |
| Edge System | Default system prompt sent to the backend Edge Function |

Each prompt section shows:
- A collapsible textarea with monospace font
- A **"Modified"** badge when the prompt differs from the default
- A **"Reset to default"** button per section
- A global **"Reset All Prompts"** button at the bottom

### Token Budget Controls

Four sliders in AI Settings control the maximum output tokens per operation:

| Operation | Range | Default |
|-----------|-------|---------|
| Resume | 2,048 – 16,384 | 8,192 |
| Analysis | 1,024 – 8,192 | 4,096 |
| Cover Letter | 512 – 4,096 | 2,048 |
| Chat | 256 – 2,048 | 1,024 |

Higher token budgets produce more detailed output but use more of your LLM quota.

---

## Troubleshooting

### "redirect_uri_mismatch" error during Google sign-in
The redirect URI in Google Cloud Console doesn't match exactly. Go to **Credentials → your OAuth client → Authorized redirect URIs** and make sure it's exactly:
```
https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
```
No trailing slash, no typos.

### "Access blocked: This app's request is invalid" during sign-in
Your Google OAuth consent screen is in "Testing" mode but your email isn't listed as a test user. Go to **Google Cloud Console → Audience → Add users** and add your email.

### OAuth tab shows "blocked by Chrome" after authorizing
This means the OAuth worked but the redirect to `chrome-extension://` was blocked. Reload the extension (`chrome://extensions` → refresh icon), then try signing in again. The background script needs to be running to intercept the redirect.

### "Extension context invalidated" error
This happens when you reload the extension while a tab has the old content script. Close the tab and open a new one — the error is harmless.

### "No API key configured" when analyzing a job
Either:
- Sign in with Google (uses the backend — no API key needed), or
- Go to Settings → AI Settings → enter your API key for a provider and save

### Edge Function returns 500
Check that your LLM API key secrets are set:
```bash
supabase secrets list
```
If `GROQ_API_KEY` is missing, set it:
```bash
supabase secrets set GROQ_API_KEY="<your-key>"
```
If both Groq and Gemini keys are missing, the Edge Function has no LLM provider to call.

### JD extraction returns empty or garbage text
The extension tries platform-specific selectors first (LinkedIn, Workday, Greenhouse, Lever, Indeed), then falls back to a text-density algorithm. If extraction fails:
- Make sure the job description is fully loaded before opening the panel
- Try scrolling down to load lazy content, then click "Analyze Job" again

### Ask AI chat not responding
- Check that you're on a page with a job description (the chat needs JD context)
- Check the browser console (`F12 → Console`) for error messages
- If signed in, check that the Edge Function is deployed and active
- If using a local API key, verify it works via "Test Connection" in AI Settings

### Tables don't exist / migration errors
Re-run the migrations:
```bash
supabase db push
```
If a migration fails, check the error message. Common issue: the migration was partially applied. Use:
```bash
supabase migration list
```
To see which migrations were applied, then:
```bash
supabase migration repair <timestamp> --status reverted
supabase db push
```

### Extension ID changes after reload
Unpacked extensions can change IDs when reloaded. To pin the ID, add a `key` field to `extension/manifest.json`. For development this doesn't matter — just update the Site URL in Supabase when it changes.

### Token budget changes not taking effect
After adjusting token sliders in AI Settings, click **"Save Settings"**. The new budgets apply to the next AI request. Previously cached responses (in `jd_cache`) use the old token count — wait for cache expiry (7 days) or clear the cache manually in Supabase Dashboard → Table Editor → `jd_cache`.

---

## Architecture Reference

### System Diagram

```
Chrome Extension (your browser)
  ├── Local AI providers (user's own API key — 10+ supported)
  ├── Supabase URL + Anon Key (supabase-client.js)
  ├── Shadow DOM side panel (5 tabs: Home, Ask AI, Saved, Profile, Settings)
  ├── Deterministic matcher (30+ field types, zero AI tokens)
  ├── JD digest cache (chrome.storage.local, per URL, 7-day TTL)
  ├── Chat persistence (chrome.storage.local, 50 msgs/chat, 20 chats max, LRU eviction)
  ├── 8 configurable system prompts (chrome.storage.local)
  ├── 4 token budget sliders (chrome.storage.local)
  └── Signs in via Google OAuth

Supabase Project (cloud)
  ├── Auth: Google OAuth provider enabled
  ├── Database: 6 tables with RLS
  │   ├── profiles, experiences, applications
  │   ├── generated_answers, usage_logs
  │   └── jd_cache (server-side response cache, 7-day TTL)
  ├── Storage: "resumes" bucket (private, 10 MB, PDF only)
  ├── Edge Function: generate-answer
  │   ├── Groq Llama 3.3 70B (primary, free)
  │   ├── Gemini 2.0 Flash (fallback, free)
  │   ├── Rate limit: 50 req/user/hour
  │   ├── Max tokens: up to 16,384 per request
  │   └── Server-side caching via jd_cache
  └── Secrets: GROQ_API_KEY, GEMINI_API_KEY

Google Cloud Project
  ├── OAuth consent screen (Testing mode)
  ├── OAuth 2.0 Client ID + Secret
  └── Redirect URI → Supabase callback URL
```

### Token Optimization Pipeline

```
User clicks "Analyze Job"
  → extractJobDescription()
      Stage 1: Platform selectors (LinkedIn, Workday, Indeed, Greenhouse, Lever)
      Stage 2: Text-density algorithm (fallback for unknown ATS)
  → handleDigestJD(rawJD, title, company, url)
      → Check cache (keyed by URL, 7-day TTL)
      → If miss: ONE AI call → structured JD digest (~500 tokens)
      → Cache result for all downstream operations
  → handleAnalyzeJob(digest, title, company, url)
      → sliceProfileForOperation(profile, 'analysis') → only titles + skills
      → Pass digest (not raw JD) + sliced profile to AI
  → Subsequent operations (cover letter, resume, chat) reuse cached digest
```

**Projected savings:** ~70% reduction vs. sending full JD + full profile each time.

### File Map

```
extension/
├── manifest.json             # MV3 config (v0.2.0)
├── background.js             # Service worker: message router, AI handlers, auth
├── content.js                # Content script: Shadow DOM panel, JD extraction, autofill
├── aiService.js              # 10+ provider abstraction, prompt builders, callAI()
├── deterministicMatcher.js   # Rule-based field matcher (30+ types, zero tokens)
├── supabase-client.js        # Singleton Supabase client, session persistence
├── profile.html / profile.js # Full-page profile and settings UI
├── styles.css                # Content script styles
├── icons/                    # Extension icons (16, 48, 128 px)
└── libs/                     # Vendored: pdf.js, mammoth.js, supabase-bundle

supabase/
├── config.toml               # Supabase CLI configuration
├── migrations/               # 4 SQL migrations (schema + RLS + triggers)
└── functions/
    └── generate-answer/
        └── index.ts           # Edge Function (Deno/TypeScript)
```

---

## Quick Reference: Commands

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Login
supabase login

# Link to your project
supabase link --project-ref <REF>

# Push database schema
supabase db push

# Set secrets
supabase secrets set GROQ_API_KEY="<key>"
supabase secrets set GEMINI_API_KEY="<key>"

# Deploy edge function
supabase functions deploy generate-answer

# Check status
supabase migration list
supabase secrets list
supabase functions list

# View Edge Function logs
supabase functions logs generate-answer
```
