# Implementation Plan: Material Icons + UI Alignment Fix

**Overall Progress:** 0%
**Estimated phases:** 3
**Approach:** Infrastructure first (font) → Icon replacement (bulk) → Layout/visibility fixes

## TLDR
Replace all emoji characters (&#xxxxx;) with Google Material Symbols across both the side panel and profile page. Fix the "Save Profile" floating bar so it only shows on User Context tab. The panel uses Shadow DOM so the icon font must be loaded there too.

## Key Decisions
- **Material Symbols Outlined (variable font)**: Use the self-hosted `.woff2` file bundled in `extension/fonts/` — CDN won't work in Shadow DOM content scripts due to CSP
- **Icon style**: `material-symbols-outlined` class with ligature names (e.g., `<span class="material-symbols-outlined">delete</span>`)
- **No CDN dependency**: Download the font file, load it the same way Manrope is loaded (chrome.runtime.getURL)

## Phase 1: Add Material Symbols Font
**Goal:** Material Symbols font available in both profile.html and Shadow DOM panel
**Files touched:** `extension/fonts/` (new font file), `extension/manifest.json`, `extension/src/panel/panel-css.js`, `extension/profile.html`

- [ ] Step 1.1: Download `MaterialSymbolsOutlined[FILL,GRAD,opsz,wght].woff2` variable font file into `extension/fonts/`
- [ ] Step 1.2: Add font file to `web_accessible_resources` in `manifest.json`
- [ ] Step 1.3: Add `@font-face` declaration in `panel-css.js` (alongside existing Manrope) using `chrome.runtime.getURL`
- [ ] Step 1.4: Add `.material-symbols-outlined` utility class in `panel-css.js` (font-family, font-size: 20px, line-height: 1, vertical-align: middle)
- [ ] Step 1.5: Add same `@font-face` and utility class in `profile.html` `<style>` block

**Verify:** Open extension, inspect Shadow DOM — confirm `material-symbols-outlined` font-family loads. Open profile.html — same check.

## Phase 2: Replace Emojis with Material Icons
**Goal:** Every emoji character replaced with a Material Symbol icon
**Files touched:** `extension/src/panel/panel-html.js`, `extension/src/panel/toggle-button.js`, `extension/profile.html`, `extension/profile.js`

### 2A — Side Panel (`panel-html.js`)
- [ ] Step 2A.1: Header icon `&#9650;` (▲) → Material icon `change_history` or keep as SVG brand mark
- [ ] Step 2A.2: Location `&#128205;` → `location_on`
- [ ] Step 2A.3: Salary `&#128176;` → `payments`
- [ ] Step 2A.4: Cover Letter button `&#9993;` → `mail`
- [ ] Step 2A.5: ATS Resume button `&#128196;` → `description`
- [ ] Step 2A.6: Matching Skills icon `&#10004;` → `check_circle`
- [ ] Step 2A.7: Growth Gaps icon `&#9678;` → `trending_up`
- [ ] Step 2A.8: Warning notices `&#9888;` → `warning`
- [ ] Step 2A.9: Generate Resume `&#10024;` → `auto_awesome`
- [ ] Step 2A.10: Resume ready badge `&#9989;` → `check_circle`
- [ ] Step 2A.11: Open preview `&#8599;` → `open_in_new`
- [ ] Step 2A.12: Open Full Preview button `&#128196;` → `description`
- [ ] Step 2A.13: Regenerate `&#128260;` → `refresh`
- [ ] Step 2A.14: Clear chat `&#128465;` → `delete`
- [ ] Step 2A.15: Chat chips — `&#10004;` → `check_circle`, `&#128640;` → `rocket_launch`, `&#128270;` → `search`, `&#11088;` → `star`
- [ ] Step 2A.16: Send message `&#10148;` → `send`
- [ ] Step 2A.17: Back arrow `&#8592;` → `arrow_back`
- [ ] Step 2A.18: Suggested chips (duplicate set) — same replacements as 2A.15

### 2B — Toggle Button (`toggle-button.js`)
- [ ] Step 2B.1: Toggle `&#9650;` → `expand_less` (or keep SVG brand mark)

### 2C — Profile Page (`profile.html`)
- [ ] Step 2C.1: Sidebar nav — User Context `&#128100;` → `person`
- [ ] Step 2C.2: Sidebar nav — My Jobs `&#128188;` → `work`
- [ ] Step 2C.3: Sidebar nav — AI Settings `&#9881;` → `settings`
- [ ] Step 2C.4: Theme toggle `&#9881;` → `dark_mode` (or `settings`)
- [ ] Step 2C.5: Resume card icon `&#128196;` → `description`
- [ ] Step 2C.6: Upload zone icon `&#8682;` → `upload`
- [ ] Step 2C.7: EEO section `&#128737;` → `shield`
- [ ] Step 2C.8: Applied empty icon `&#128188;` → `work`
- [ ] Step 2C.9: Save Profile `&#128190;` → `save`

### 2D — Profile JS (`profile.js`)
- [ ] Step 2D.1: Intake section icons — `&#9733;` → `star`, `&#128188;` → `work`, `&#128640;` → `rocket_launch`, `&#127891;` → `school`, `&#9881;` → `settings`, `&#128100;` → `person`, `&#128203;` → `assignment`
- [ ] Step 2D.2: Intake complete checkmark `&#10003;` → `check`
- [ ] Step 2D.3: Review icon `&#128220;` → `rate_review`
- [ ] Step 2D.4: Prompt section arrow `&#9654;` → `chevron_right`
- [ ] Step 2D.5: Applied empty search `&#128269;` → `search`
- [ ] Step 2D.6: Applied empty briefcase `&#128188;` → `work`
- [ ] Step 2D.7: Job card external link `&#8599;` → `open_in_new`
- [ ] Step 2D.8: Job card company `&#127970;` → `business`
- [ ] Step 2D.9: Job card time `&#128336;` → `schedule`
- [ ] Step 2D.10: View JD toggle `&#8964;`/`&#8963;` → `expand_more`/`expand_less`
- [ ] Step 2D.11: Prep button `&#9889;` → `bolt`
- [ ] Step 2D.12: Delete button `&#128465;` → `delete`
- [ ] Step 2D.13: Resume card delete `&#10005;` → `close`
- [ ] Step 2D.14: Resume card icon `&#128196;` → `description`
- [ ] Step 2D.15: Upload zone icon `&#8682;` → `upload`
- [ ] Step 2D.16: Document icon `&#128196;` → `description`

**Verify:** Open side panel on a LinkedIn job page → all icons render as Material Symbols, no emoji visible. Open profile page → sidebar icons, buttons, cards all use Material Symbols.

## Phase 3: Save Profile Button Visibility + Layout Polish
**Goal:** Save Profile bar only visible on User Context tab; minor alignment fixes
**Files touched:** `extension/profile.html`, `extension/profile.js`

- [ ] Step 3.1: In the tab-switching handler in `profile.js` (~line 203), add logic: show `floatingSaveBar` when `tab.dataset.tab === 'profile'`, hide it otherwise
- [ ] Step 3.2: Also hide it on initial load if the active tab isn't profile (handles URL hash navigation to `#applied` or `#settings`)
- [ ] Step 3.3: Verify AI Settings tab still shows the bar (user confirmed it should appear on AI Settings too — both profile and settings are saveable). Actually, user said "specific to profile" — so only show on User Context.
- [ ] Step 3.4: Review and fix any icon-related alignment (ensure `.material-symbols-outlined` has proper vertical alignment in buttons, sidebar items, and card rows)
- [ ] Step 3.5: Ensure sidebar nav icon sizing is consistent (20px for all nav icons)

**Verify:** Click through all 3 tabs — Save Profile bar visible only on User Context. No broken layouts.

## Risks & Watchouts
- **Shadow DOM font loading**: The panel injects into page Shadow DOM — `@font-face` must be declared inside the shadow CSS, not in a `<link>` tag. The existing Manrope pattern handles this correctly, so follow the same approach.
- **Font file size**: Material Symbols variable font is ~2-4MB. Consider subsetting to only used icons if extension size becomes a concern (out of scope for now).
- **Toggle button**: `toggle-button.js` sets innerHTML to an emoji — changing to Material Symbol requires the font to be loaded in the Shadow DOM context where the button lives.

## Out of Scope
- Font subsetting / tree-shaking unused icons (can optimize later if package size matters)
- Redesigning page layouts beyond fixing the Save Profile visibility
- Dark mode icon variants
- Replacing the SVG icons in the bottom nav bar (these are already proper SVGs, not emojis)
