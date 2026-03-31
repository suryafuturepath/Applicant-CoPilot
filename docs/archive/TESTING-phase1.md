# Phase 1 — Manual Test Cases

## Setup
1. Open Chrome → navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `extension/` folder at:
   `/Users/surya/Documents/Programs/Applicant Copilot/extension`
4. Verify: Extension appears as **"Applicant Copilot – AI-Powered Job Application Assistant"** v0.1.0
5. Pin the extension to the toolbar (click puzzle icon → pin)

---

## Test 1: Extension Loads Without Errors
**Steps:**
1. After loading unpacked, check for errors in `chrome://extensions` (red error badge)
2. Click "Service Worker" link under Applicant Copilot → opens DevTools for background.js
3. Check Console tab — should be clean (no errors)

**Expected:** No errors. Extension is active.
**Status:** [ ]

---

## Test 2: Floating Toggle Button Appears
**Steps:**
1. Navigate to any webpage (e.g., google.com)
2. Look for a floating ★ button on the right side of the page

**Expected:** Teal/blue floating button appears. Draggable.
**Status:** [ ]

---

## Test 3: Side Panel Opens and Shows Branding
**Steps:**
1. Click the floating ★ button OR click the extension icon in toolbar
2. Side panel should slide in from the right

**Expected:**
- Panel header shows **"Applicant Copilot"** (NOT "JobMatch AI")
- No "JobMatch" text anywhere in the panel
- Theme toggle works (click sun/moon icon)

**Status:** [ ]

---

## Test 4: LinkedIn JD Extraction
**Steps:**
1. Navigate to a LinkedIn job posting (e.g., search for any job → click on it)
2. Open the Applicant Copilot side panel
3. Click "Analyze Job" button

**Expected:**
- JD text is extracted and displayed
- Match score appears (if API key configured)
- Company name and role title shown correctly

**Note:** Full analysis requires an AI provider API key in Settings. JD extraction itself works without one.
**Status:** [ ]

---

## Test 5: Workday JD Extraction
**Steps:**
1. Navigate to any Workday job posting (e.g., search "[company] careers workday" and find a `*.myworkdayjobs.com` URL)
2. Open the side panel
3. Click "Analyze Job"

**Expected:**
- JD text extracted via `[data-automation-id="jobPostingDescription"]` selector
- Job title and company shown

**Status:** [ ]

---

## Test 6: Profile Page Opens
**Steps:**
1. In the side panel, click the "Profile" tab/nav button
2. Or right-click extension icon → "Options"

**Expected:**
- Profile page opens in a new tab
- Title shows **"Applicant Copilot – Profile & Settings"** (NOT "JobMatch AI")
- Resume upload zone visible
- Q&A section visible
- Theme toggle works

**Status:** [ ]

---

## Test 7: Resume Upload (PDF)
**Steps:**
1. Go to Profile page
2. Drag a PDF resume into the upload zone (or click to browse)
3. Wait for parsing

**Expected:**
- Resume parsed successfully
- Name, email, skills, experience extracted and populated in profile fields

**Status:** [ ]

---

## Test 8: Storage Keys Rebranded
**Steps:**
1. Open DevTools on any page where extension is active (F12)
2. Go to Application tab → Local Storage → look for extension entries
3. Also check: DevTools → Application → Extension Storage

**Expected:**
- Storage keys use `ac_` prefix (e.g., `ac_analysisCache`, `ac_theme`)
- No `jm_` prefixed keys

**Status:** [ ]

---

## Test 9: Form Field Detection
**Steps:**
1. Navigate to any job application form (LinkedIn Easy Apply, or a Workday application)
2. Open side panel
3. Click "Auto-fill" (if available) or check console for `detectFormFields` output

**Expected:**
- Form fields detected (text inputs, dropdowns, radio buttons)
- Field labels correctly identified
- Preview chips appear near form fields

**Note:** Actual filling requires an API key. Detection works without one.
**Status:** [ ]

---

## Test 10: No Console Errors on Navigation
**Steps:**
1. Open DevTools Console
2. Navigate between 5+ different pages (LinkedIn, Indeed, Google, Workday, any random site)
3. Open and close the side panel on each page

**Expected:**
- No errors in console related to "Applicant Copilot" or content script
- Panel opens/closes cleanly on each page
- No "JobMatch" references in any console logs

**Status:** [ ]

---

## Quick Smoke Test (60 seconds)
If short on time, do these 3 checks:
1. Load extension → no errors → ★ button appears
2. Open panel → says "Applicant Copilot" → theme toggle works
3. Go to LinkedIn job → click Analyze → JD text extracted

If all 3 pass, Phase 1 is green.
