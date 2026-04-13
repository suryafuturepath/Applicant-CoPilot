# Applicant Copilot — Setup Guide

End-to-end guide to running Applicant Copilot locally with your own Supabase backend, Google OAuth, and LLM providers.

**Version:** 1.0.0 (Phase 9.6)
**Time required:** ~30 minutes
**Prerequisites:** Chrome, a Google account, a Supabase account, the Supabase CLI

---

## Table of contents

1. [Clone the repo](#1-clone-the-repo)
2. [Create a Supabase project](#2-create-a-supabase-project)
3. [Install the Supabase CLI](#3-install-the-supabase-cli)
4. [Push the database schema](#4-push-the-database-schema)
5. [Create the resume storage bucket](#5-create-the-resume-storage-bucket)
6. [Get LLM API keys](#6-get-llm-api-keys)
7. [Deploy the Edge Function](#7-deploy-the-edge-function)
8. [Set up Google OAuth](#8-set-up-google-oauth)
9. [Configure Supabase Auth](#9-configure-supabase-auth)
10. [Configure the extension](#10-configure-the-extension)
11. [Load the extension in Chrome](#11-load-the-extension-in-chrome)
12. [Smoke test](#12-smoke-test)
13. [Troubleshooting](#troubleshooting)
14. [Quick command reference](#quick-command-reference)

---

## 1. Clone the repo

```bash
git clone https://github.com/suryafuturepath/Applicant-CoPilot.git
cd Applicant-CoPilot
```

---

## 2. Create a Supabase project

1. Sign in at https://supabase.com and click **New Project**.
2. Fill in:
   - **Project name:** `applicant-copilot` (or any name you like)
   - **Database password:** generate one and **save it somewhere safe**
   - **Region:** pick the one closest to you
   - **Plan:** Free
3. Click **Create new project** and wait ~2 minutes for provisioning.

Then go to **Settings → API** and copy these values — you'll need them later:

| Value | Where to find it |
|---|---|
| Project URL | Settings → API → Project URL (e.g. `https://abcdefghijk.supabase.co`) |
| Anon key | Settings → API → `anon` `public` key |
| Service role key | Settings → API → `service_role` key (keep secret!) |
| Project ref | The subdomain in your Project URL (e.g. `abcdefghijk`) |

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

Verify and log in:

```bash
supabase --version
supabase login
```

The login command opens your browser to authorize the CLI.

---

## 4. Push the database schema

Link your local repo to your Supabase project:

```bash
supabase link --project-ref <YOUR_PROJECT_REF>
```

(It will prompt for the database password from step 2.)

Push all migrations:

```bash
supabase db push
```

You should see the 6 migrations applied:

```
Applying migration 20260326085609_initial_schema.sql...
Applying migration 20260326085851_storage_policies.sql...
Applying migration 20260327100841_add_resume_generation_action_type.sql...
Applying migration 20260331120000_add_jd_cache_and_digest_action.sql...
Applying migration 20260331140000_add_interview_prep_action.sql...
Applying migration 20260401200000_add_data_collection_tables.sql...
Finished supabase db push.
```

### What this creates

| Table | Purpose |
|---|---|
| `profiles` | User identity, settings, data-consent flag |
| `experiences` | Work history linked to profiles |
| `applications` | Tracked job applications |
| `generated_answers` | AI-generated answers per application |
| `usage_logs` | Immutable token audit trail |
| `jd_cache` | Server-side AI response cache (7-day TTL) |
| `jd_intelligence` | Aggregated market data (opt-in) |
| `candidate_activity` | Aggregated engagement metrics (opt-in) |

All tables use **Row Level Security**. Triggers auto-create a profile row on signup and keep `updated_at` columns fresh.

---

## 5. Create the resume storage bucket

This step must be done manually in the Supabase Dashboard:

1. Go to **Storage** → **New bucket**.
2. Settings:
   - **Name:** `resumes`
   - **Public:** off
   - **File size limit:** `10485760` (10 MB)
   - **Allowed MIME types:** `application/pdf`
3. Click **Create bucket**.

---

## 6. Get LLM API keys

The Edge Function uses **Gemini 2.0 Flash** (primary) with **Groq Llama 3.3 70B** as fallback. You need at least one of these two. Local-mode users (signed-out, bring-your-own-key) can use any of the 10+ supported providers.

### A. Gemini API key (primary — recommended)

1. Go to https://aistudio.google.com/apikey.
2. Click **Create API Key** and pick or create a Google Cloud project.
3. Copy the key.

```bash
supabase secrets set GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
```

Gemini Flash is fast, free-tier generous (hundreds of thousands of requests/month), and the default local-mode provider too.

### B. Groq API key (fallback)

1. Go to https://console.groq.com/keys.
2. Create an API key and copy it.

```bash
supabase secrets set GROQ_API_KEY="<YOUR_GROQ_API_KEY>"
```

Groq's free tier is 6,000 requests/day with sub-second Llama 3.3 70B inference.

### C. Verify

```bash
supabase secrets list
```

You should see `GEMINI_API_KEY` and `GROQ_API_KEY` listed.

### D. Other local providers (optional)

If you want to use a different provider for local/signed-out mode, no server-side setup is needed — you'll paste the key into **AI Settings** in the extension. Supported providers: Anthropic, OpenAI, Mistral, DeepSeek, Cohere, Together, OpenRouter, Cerebras, plus Gemini and Groq.

---

## 7. Deploy the Edge Function

```bash
supabase functions deploy generate-answer --no-verify-jwt
```

> **Why `--no-verify-jwt`?** The Supabase API gateway's built-in JWT check rejects requests from Chrome extensions due to CORS-origin differences. The function validates the JWT *internally* using `supabase.auth.getUser()`, so auth is still enforced — just not at the gateway.

Verify in the Dashboard: **Edge Functions** → you should see `generate-answer` listed as **Active**.

### What the Edge Function does

- Receives AI requests from signed-in users
- Routes to **Gemini 2.0 Flash** (primary) → **Groq Llama 3.3 70B** (fallback)
- Validates JWT via `getUser()` and enforces per-user access
- Caches responses in `jd_cache` (SHA-256 keyed, 7-day TTL)
- Logs every call to `usage_logs` with token counts
- Returns structured 502 errors with `provider_errors[]` on LLM failures
- Accepts custom `max_tokens` (up to 16,384) per request

**Action types handled:** `answer_generation`, `cover_letter`, `resume`, `resume_generation`, `jd_digest`, `chat`, `classification`, `interview_prep`.

---

## 8. Set up Google OAuth

### A. Create Google Cloud OAuth credentials

1. Go to https://console.cloud.google.com and select (or create) a project.
2. Go to **APIs & Services → OAuth consent screen** (may be under **Google Auth Platform → Branding** in newer UIs):
   - **User type:** External
   - **App name:** Applicant Copilot
   - **Support email:** your email
   - **Developer contact:** your email
   - **Save**.
3. Go to **Audience → Test users** and add your Google account email. (Required while the app is in "Testing" status.)
4. Go to **APIs & Services → Credentials** → **Create Credentials → OAuth 2.0 Client ID**:
   - **Application type:** Web application
   - **Name:** Applicant Copilot
   - **Authorized redirect URIs:** add exactly:

     ```
     https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
     ```

   - **Create**, then copy the **Client ID** and **Client Secret**.

### B. Authorized domain

Still in Google Cloud Console, under **Branding** → **Authorized domains**, add:

```
<YOUR_PROJECT_REF>.supabase.co
```

Save.

---

## 9. Configure Supabase Auth

### A. Enable the Google provider

1. Supabase Dashboard → **Authentication → Sign In / Providers**.
2. Click **Google** and toggle **Enable sign in with Google** ON.
3. Paste the Client ID and Client Secret from step 8.
4. Save.

### B. Redirect URLs

1. **Authentication → URL Configuration**.
2. **Site URL:** `chrome-extension://<YOUR_EXTENSION_ID>` (you'll get this in step 11 — come back and set it then).
3. **Redirect URLs:** add:

   ```
   https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
   ```

4. Save.

---

## 10. Configure the extension

### A. Supabase URL + Anon key

Open `extension/supabase-client.js` and update the two constants:

```js
export const SUPABASE_URL = 'https://<YOUR_PROJECT_REF>.supabase.co';
const SUPABASE_ANON_KEY = '<YOUR_ANON_KEY>';
```

> The anon key is safe to ship in the extension — it's a public key that only grants access through RLS policies.

### B. CORS

No manual CORS configuration needed. The Edge Function accepts requests from any `chrome-extension://` origin and any `*.supabase.co` domain out of the box.

---

## 11. Load the extension in Chrome

1. Go to `chrome://extensions`.
2. Toggle **Developer mode** ON (top-right).
3. Click **Load unpacked** and select the `extension/` folder from the cloned repo.
4. The extension card should appear — copy the **Extension ID** (the long string on the card).

Now go back and set the Site URL in Supabase:

1. **Authentication → URL Configuration**.
2. Set **Site URL** to `chrome-extension://<YOUR_EXTENSION_ID>`.
3. Save.

---

## 12. Smoke test

Run through these in order. If anything fails, see [Troubleshooting](#troubleshooting).

### 1. Extension loads

- Go to a LinkedIn job posting — you should see the floating toggle button (bottom-right).
- Click it → the side panel opens on the right with three bottom tabs: **Analysis**, **Coaching**, **Saved**.

### 2. Profile page

- Open `chrome-extension://<YOUR_EXTENSION_ID>/profile.html`.
- Left sidebar has three sections: **User Context**, **My Jobs**, **AI Settings**.
- Drag-and-drop a PDF or DOCX resume — it should parse and populate the form.

### 3. Local AI (no sign-in)

- Profile → **AI Settings** → select **Google Gemini** → paste your Gemini API key → **Test Connection** (should pass) → **Save**.
- Go to a LinkedIn job posting → open the panel → **Analyze Job**.
- You should get a match score and analysis.

### 4. Google sign-in

- AI Settings → **Sign in with Google** → complete the OAuth flow.
- Profile shows your name; **Sign out** button appears.
- Supabase Dashboard → **Authentication → Users** — your account appears.
- **Table Editor → profiles** — your profile row exists.

### 5. Backend AI (signed in)

- Analyze a job while signed in.
- **Table Editor → usage_logs** — a new row appears with token counts.
- **Table Editor → jd_cache** — a cached digest appears for this JD.

### 6. AI Coach chat

- Open **Coaching** tab on a job page.
- Click a suggestion chip like "Am I a good fit?" or type your own question.
- Close and reopen the panel — chat history persists per URL.

### 7. ATS Resume

- Analysis tab → **ATS Resume** → toggle a few instruction chips (Leadership, Match JD Keywords, Fit 1 Page) → **Generate**.
- Mini preview appears → click **Open Full Preview** → new tab with formatted resume.
- Test **Copy Text** and **Download PDF**.

### 8. Cover Letter

- Analysis tab → **Cover Letter** → should produce a 400–500-word, 4-paragraph letter.
- Test the copy button.

### 9. Interview Prep

- Profile → **My Jobs** → click **Prep** on a saved job.
- Select categories → **Generate Questions** → 10–12 questions appear.
- Answer one — scoring dialog shows strengths, improvements, sample answer.

### 10. LinkedIn Import

- Profile → **User Context** → **Import from LinkedIn**.
- Tab switches through 5 LinkedIn detail pages; extension reports counts at the end.
- Profile form now has your experience, education, skills, certifications, projects.

If all 10 pass, your local setup is complete.

---

## Troubleshooting

### "redirect_uri_mismatch" during Google sign-in

The redirect URI in Google Cloud doesn't match Supabase's. It must be exactly:

```
https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
```

No trailing slash, no typos.

### "Access blocked: this app's request is invalid"

Your OAuth consent screen is in Testing mode and your email isn't a test user. Google Cloud → **Audience → Test users → Add users** → add your email.

### OAuth callback shows "blocked by Chrome"

The OAuth succeeded but the redirect to `chrome-extension://` was blocked. Reload the extension (`chrome://extensions` → refresh icon), then sign in again. The service worker needs to be running to intercept the redirect.

### "Extension context invalidated"

Harmless — it happens when you reload the extension while a tab holds the old content script. Close and reopen the tab.

### "No API key configured"

Either sign in with Google (uses the backend) or go to **AI Settings** and paste a local API key.

### Edge Function returns 500 or 502

Check secrets:

```bash
supabase secrets list
```

If `GEMINI_API_KEY` is missing, the function has no primary provider. Set at least one of `GEMINI_API_KEY` or `GROQ_API_KEY`. View live logs:

```bash
supabase functions logs generate-answer
```

### 502 with `provider_errors[]`

All providers failed. The response body includes per-provider failure details. Common causes: expired API key, quota exceeded, or the provider's model name changed. Check AI Settings and the provider's dashboard.

### JD extraction returns empty or garbage text

- Make sure the JD is fully loaded before clicking Analyze.
- Scroll down to load lazy content, then try again.
- The text-density fallback works on most sites but can be thrown off by heavy layout noise.

### Tables missing / migration errors

```bash
supabase migration list
```

shows which migrations were applied. If one failed partway:

```bash
supabase migration repair <timestamp> --status reverted
supabase db push
```

### Extension ID changes after reload

Unpacked extensions can get a new ID when reloaded. Either pin the ID by adding a `key` field to `extension/manifest.json`, or just re-paste the new ID into Supabase's **Site URL** when it changes.

### Token-budget changes don't take effect

After adjusting sliders in AI Settings, click **Save Settings**. New budgets apply to the next AI call. Previously cached responses use the old token count — wait for the 7-day cache expiry or clear `jd_cache` manually in the Supabase Dashboard.

### LinkedIn import partially misses items

LinkedIn throttles slow renders. The import waits for page readiness (spinners gone, scrollHeight stable for 2 rounds) but can still time out on slow networks. Re-run the import — it overwrites experience/education/projects and unions skills/certifications.

---

## Quick command reference

```bash
# CLI install & login
brew install supabase/tap/supabase
supabase login

# Link local repo to remote project
supabase link --project-ref <REF>

# Push database schema
supabase db push

# Set secrets (at least one required)
supabase secrets set GEMINI_API_KEY="<key>"
supabase secrets set GROQ_API_KEY="<key>"

# Deploy edge function
supabase functions deploy generate-answer --no-verify-jwt

# Status checks
supabase migration list
supabase secrets list
supabase functions list

# Live Edge Function logs
supabase functions logs generate-answer
```

---

For the full functional spec and architecture details, see [docs/FSD-Applicant-Copilot.md](docs/FSD-Applicant-Copilot.md) and [PROJECT-CONTEXT.md](PROJECT-CONTEXT.md).
