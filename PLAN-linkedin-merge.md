# Implementation Plan: LinkedIn Import — Merge Logic

**Overall Progress:** 100%
**Estimated phases:** 3
**Approach:** Data-normalization → per-section merge strategy → toast feedback

## TLDR
The scraper returns correct shaped data that matches `profileData` exactly. What's missing is intelligent merge behaviour: replace authoritative sections (experience, education, projects), union additive sections (skills, certifications), clean up LinkedIn's appended duration strings from dates, and report new-vs-existing counts in the toast.

## Key Decisions

- **Experience / Education / Projects → Replace**: LinkedIn is the authoritative source; overwrite entirely.
- **Skills / Certifications → Union**: Users may have manually added items not on LinkedIn; preserve them, just add new ones from the scrape. Scraped items come first (LinkedIn ordering), existing-only items appended.
- **Date cleanup in the merge layer, not the scraper**: Keeps the scraper read-only/locked; normalization is a merge concern. Rule: strip the ` · X yrs/mos` duration suffix; discard strings that have no year or "Present" after stripping.
- **Company-block leak filter in merge**: Snapshot item 2 shows the Wipro outer-company block sneaking through as an entry (`company: "Full-time"`, `dates: "Full-time · 4 yrs 6 mos"`). After date normalization, these entries end up with `dates: ""` AND `company` is a pure employment-type word → drop them. This is a merge-layer guard, not a scraper fix.
- **New counts exposed per section**: Return `{ counts, newCounts }` where `newCounts` tracks genuinely-new items for union sections. Drives the updated toast message.

---

## Phase 1: Normalize scraped data before writing

**Goal:** All five arrays are cleaned of LinkedIn artefacts before they touch the profile.

**Files:** `extension/background.js` — merge block (~line 3380)

- [ ] Step 1.1: Add `normalizeDate(d)` helper inside the merge block:
  - Strip ` · N yr(s)/mo(s)` duration suffix via regex
  - If remaining string has no `\b(19|20)\d{2}\b` year OR "present" → return `''`
  - Examples: `"Dec 2025 - Present · 5 mos"` → `"Dec 2025 - Present"` | `"Self-employed · 5 mos"` → `""` | `"2017 – 2021"` → `"2017 – 2021"`

- [ ] Step 1.2: Apply `normalizeDate` to `allData.experience`:
  - Map each entry: `dates = normalizeDate(entry.dates)`

- [ ] Step 1.3: Apply `normalizeDate` to `allData.education`:
  - Map each entry: `dates = normalizeDate(entry.dates)`

- [ ] Step 1.4: Filter out company-block-leak entries from `allData.experience`:
  - Drop any entry where BOTH:
    - `dates` is empty after normalization
    - `company` matches a pure employment-type pattern: `/^(full-time|part-time|contract|self-employed|internship|freelance|temporary)$/i`
  - Rationale: these are the outer company group entries leaking through (e.g. Wipro outer block), not real roles

**Verify:** Log `allData` after normalization. Dates like "Dec 2025 - Present · 5 mos" become "Dec 2025 - Present". The Wipro outer-block entry (company="Full-time", dates="Full-time · 4 yrs 6 mos") is gone. All other entries preserved.

---

## Phase 2: Per-section merge strategy

**Goal:** Each section uses the right merge policy — replace for owned sections, union for additive ones.

**Files:** `extension/background.js` — merge block (~line 3385)

- [ ] Step 2.1: **Experience** — replace:
  ```js
  profile.experience = allData.experience;    // already normalized in Phase 1
  counts.experience  = allData.experience.length;
  ```

- [ ] Step 2.2: **Education** — replace:
  ```js
  profile.education = allData.education;
  counts.education  = allData.education.length;
  ```

- [ ] Step 2.3: **Projects** — replace:
  ```js
  profile.projects = allData.projects;
  counts.projects  = allData.projects.length;
  ```

