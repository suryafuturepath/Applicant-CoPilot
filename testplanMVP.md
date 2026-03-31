# Applicant Copilot — MVP End-to-End Test Plan

**Extension ID:** `khidbpecgknkokppgjaopamgglcmbkgd`
**Supabase Project:** `oeeatotpwtftmvlydgsg.supabase.co`
**Date:** 2026-03-27
**Tester:** Surya

---

## Pre-Test Checklist

- [ ] Extension loaded in Chrome (`chrome://extensions` → Developer mode ON)
- [ ] Extension version matches latest code (check for errors on extension card)
- [ ] Supabase Dashboard accessible at https://supabase.com/dashboard/project/oeeatotpwtftmvlydgsg
- [ ] Google OAuth configured in Supabase (Auth → Providers → Google enabled)
- [ ] Site URL set to `chrome-extension://khidbpecgknkokppgjaopamgglcmbkgd`
- [ ] Redirect URLs include `https://oeeatotpwtftmvlydgsg.supabase.co/auth/v1/callback`
- [ ] Groq API key set as Supabase secret (`supabase secrets list` shows `GROQ_API_KEY`)
- [ ] Gemini API key set as fallback (`supabase secrets list` shows `GEMINI_API_KEY`) — optional
- [ ] `resumes` storage bucket created in Supabase Dashboard (private, 10MB limit)

---

## Test 1: Extension Loads Without Errors

**Goal:** Extension loads cleanly, no errors on the extension card.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 1.1 | Go to `chrome://extensions` | Applicant Copilot card visible, no "Errors" button | |
| 1.2 | Click "Service worker" link | DevTools opens, console has no red errors | |
| 1.3 | Open any non-job site (e.g. google.com) | No floating toggle button appears (URL guard working) | |
| 1.4 | Open linkedin.com | Floating toggle button (star) appears in bottom-right | |
| 1.5 | Click the toggle button | Side panel opens on the right side | |

---

## Test 2: Profile Page & Resume Upload

**Goal:** Profile page loads, resume can be uploaded and parsed.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 2.1 | Open `chrome-extension://khidbpecgknkokppgjaopamgglcmbkgd/profile.html` | Profile page loads with tabs: Profile, Q&A, Applied, Stats, AI Settings | |
| 2.2 | Check header | "Sign in" button visible in top-right | |
| 2.3 | Go to AI Settings tab | Provider dropdown, API key input, model selector visible | |
| 2.4 | Enter Gemini API key, select "Google Gemini" provider, click Save | Toast shows "Settings saved" | |
| 2.5 | Click "Test Connection" | Shows "Connection successful" (or similar success message) | |
| 2.6 | Go to Profile tab | Upload zone visible with "Drop your resume here" text | |
| 2.7 | Upload a PDF resume | File accepted, "Parsing resume..." spinner appears | |
| 2.8 | Wait for parsing | Profile fields auto-populated (name, email, skills, experience) | |
| 2.9 | Click "Save Profile" | Toast shows "Profile saved!" | |
| 2.10 | Reload the page | Saved profile data persists | |

---

## Test 3: Google OAuth Sign-In

**Goal:** User can sign in with Google, session persists.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 3.1 | On profile page, click "Sign in" button | New tab opens with Google consent screen | |
| 3.2 | Select your Google account and authorize | OAuth tab closes automatically | |
| 3.3 | Check profile page header | Shows your name/email + "Sign out" button | |
| 3.4 | Go to AI Settings tab | Green "Backend connected" banner visible | |
| 3.5 | Reload the profile page | Still signed in (session persisted) | |
| 3.6 | Check Supabase Dashboard → Table Editor → `profiles` | New row with your user ID, name, email | |

**Troubleshooting:**
- If OAuth tab doesn't close: check Service Worker console for errors
- If "redirect_uri_mismatch": verify redirect URI in Google Cloud Console matches exactly
- If profile row missing: check Supabase Dashboard → SQL Editor → run `SELECT * FROM auth.users`

---

## Test 4: Sign-Out

**Goal:** Sign out clears session properly.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 4.1 | Click "Sign out" | Header reverts to "Sign in" button | |
| 4.2 | Check AI Settings tab | Green "Backend connected" banner disappears | |
| 4.3 | Reload page | Still signed out | |

