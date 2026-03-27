# Applicant Copilot — Local Setup Guide

Step-by-step guide to set up Applicant Copilot on your own machine with your own Supabase backend and Google OAuth.

**Time required:** ~30 minutes
**Prerequisites:** Chrome browser, a Google account, Node.js installed

---

## Table of Contents

1. [Clone the Repository](#1-clone-the-repository)
2. [Create a Supabase Project](#2-create-a-supabase-project)
3. [Install the Supabase CLI](#3-install-the-supabase-cli)
4. [Link and Push Database Schema](#4-link-and-push-database-schema)
5. [Get a Gemini API Key](#5-get-a-gemini-api-key)
6. [Deploy the Edge Function](#6-deploy-the-edge-function)
7. [Set Up Google OAuth](#7-set-up-google-oauth)
8. [Configure Supabase Auth](#8-configure-supabase-auth)
9. [Configure the Extension](#9-configure-the-extension)
10. [Load the Extension in Chrome](#10-load-the-extension-in-chrome)
11. [Test the Setup](#11-test-the-setup)
12. [Troubleshooting](#troubleshooting)

---

## 1. Clone the Repository

```bash
git clone https://github.com/suryafuturepath/Applicant-CoPilot.git
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
| **Project Ref** | The random string in your URL | `abcdefghijk` |

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
cd Applicant-CoPilot
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

All tables have **Row Level Security (RLS)** — users can only see their own data.

### Create the resume storage bucket:

1. Go to Supabase Dashboard → **Storage**
2. Click **"New Bucket"**
3. Settings:
   - Name: `resumes`
   - Public: **No** (toggle off)
   - File size limit: `10485760` (10 MB)
   - Allowed MIME types: `application/pdf`
4. Click **"Create bucket"**

---

## 5. Get a Gemini API Key

The AI features use Google's Gemini Flash (free tier).

1. Go to https://aistudio.google.com/apikey
2. Click **"Create API Key"**
3. Select your Google Cloud project (or create one)
4. Copy the API key

Set it as a Supabase secret (used by the Edge Function):

```bash
supabase secrets set GEMINI_API_KEY="<YOUR_GEMINI_API_KEY>"
```

Verify:
```bash
supabase secrets list
```
Should show `GEMINI_API_KEY` in the list.

---

## 6. Deploy the Edge Function

```bash
supabase functions deploy generate-answer
```

You should see:
```
Deployed Functions on project <your-ref>: generate-answer
```

### Verify it's running:

Go to Supabase Dashboard → **Edge Functions** — you should see `generate-answer` with status "Active".

---

## 7. Set Up Google OAuth

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

## 8. Configure Supabase Auth

### A. Enable Google Provider

1. Go to Supabase Dashboard → **Authentication → Sign In / Providers**
2. Click on **Google**
3. **Toggle "Enable Sign in with Google" → ON**
4. Paste your **Client ID** from step 7
5. Paste your **Client Secret** from step 7
6. Click **Save**

### B. Set Redirect URLs

1. Go to **Authentication → URL Configuration**
2. **Site URL:** Set to `chrome-extension://<YOUR_EXTENSION_ID>`
   (You'll get this ID in step 10 — come back and set it after loading the extension)
3. **Redirect URLs:** Click "Add URL" and add:
   ```
   https://<YOUR_PROJECT_REF>.supabase.co/auth/v1/callback
   ```
4. Click **Save**

---

## 9. Configure the Extension

You need to update two values in the extension code:

### A. Update Supabase URL and Anon Key

Open `extension/supabase-client.js` and update lines 16-17:

```js
export const SUPABASE_URL = 'https://<YOUR_PROJECT_REF>.supabase.co';
const SUPABASE_ANON_KEY = '<YOUR_ANON_KEY>';
```

Replace `<YOUR_PROJECT_REF>` with your project ref and `<YOUR_ANON_KEY>` with your anon key from step 2.

> **Note:** The anon key is safe to put in the extension code — it's a public key that only grants access through RLS policies.

### B. Update CORS in Edge Function (optional but recommended)

Open `supabase/functions/generate-answer/index.ts` and update the CORS origin on line 71:

```ts
"Access-Control-Allow-Origin": "https://<YOUR_PROJECT_REF>.supabase.co",
```

Then redeploy:
```bash
supabase functions deploy generate-answer
```

---

## 10. Load the Extension in Chrome

1. Open Chrome and go to `chrome://extensions`
2. Enable **"Developer mode"** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `extension/` folder inside the cloned repo
5. The extension should appear with a star icon
6. **Copy the Extension ID** — it's the long string shown on the extension card (e.g., `khidbpecgknkokppgjaopamgglcmbkgd`)

### Now go back and set the Site URL:

1. Go to Supabase Dashboard → **Authentication → URL Configuration**
2. Set **Site URL** to:
   ```
   chrome-extension://<YOUR_EXTENSION_ID>
   ```
3. Click **Save**

---

## 11. Test the Setup

### Test 1: Extension loads
- Go to linkedin.com — you should see a floating star button in the bottom-right corner
- Click it to open the side panel

### Test 2: Profile page
- Open `chrome-extension://<YOUR_EXTENSION_ID>/profile.html`
- You should see the profile page with tabs and a "Sign in" button

### Test 3: AI without sign-in (local mode)
- Go to **AI Settings** tab
- Select "Google Gemini" as provider
- Paste your Gemini API key
- Click "Test Connection" — should show success
- Click "Save Settings"
- Navigate to a LinkedIn job posting, open the panel, click "Analyze Job"

### Test 4: Google sign-in
- On the profile page, click **"Sign in"**
- Google consent screen opens — select your account
- Profile page should show your name and "Sign out" button
- Go to Supabase Dashboard → **Authentication → Users** — your account should appear
- Go to **Table Editor → profiles** — your profile row should exist

### Test 5: Backend AI (signed in)
- While signed in, analyze a job on LinkedIn
- Go to Supabase Dashboard → **Table Editor → usage_logs** — a new row should appear

If all 5 tests pass, you're fully set up!

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
This happens when you reload the extension while a tab has the old content script. Just close the tab and open a new one — the error is harmless.

### "No API key configured" when analyzing a job
Either:
- Sign in with Google (uses the backend — no API key needed), or
- Go to Profile → AI Settings → enter your Gemini API key and save

### Edge Function returns 500
Check that your Gemini API key secret is set:
```bash
supabase secrets list
```
If `GEMINI_API_KEY` is missing, set it:
```bash
supabase secrets set GEMINI_API_KEY="<your-key>"
```

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

---

## Environment Summary

Once fully configured, your setup should look like this:

```
Chrome Extension (your browser)
  ├── Gemini API key (AI Settings — for local/offline mode)
  ├── Supabase URL + Anon Key (supabase-client.js — for backend mode)
  └── Signs in via Google OAuth

Supabase Project (cloud)
  ├── Auth: Google OAuth provider enabled
  ├── Database: 5 tables with RLS
  ├── Storage: "resumes" bucket (private)
  ├── Edge Function: generate-answer (Gemini Flash)
  └── Secret: GEMINI_API_KEY

Google Cloud Project
  ├── OAuth consent screen (Testing mode)
  ├── OAuth 2.0 Client ID + Secret
  └── Redirect URI → Supabase callback URL
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
supabase secrets set GEMINI_API_KEY="<key>"

# Deploy edge function
supabase functions deploy generate-answer

# Check status
supabase migration list
supabase secrets list
supabase functions list
```