- [ ] Step 2.4: **Skills** — union (scraped first, preserve existing-only):
  - Build `existingLower` set from `(profile.skills || []).map(toLowerCase)`
  - `newSkills = allData.skills.filter(s => !existingLower.has(s.toLowerCase()))`
  - `profile.skills = [...allData.skills, ...(profile.skills || []).filter(s => !allData.skills.some(sc => sc.toLowerCase() === s.toLowerCase()))]`
  - `counts.skills = profile.skills.length`
  - `newCounts.skills = newSkills.length`

- [ ] Step 2.5: **Certifications** — union (scraped first, preserve existing-only):
  - Same logic as Step 2.4 but for `profile.certifications` / `allData.certifications`
  - `counts.certifications = profile.certifications.length`
  - `newCounts.certifications = newCertifications.length`

- [ ] Step 2.6: Save and return both `counts` and `newCounts`:
  ```js
  await chrome.storage.local.set({ profile });
  return { success: true, counts, newCounts, phaseResults, snapshotMd };
  ```

**Verify:** 
- Run import on a profile that already has 3 manually-added skills not on LinkedIn → after import those 3 skills still exist at the end of the skills list.
- Skills total = 40 scraped + N existing-only.
- `newCounts.skills` = number of skills that weren't in the profile before.

---

## Phase 3: Toast feedback — new vs existing

**Goal:** The completion message tells the user exactly what was added vs what was already there for union sections.

**Files:** `extension/profile.js` — import result handler (~line 1866)

- [ ] Step 3.1: Read `newCounts` from `result` alongside `counts`:
  ```js
  const counts    = result?.counts    || {};
  const newCounts = result?.newCounts || {};
  ```

- [ ] Step 3.2: Update message-building logic:
  - Experience, education, projects: same as before (`N experiences`)
  - Skills: if `newCounts.skills > 0` → `"${counts.skills} skills (${newCounts.skills} new)"`, else `"${counts.skills} skills (all existing)"`
  - Certifications: same pattern as skills using `newCounts.certifications`

- [ ] Step 3.3: Final message example:
  - `"Imported: 9 experiences, 3 education, 40 skills (12 new), 10 certifications (4 new), 5 projects."`

**Verify:** After import, toast shows counts with "(N new)" for skills and certifications. The number in parentheses matches actual new entries visible in the form that weren't there before.

---

## Risks & Watchouts

| Risk | Mitigation |
|------|-----------|
| Wipro scraping bug (outer company block as entry) | Phase 1.4 filter removes it at merge time. The sub-roles are still missing (3 Wipro roles show as 1 entry) — that's a scraper bug to fix separately, not in this plan. |
| Self-employed solo entries with empty dates | After Phase 1, `dates: ""` is valid and won't be filtered (company = "Self-employed" doesn't match the employment-type + empty-dates filter because `"Self-employed"` alone fails — the rule requires BOTH empty dates AND company being a pure employment-type word with no other content). Actually "Self-employed" IS in the employment-type list — need to verify "Nights & Weekends" entry survives. Guard: only filter if title ALSO matches the company name (title === company). |
| Skills union order changes between runs | Scraped skills are always first (LinkedIn order), then existing-only appended. Stable across re-runs. |
| Case-sensitivity in dedup | All comparisons use `toLowerCase()`. "SQL" and "sql" are treated as the same skill. The scraped casing wins (it's LinkedIn's canonical casing). |
| Empty allData sections (page scrape failed) | If `allData.skills.length === 0`, union still runs but adds nothing — existing skills are preserved. Replace sections (experience etc.) will wipe to empty if that page failed. Acceptable: empty section is a clear signal the scrape failed for that page. |

## Out of Scope

- Fixing the Wipro multi-role scraping bug (sub-roles not captured as individual entries)
- Merging experience entries by matching job title + company (dedup existing experience)
- Merging education entries by matching school name
- Any changes to the scraper itself
- Profile basics (name, headline, location) — user said "ignore the person part"
- Supabase sync changes — existing `syncProfileToSupabase` call in `SAVE_PROFILE` handles it