---

## Test 5: Job Analysis (Local AI — Signed Out)

**Goal:** Job analysis works with local Gemini API key when not signed in.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 5.1 | Make sure you're signed out | "Sign in" button visible | |
| 5.2 | Navigate to a LinkedIn job posting | Side panel toggle button visible | |
| 5.3 | Open the panel, click "Analyze Job" | Spinner shows "Analyzing..." | |
| 5.4 | Wait for analysis | Match score appears (0-100), matching/missing skills listed | |
| 5.5 | Check for buttons | "Cover Letter", "Improve Resume Bullets", "ATS Resume" buttons visible | |
| 5.6 | Click "Re-Analyze" | Fresh analysis runs (not cached) | |

**If "Error: Could not parse JSON":**
- Click "Re-Analyze" — should work on second attempt
- If persistent: check Service Worker console for the raw AI response

---

## Test 6: Job Analysis (Backend — Signed In)

**Goal:** Same analysis but routed through Edge Function with usage logging.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 6.1 | Sign in with Google (Test 3) | Signed in confirmed | |
| 6.2 | Navigate to a LinkedIn job posting | Side panel toggle visible | |
| 6.3 | Open panel, click "Analyze Job" | Analysis completes (may take slightly longer — Edge Function cold start) | |
| 6.4 | Check Supabase Dashboard → `usage_logs` | New row with `action_type: 'answer_generation'`, your `profile_id`, token counts | |
| 6.5 | Verify score and skills appear correctly | Same quality as local path | |

---

## Test 7: Profile Sync to Supabase

**Goal:** Saving profile in extension pushes data to Supabase.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 7.1 | Sign in with Google | Signed in confirmed | |
| 7.2 | Go to Profile tab, edit the summary field | Change some text | |
| 7.3 | Click "Save Profile" | Toast shows "Profile saved!" | |
| 7.4 | Check Supabase Dashboard → `profiles` table | `summary` column updated with your change | |
| 7.5 | Check `experiences` table | Rows match your resume experience entries | |

---

## Test 8: Cover Letter Generation

**Goal:** Cover letter is 400-500 words, 4 paragraphs, references real profile data.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 8.1 | On a job page with completed analysis, click "Cover Letter" | Spinner shows "Writing..." | |
| 8.2 | Wait for generation | Cover letter appears in the panel | |
| 8.3 | Verify length | ~400-500 words, 4 distinct paragraphs | |
| 8.4 | Verify content quality | References specific skills/experience from your resume, mentions the company by name | |
| 8.5 | Click "Copy" | Text copied to clipboard, button shows "Copied!" | |

---

## Test 9: ATS Resume Generator

**Goal:** Generate a tailored resume and download as PDF.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 9.1 | On a job page with completed analysis, click "ATS Resume" | Resume section expands with instructions field + generate button | |
| 9.2 | Optionally type instructions (e.g. "Emphasize Python skills") | Text accepted in the field | |
| 9.3 | Click "Generate Tailored Resume" | Spinner shows, then resume text appears | |
| 9.4 | Verify resume content | Has standard sections: SUMMARY, EXPERIENCE, SKILLS, EDUCATION. Mirrors JD keywords | |
| 9.5 | Click "Copy" | Resume text copied to clipboard | |
| 9.6 | Click "Download PDF" | New window opens with formatted resume, browser print dialog appears | |
| 9.7 | Save as PDF | Clean single-column PDF saved | |

---

## Test 10: AutoFill (Basic)

**Goal:** AutoFill detects form fields and generates suggestions.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 10.1 | Navigate to a job application page (LinkedIn Easy Apply or Workday) | Application form visible | |
| 10.2 | Open panel, click "AutoFill Application" | Spinner shows, then preview of field → value mappings appears | |
| 10.3 | Review suggestions | Fields matched to profile data (name, email, etc.) | |
| 10.4 | Click "Apply Selected" | Form fields populated with suggested values | |
| 10.5 | Verify filled values | Correct data in correct fields | |

---

## Test 11: SPA Navigation Detection

**Goal:** Panel resets when navigating between job listings.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 11.1 | Analyze a job on LinkedIn | Analysis displayed in panel | |
| 11.2 | Click a different job listing (same tab, no full reload) | Panel shows "New job detected — click Analyze Job." | |
| 11.3 | Previous analysis cleared | Score, skills, cover letter sections hidden | |
| 11.4 | Click "Analyze Job" on the new listing | Fresh analysis for the new job | |

---

## Test 12: Rate Limiting

**Goal:** Edge Function rate limit (50 req/hr) works correctly.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 12.1 | Sign in and run multiple analyses | Each succeeds and logs to `usage_logs` | |
| 12.2 | Check `usage_logs` count for your user in last hour | Count matches number of requests made | |
| 12.3 | (Optional) Manually set 50+ rows in `usage_logs` for your user | Next request returns 429 "Rate limit exceeded" | |

---

## Test 13: Offline / Error Resilience

**Goal:** Extension degrades gracefully when backend is unavailable.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 13.1 | Sign in, then disconnect from internet | Extension still loads, panel opens | |
| 13.2 | Try "Analyze Job" while offline | Falls back to local AI (if API key set), or shows network error | |
| 13.3 | Reconnect to internet | Next request works normally | |
| 13.4 | Sign in with expired/invalid session | Falls back to local AI path with console warning | |

---

## Test 14: Multi-Slot Resume Profiles

**Goal:** User can switch between up to 3 resume profiles.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 14.1 | On profile page, see "Resume 1" active in slot switcher | Active slot highlighted | |
| 14.2 | Upload a resume for Resume 1 | Parsed and saved | |
| 14.3 | Click "Resume 2" slot | Empty profile form (no data yet) | |
| 14.4 | Upload a different resume | Parsed and saved to slot 2 | |
| 14.5 | Switch back to "Resume 1" | Original resume data loaded | |
| 14.6 | Analyze a job with Resume 1 active, then switch to Resume 2 and re-analyze | Different match scores reflecting different resumes | |

---

## Test 15: Theme Switching

**Goal:** All three themes work correctly.

| # | Step | Expected Result | Pass? |
|---|------|-----------------|-------|
| 15.1 | Click theme toggle button (sun/moon/leaf icon) | Theme changes (Blue → Dark → Warm → Blue) | |
| 15.2 | Verify Dark theme | Dark backgrounds, light text, all sections readable | |
| 15.3 | Verify Warm theme | Amber accents, warm tones, all sections readable | |
| 15.4 | Reload page | Theme persists | |
| 15.5 | Check side panel theme | Matches profile page theme | |

---

## Post-Test Verification (Supabase Dashboard)

After completing all tests, verify in the Supabase Dashboard:

| Check | Table/Section | Expected |
|-------|--------------|----------|
| User created | Auth → Users | Your Google account listed |
| Profile synced | Table Editor → `profiles` | Row with your name, email, summary |
| Experiences synced | Table Editor → `experiences` | Rows matching your resume |
| Usage logged | Table Editor → `usage_logs` | Multiple rows with token counts, model name, action types |
| No unauthorized access | `profiles` RLS test | Cannot read other users' data (tested via SQL Editor with different JWT) |

---

## Known Limitations (MVP)

- **Google OAuth only** — email/password auth not wired yet
- **One-way sync** — profile pushes extension → Supabase, not the reverse (except on first sign-in)
- **No billing** — usage is logged but not charged
- **Resume download** — uses browser print dialog (no native PDF generation)
- **ATS score** — instructed in the prompt, not measured by a real ATS parser
- **Cold starts** — first Edge Function call after idle may take 3-5 seconds

---

## Test Results Summary

| Test | Description | Status |
|------|-------------|--------|
| 1 | Extension loads | |
| 2 | Profile & resume upload | |
| 3 | Google OAuth sign-in | |
| 4 | Sign-out | |
| 5 | Job analysis (local) | |
| 6 | Job analysis (backend) | |
| 7 | Profile sync | |
| 8 | Cover letter | |
| 9 | ATS resume generator | |
| 10 | AutoFill | |
| 11 | SPA navigation | |
| 12 | Rate limiting | |
| 13 | Offline resilience | |
| 14 | Multi-slot profiles | |
| 15 | Theme switching | |

**Overall MVP Verdict:** [ ] PASS / [ ] PASS WITH ISSUES / [ ] FAIL
