/**
 * @file content.js
 * @description Main content script for Applicant Copilot.
 *
 * ROLE IN EXTENSION ARCHITECTURE
 * --------------------------------
 * This file is injected into supported job-site pages (LinkedIn, Indeed,
 * Glassdoor, Greenhouse, Lever, Workday, etc.) by the manifest content_scripts
 * declaration.  It runs in the page's context (but is isolated from page JS)
 * and is responsible for ALL user-facing UI and interaction logic.
 *
 * Everything runs inside a single IIFE to avoid polluting the global namespace.
 * The panel and its toggle button each live inside their own Shadow DOM host so
 * the page's CSS can never bleed in and the extension's CSS can never bleed out.
 *
 * KEY RESPONSIBILITIES
 * ---------------------
 * 1. Shadow DOM side panel — renders the full analysis UI (score, skills, recs,
 *    insights, ATS keywords, cover letter, bullet rewriter, notes).
 * 2. Draggable floating ★ button — always-visible trigger that opens/closes panel.
 * 3. Job data extraction — scrapes title, company, location, salary, and the
 *    full job description from the host page using site-specific CSS selectors.
 * 4. Job analysis — sends extracted data to background.js for AI scoring and
 *    caches results in chrome.storage.local to avoid redundant API calls.
 * 5. AutoFill pipeline — detects form fields (text, select, radio, checkbox,
 *    custom dropdowns), sends them to the AI for answer generation, shows a
 *    preview for user review, then fills the form on confirmation.
 * 6. Cover letter & bullet rewriter — post-analysis AI writing tools.
 * 7. Job notes — per-URL free-text notes saved to chrome.storage.local.
 * 8. SPA navigation detection — resets state when LinkedIn/Indeed navigate to a
 *    new job posting without a full page reload.
 */

// Injected into job site pages by manifest.json content_scripts

(function() {
  'use strict';

  // Prevent double injection (e.g. if the content script fires twice on the same page)
  if (window.__applicantCopilotLoaded) return;
  window.__applicantCopilotLoaded = true;

  // ─── URL guard: only initialize on supported job sites ─────────────
  // Keeps the extension dormant on non-job pages (Gmail, YouTube, etc.)
  // to avoid unnecessary DOM injection and performance overhead.
  // The toolbar icon click (TOGGLE_PANEL message) still works on any page
  // because it's handled by a separate message listener below.
  const JOB_SITE_PATTERNS = [
    /linkedin\.com/i, /indeed\.com/i, /glassdoor\.com/i,
    /greenhouse\.io/i, /lever\.co/i, /myworkdayjobs\.com/i,
    /myworkday\.com/i, /icims\.com/i, /workday\.com/i,
    /smartrecruiters\.com/i, /ashbyhq\.com/i, /jobs\./i, /careers\./i, /apply\./i,
  ];
  const _isJobSite = JOB_SITE_PATTERNS.some(p => p.test(window.location.hostname));
  let _lazyInitDone = false;

  function ensureInitialized() {
    if (_lazyInitDone) return;
    _lazyInitDone = true;
    createPanel();
    createToggleButton();
  }

  // ─── State ──────────────────────────────────────────────────────
  // Module-level variables shared across functions within this IIFE.

  let panelOpen = false;        // Whether the side panel is currently visible
  let currentAnalysis = null;   // The most recent analysis result for the current page
  let panelRoot = null;         // The host DOM element that contains the Shadow DOM panel
  let shadowRoot = null;        // The closed Shadow DOM root — panel elements are queried from here
  let toggleBtnRef = null;      // Reference to the floating toggle button (inside closed Shadow DOM)

  // AutoFill state
  let _pendingAnswers   = null; // kept for legacy compatibility
  let _pendingQuestions = null;
  let _fieldMap         = {};   // Map of question_id → { el, type, ... } built during field detection

  // Inline chip state — chips live in document.body (outside Shadow DOM)
  let _chips             = new Map(); // questionId → { chipEl, fieldEl, ans }
  let _chipBar           = null;      // sticky bottom bar element
  let _chipScrollHandler = null;      // scroll listener reference (for cleanup)
  let _chipResizeObs     = null;      // ResizeObserver reference (for cleanup)

  // Autofill badges — fixed-position pills that don't affect page layout
  let _badges            = [];        // [{ badgeEl, fieldEl, place }] for repositioning + cleanup
  let _badgeScrollHandler = null;     // scroll listener for badge repositioning
  let _badgeResizeObs    = null;      // ResizeObserver for badge repositioning

  // Auto-scan keyword match widget state
  let _autoScanTimer         = null;  // debounce timer for auto-scan
  let _scoreWidgetHost       = null;  // Shadow DOM host for floating widget
  let _scoreWidgetShadow     = null;  // closed Shadow DOM root for widget
  let _scoreWidgetExpanded   = false; // whether the widget card is open
  let _lastAutoScanUrl       = null;  // prevent re-scanning same URL
  let _cachedProfileKeywords = null;  // Map<string, number> — extracted once, reused per job
  let _profileKeywordsTimer  = null;  // periodic refresh interval

  // Resume slot switcher state — mirrors chrome.storage.local slot data
  let _activeSlot = 0;                                  // Currently selected slot index (0-2)
  let _slotNames  = ['Resume 1', 'Resume 2', 'Resume 3']; // Display names for each slot
  let _slotHasData = [false, false, false];             // Whether each slot has a profile loaded

  // ─── Persistent analysis cache (chrome.storage.local) ──────────
  // Caching analysis results prevents redundant API calls when the user
  // closes and reopens the panel or navigates back to a job they already viewed.
  // Results are stored under a single 'ac_analysisCache' key as a URL→data map.

  const CACHE_STORAGE_KEY = 'ac_analysisCache'; // Key used in chrome.storage.local
  const MAX_CACHE_ENTRIES = 50;                  // LRU eviction kicks in beyond this limit

  /**
   * Retrieves a cached analysis result for the given page URL.
   * @async
   * @param {string} url - The full URL of the job posting page.
   * @returns {Promise<Object|null>} Cached result or null if not found.
   */
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour TTL for cache entries

  async function getCachedAnalysis(url) {
    const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    const cache = result[CACHE_STORAGE_KEY] || {};
    const entry = cache[url];
    if (!entry) return null;
    // Expire entries older than 24 hours
    if (entry.timestamp && Date.now() - entry.timestamp > CACHE_TTL_MS) {
      delete cache[url];
      await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
      return null;
    }
    return entry;
  }

  /**
   * Stores an analysis result for the given URL, evicting the oldest entries
   * when the cache exceeds MAX_CACHE_ENTRIES.
   * @async
   * @param {string} url  - The full URL of the job posting page.
   * @param {Object} data - The analysis payload to cache.
   */
  async function setCachedAnalysis(url, data) {
    const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
    const cache = result[CACHE_STORAGE_KEY] || {};
    cache[url] = { ...data, timestamp: Date.now() };
    // Evict oldest entries (Object.keys preserves insertion order in V8)
    const keys = Object.keys(cache);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach(k => delete cache[k]);
    }
    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
  }

  // ─── Theme management ────────────────────────────────────────────
  // Themes: 'blue' (default), 'dark', 'warm'

  const THEME_ORDER = ['blue', 'dark', 'warm'];
  const THEME_FAB_COLORS = {
    blue: { bg: '#3b82f6', shadow: 'rgba(59,130,246,0.4)' },
    dark: { bg: '#1e3a5f', shadow: 'rgba(30,58,95,0.4)' },
    warm: { bg: '#d97706', shadow: 'rgba(217,119,6,0.4)' }
  };
  // Next theme's primary color shown inside the toggle button
  const THEME_ICONS = { blue: '\u2600\uFE0F', dark: '\uD83C\uDF19', warm: '\uD83C\uDF3B' };
  let _currentTheme = 'blue';

  /**
   * Applies the given theme to the panel and FAB toggle button.
   * @param {string} theme - 'blue', 'dark', or 'warm'
   */
  function applyTheme(theme) {
    _currentTheme = theme;
    const panel = shadowRoot && shadowRoot.getElementById('jm-panel');
    if (panel) {
      panel.classList.remove('theme-dark', 'theme-warm');
      if (theme === 'dark') panel.classList.add('theme-dark');
      if (theme === 'warm') panel.classList.add('theme-warm');
    }
    // Update FAB toggle button colors
    if (toggleBtnRef) {
      const colors = THEME_FAB_COLORS[theme] || THEME_FAB_COLORS.blue;
      toggleBtnRef.style.background = colors.bg;
      toggleBtnRef.style.boxShadow = `0 4px 12px ${colors.shadow}`;
    }
    // Update the theme toggle button indicator
    if (shadowRoot) {
      const themeBtn = shadowRoot.getElementById('jmThemeToggle');
      if (themeBtn) {
        themeBtn.textContent = THEME_ICONS[theme] || THEME_ICONS.blue;
        const nextIdx = (THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length;
        const nextName = THEME_ORDER[nextIdx] === 'blue' ? 'Ocean Blue' : THEME_ORDER[nextIdx] === 'dark' ? 'Dark Mode' : 'Warm Amber';
        themeBtn.title = `Switch to ${nextName}`;
      }
    }
  }

  /**
   * Cycles to the next theme, saves it, and applies it.
   */
  async function cycleTheme() {
    const idx = THEME_ORDER.indexOf(_currentTheme);
    const nextTheme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
    _currentTheme = nextTheme;
    try {
      await chrome.storage.local.set({ ac_theme: nextTheme });
    } catch (e) { /* ignore */ }
    applyTheme(nextTheme);
  }

  /**
   * Loads the saved theme from storage and applies it.
   */
  async function loadTheme() {
    try {
      const result = await chrome.storage.local.get('ac_theme');
      const theme = result.ac_theme || 'blue';
      if (THEME_ORDER.includes(theme)) {
        applyTheme(theme);
      }
    } catch (e) { /* ignore */ }
  }

  // ─── Shadow DOM panel creation ──────────────────────────────────
  // The panel lives entirely inside a closed Shadow DOM so that:
  //   • The host page's CSS cannot override the panel's styles.
  //   • The panel's CSS cannot leak out and break the host page.
  //   • The panel's DOM is inaccessible to page scripts (mode: 'closed').

  /**
   * Creates the side panel Shadow DOM, injects styles and HTML, and wires events.
   * Called once on first use (lazy init — not on script inject).
   */
  function createPanel() {
    const host = document.createElement('div');
    host.id = 'applicant-copilot-panel-host';
    document.body.appendChild(host);

    shadowRoot = host.attachShadow({ mode: 'closed' });
    panelRoot = host;

    const style = document.createElement('style');
    style.textContent = getPanelCSS();
    shadowRoot.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'jm-panel';
    panel.innerHTML = getPanelHTML();
    shadowRoot.appendChild(panel);

    // Wire up event listeners inside shadow DOM
    wireEvents(panel);

    // Load and apply saved theme
    loadTheme();

    return host;
  }

  /**
   * Returns the full CSS string for the side panel Shadow DOM.
   * All selectors are scoped inside the shadow root so they cannot
   * affect or be affected by the host page's stylesheet.
   * @returns {string} CSS text to inject into a <style> element.
   */
  function getPanelCSS() {
    return `
      * { margin: 0; padding: 0; box-sizing: border-box; }

      /* ── Theme CSS Variables ── */
      #jm-panel {
        --ac-primary: #3b82f6;
        --ac-primary-hover: #2563eb;
        --ac-bg: #ffffff;
        --ac-card-bg: #f8fafc;
        --ac-border: #e2e8f0;
        --ac-text: #1e293b;
        --ac-text-secondary: #64748b;
        --ac-text-muted: #94a3b8;
        --ac-tag-bg: #dbeafe;
        --ac-tag-text: #1e40af;
        --ac-hover-bg: #eff6ff;
        --ac-input-bg: #f8fafc;
        --ac-shadow: rgba(59,130,246,0.15);
        --ac-nav-inactive-bg: #f1f5f9;
        --ac-nav-inactive-text: #64748b;
      }

      #jm-panel.theme-dark {
        --ac-primary: #3b82f6;
        --ac-primary-hover: #2563eb;
        --ac-bg: #1e293b;
        --ac-card-bg: #0f172a;
        --ac-border: #334155;
        --ac-text: #f1f5f9;
        --ac-text-secondary: #cbd5e1;
        --ac-text-muted: #94a3b8;
        --ac-tag-bg: #1e3a5f;
        --ac-tag-text: #93c5fd;
        --ac-hover-bg: #334155;
        --ac-input-bg: #0f172a;
        --ac-shadow: rgba(0,0,0,0.3);
        --ac-nav-inactive-bg: #334155;
        --ac-nav-inactive-text: #94a3b8;
      }

      #jm-panel.theme-warm {
        --ac-primary: #d97706;
        --ac-primary-hover: #b45309;
        --ac-bg: #fffbf5;
        --ac-card-bg: #fefce8;
        --ac-border: #fde68a;
        --ac-text: #451a03;
        --ac-text-secondary: #92400e;
        --ac-text-muted: #a16207;
        --ac-tag-bg: #fef3c7;
        --ac-tag-text: #92400e;
        --ac-hover-bg: #fef9c3;
        --ac-input-bg: #fefce8;
        --ac-shadow: rgba(217,119,6,0.15);
        --ac-nav-inactive-bg: #fef3c7;
        --ac-nav-inactive-text: #92400e;
      }

      #jm-panel {
        position: fixed;
        top: 0;
        right: 0;
        width: 380px;
        height: 100vh;
        background: var(--ac-bg);
        box-shadow: none;
        display: flex;
        flex-direction: column;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        color: var(--ac-text);
        overflow: hidden;
        transform: translateX(100%);
        transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 2147483646;
        pointer-events: auto;
      }

      #jm-panel.open {
        transform: translateX(0);
        box-shadow: -4px 0 24px rgba(0,0,0,0.15);
      }

      .jm-header {
        background: var(--ac-primary);
        color: white;
        padding: 16px 20px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      }
      #jm-panel.theme-dark .jm-header { background: #1e3a5f !important; }
      #jm-panel.theme-warm .jm-header { background: #d97706 !important; }

      .jm-header h2 { font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 6px; margin: 0; }
      .jm-header h2 span { font-size: 40px; line-height: 1; flex-shrink: 0; }
      .jm-header .jm-title-text { display: flex; flex-direction: column; }
      .jm-header .jm-title-text .jm-subtitle { font-size: 11px; font-weight: 400; opacity: 0.8; margin-top: 2px; }

      /* Theme toggle button */
      .jm-theme-btn {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.4);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255,255,255,0.15);
        color: #fff;
        font-size: 14px;
        transition: background 0.15s;
        flex-shrink: 0;
        padding: 0;
      }
      .jm-theme-btn:hover {
        background: rgba(255,255,255,0.3);
      }
      /* subtitle is now styled via .jm-title-text .jm-subtitle */

      .jm-close {
        background: rgba(255,255,255,0.2);
        border: none;
        color: white;
        width: 28px;
        height: 28px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      .jm-close:hover { background: rgba(255,255,255,0.35); }

      .jm-nav {
        display: flex;
        background: var(--ac-bg);
        border-bottom: 1px solid var(--ac-border);
        flex-shrink: 0;
      }

      .jm-nav-btn {
        flex: 1;
        padding: 9px 0;
        border: none;
        background: none;
        font-size: 12px;
        font-weight: 500;
        color: var(--ac-nav-inactive-text);
        cursor: pointer;
        transition: color 0.2s, background 0.2s;
        font-family: inherit;
        text-align: center;
      }

      .jm-nav-btn:hover {
        color: var(--ac-primary);
        background: var(--ac-hover-bg);
      }

      .jm-nav-btn.active {
        color: var(--ac-primary);
        border-bottom: 2px solid var(--ac-primary);
        font-weight: 600;
      }

      .jm-body {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
      }

      .jm-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 20px;
      }

      .jm-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 16px;
        border: none;
        border-radius: 10px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        font-family: inherit;
      }

      .jm-btn-primary {
        background: var(--ac-primary);
        color: white;
      }
      .jm-btn-primary:hover { background: var(--ac-primary-hover); }

      .jm-btn-secondary {
        background: var(--ac-border);
        color: var(--ac-text-secondary);
      }
      .jm-btn-secondary:hover { background: var(--ac-hover-bg); }

      .jm-btn-success {
        background: #d1fae5;
        color: #059669;
      }
      .jm-btn-success:hover { background: #a7f3d0; }

      .jm-btn-applied {
        background: var(--ac-primary);
        color: white;
      }
      .jm-btn-applied:hover { background: var(--ac-primary-hover); }

      .jm-btn-applied-done {
        background: #93c5fd;
        color: #581c87;
        cursor: default;
      }

      .jm-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Status bar */
      .jm-status {
        padding: 10px 14px;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 16px;
        display: none;
      }
      .jm-status.info { display: block; background: var(--ac-tag-bg); color: var(--ac-tag-text); }
      .jm-status.error { display: block; background: #fee2e2; color: #dc2626; }
      .jm-status.success { display: block; background: #d1fae5; color: #059669; }

      /* Loading spinner */
      .jm-spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: jm-spin 0.6s linear infinite;
      }
      @keyframes jm-spin { to { transform: rotate(360deg); } }

      /* Score display */
      .jm-score-section {
        text-align: center;
        margin-bottom: 20px;
        display: none;
      }

      .jm-score-circle {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 32px;
        font-weight: 700;
        color: white;
        margin-bottom: 8px;
      }

      .jm-score-label { font-size: 13px; color: var(--ac-text-secondary); }

      .score-green { background: linear-gradient(135deg, #10b981, #059669); }
      .score-amber { background: linear-gradient(135deg, #f59e0b, #d97706); }
      .score-red { background: linear-gradient(135deg, #ef4444, #dc2626); }

      /* Skills tags */
      .jm-section {
        margin-bottom: 16px;
        display: none;
      }

      .jm-section h3 {
        font-size: 13px;
        font-weight: 600;
        color: var(--ac-text-secondary);
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .jm-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }

      .jm-tag {
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 500;
      }

      .jm-tag-match { background: #d1fae5; color: #059669; }
      .jm-tag-missing { background: #fee2e2; color: #dc2626; }
      .jm-tag-keyword { background: var(--ac-tag-bg); color: var(--ac-tag-text); }

      /* Recommendations */
      .jm-recs {
        list-style: none;
        padding: 0;
      }

      .jm-recs li {
        padding: 8px 0;
        border-bottom: 1px solid var(--ac-border);
        font-size: 13px;
        line-height: 1.5;
        color: var(--ac-text);
      }
      .jm-recs li:last-child { border-bottom: none; }

      .jm-recs li::before {
        content: '\\2192 ';
        color: var(--ac-primary);
        font-weight: 600;
      }

      /* Insights */
      .jm-insight-block {
        background: var(--ac-card-bg);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 8px;
        border: 1px solid var(--ac-border);
      }

      .jm-insight-block h4 {
        font-size: 12px;
        font-weight: 600;
        color: var(--ac-primary);
        margin-bottom: 4px;
        text-transform: uppercase;
      }

      .jm-insight-block p {
        font-size: 13px;
        color: var(--ac-text-secondary);
        line-height: 1.5;
      }

      /* Job info */
      .jm-job-info {
        background: var(--ac-card-bg);
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
        border: 1px solid var(--ac-border);
        display: none;
      }

      .jm-job-info .jm-job-title {
        font-weight: 600;
        font-size: 14px;
        color: var(--ac-text);
      }

      .jm-job-info .jm-job-company {
        font-size: 13px;
        color: var(--ac-text-secondary);
      }

      .jm-job-meta {
        display: flex;
        gap: 12px;
        margin-top: 6px;
        flex-wrap: wrap;
      }

      .jm-job-meta span {
        font-size: 12px;
        color: var(--ac-text-secondary);
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      /* Backdrop (transparent overlay to capture outside clicks) */
      .jm-backdrop {
        display: none; /* Replaced by document-level click-outside listener to avoid blocking page scroll */
      }

      /* Toggle button (outside panel) */
      .jm-toggle {
        position: fixed;
        width: 42px;
        height: 42px;
        border-radius: 50%;
        background: var(--ac-fab-bg, #3b82f6);
        color: white;
        border: none;
        cursor: grab;
        box-shadow: 0 4px 12px var(--ac-fab-shadow, rgba(59,130,246,0.4));
        font-size: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: box-shadow 0.2s, transform 0.2s;
        z-index: 2147483647;
        user-select: none;
        touch-action: none;
      }
      .jm-toggle:hover {
        transform: scale(1.1);
        box-shadow: 0 6px 16px var(--ac-fab-shadow, rgba(59,130,246,0.5));
      }
      .jm-toggle.dragging {
        cursor: grabbing;
        transform: scale(1.1);
        box-shadow: 0 8px 20px var(--ac-fab-shadow, rgba(59,130,246,0.6));
        transition: none;
      }

      /* Outline button */
      .jm-btn-outline {
        background: var(--ac-bg);
        border: 1.5px solid var(--ac-primary);
        color: var(--ac-primary);
      }
      .jm-btn-outline:hover { background: var(--ac-hover-bg); }

      /* Truncation notice */
      .jm-trunc-notice {
        font-size: 11px;
        color: #92400e;
        background: #fffbeb;
        border: 1px solid #fde68a;
        border-radius: 5px;
        padding: 6px 10px;
        margin-bottom: 10px;
        display: none;
      }

      /* AutoFill preview */
      .jm-preview-list {
        display: flex;
        flex-direction: column;
        gap: 5px;
        max-height: 240px;
        overflow-y: auto;
        margin-bottom: 4px;
      }
      .jm-preview-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 7px 8px;
        background: var(--ac-card-bg);
        border-radius: 6px;
        border: 1px solid var(--ac-border);
        font-size: 12px;
        line-height: 1.4;
      }
      .jm-preview-row input[type="checkbox"] {
        margin-top: 2px;
        flex-shrink: 0;
        accent-color: var(--ac-primary);
        width: 14px;
        height: 14px;
      }
      .jm-preview-label { font-weight: 600; color: var(--ac-text); }
      .jm-preview-val { color: var(--ac-text-secondary); word-break: break-word; }
      .jm-preview-row.jm-needs-input { background: #fffbeb; border-color: #fde68a; }
      .jm-preview-row.jm-needs-input .jm-preview-val { color: #92400e; }
      .jm-preview-actions { display: flex; gap: 8px; margin-top: 10px; }

      /* Cover letter */
      .jm-cover-letter {
        background: var(--ac-card-bg);
        border: 1px solid var(--ac-border);
        border-radius: 8px;
        padding: 12px 14px;
        font-size: 12.5px;
        line-height: 1.7;
        color: var(--ac-text);
        white-space: pre-wrap;
        max-height: 260px;
        overflow-y: auto;
        margin-bottom: 8px;
      }
      .jm-copy-btn {
        font-size: 12px;
        padding: 5px 12px;
        float: right;
        margin-top: -2px;
      }
      .jm-section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .jm-section-head h3 { margin-bottom: 0; }

      /* Bullet rewriter */
      .jm-bullet-item {
        background: var(--ac-card-bg);
        border: 1px solid var(--ac-border);
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 8px;
      }
      .jm-bullet-job {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--ac-primary);
        margin-bottom: 6px;
      }
      .jm-bullet-before {
        font-size: 12px;
        color: var(--ac-text-muted);
        text-decoration: line-through;
        margin-bottom: 4px;
        line-height: 1.5;
      }
      .jm-bullet-after {
        font-size: 12px;
        color: var(--ac-text);
        margin-bottom: 7px;
        line-height: 1.5;
      }
      .jm-bullet-copy { font-size: 11px; padding: 3px 10px; }

      /* Job notes */
      .jm-notes-section {
        border-top: 1px solid var(--ac-border);
        margin-top: 12px;
        padding-top: 12px;
      }
      .jm-notes-section h3 {
        font-size: 12px;
        font-weight: 600;
        color: var(--ac-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 6px;
      }
      .jm-notes-textarea {
        width: 100%;
        resize: vertical;
        border: 1px solid var(--ac-border);
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 12.5px;
        font-family: inherit;
        color: var(--ac-text);
        background: var(--ac-input-bg);
        min-height: 62px;
        box-sizing: border-box;
      }
      .jm-notes-textarea:focus {
        outline: none;
        border-color: var(--ac-primary);
        box-shadow: 0 0 0 2px var(--ac-shadow);
      }

      /* Resume slot switcher */
      .jm-resume-switcher {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .jm-switch-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--ac-text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        white-space: nowrap;
      }
      .jm-switch-pills {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }
      .jm-switch-pill {
        font-size: 11px;
        padding: 3px 10px;
        border-radius: 20px;
        border: 1.5px solid var(--ac-border);
        background: transparent;
        color: var(--ac-text-secondary);
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
        max-width: 90px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .jm-switch-pill:hover:not(:disabled) {
        border-color: var(--ac-primary);
        color: var(--ac-primary);
      }
      .jm-switch-pill.active {
        background: var(--ac-primary);
        border-color: transparent;
        color: white;
        font-weight: 600;
      }
      .jm-switch-pill:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      /* Saved jobs tab */
      .jm-saved-list { display: flex; flex-direction: column; gap: 8px; }
      .jm-saved-card {
        background: var(--ac-card-bg); border-radius: 8px; padding: 12px;
        position: relative; border: 1px solid var(--ac-border);
        transition: border-color 0.15s;
      }
      .jm-saved-card:hover { border-color: var(--ac-primary); }
      .jm-saved-title { font-weight: 600; font-size: 13px; color: var(--ac-text); text-decoration: none; display: block; margin-bottom: 4px; }
      .jm-saved-title:hover { color: var(--ac-primary); }
      .jm-saved-company { font-size: 12px; color: var(--ac-text-secondary); }
      .jm-saved-meta { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 11px; color: var(--ac-text-muted); }
      .jm-saved-score { padding: 2px 8px; border-radius: 4px; color: #fff; font-weight: 600; font-size: 11px; }
      .jm-saved-delete {
        position: absolute; top: 8px; right: 8px;
        background: none; border: none; cursor: pointer;
        color: var(--ac-text-muted); font-size: 16px; line-height: 1;
        transition: color 0.15s;
      }
      .jm-saved-delete:hover { color: #ef4444; }
      .jm-saved-empty { text-align: center; color: var(--ac-text-muted); font-size: 13px; padding: 32px 16px; }
      .jm-saved-applied-btn {
        font-size: 11px; padding: 2px 8px; border-radius: 4px; cursor: pointer;
        border: 1px solid var(--ac-border); background: var(--ac-card-bg); color: var(--ac-text-muted);
        transition: all 0.15s;
      }
      .jm-saved-applied-btn:hover { border-color: var(--ac-primary); color: var(--ac-primary); }
      .jm-saved-applied-btn.applied { background: #dcfce7; color: #15803d; border-color: #86efac; font-weight: 600; }
      .jm-saved-card.is-applied { border-left: 3px solid #22c55e; }
      .jm-saved-prep {
        position: absolute; top: 8px; right: 32px;
        background: var(--ac-primary); color: #fff; border: none; cursor: pointer;
        font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
        transition: opacity 0.15s;
      }
      .jm-saved-prep:hover { opacity: 0.85; }

      /* ─── Interview Prep ────────────────────────────────────── */
      .jm-prep-header {
        display: flex; align-items: center; gap: 8px; padding: 8px 0;
        border-bottom: 1px solid var(--ac-border); margin-bottom: 12px;
      }
      .jm-prep-back {
        background: none; border: none; cursor: pointer; font-size: 18px;
        color: var(--ac-text); padding: 4px; line-height: 1;
      }
      .jm-prep-back:hover { color: var(--ac-primary); }
      .jm-prep-title { font-weight: 600; font-size: 14px; color: var(--ac-text); flex: 1; }
      .jm-prep-subtitle { font-size: 12px; color: var(--ac-text-secondary); font-weight: 400; }

      .jm-prep-start { text-align: center; padding: 16px 0; }
      .jm-prep-start h3 { margin: 0 0 4px; font-size: 15px; color: var(--ac-text); }
      .jm-prep-start p { margin: 0 0 16px; font-size: 12px; color: var(--ac-text-secondary); }

      .jm-prep-categories { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-bottom: 16px; }
      .jm-prep-cat-check { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--ac-text); cursor: pointer; }
      .jm-prep-cat-check input { accent-color: var(--ac-primary); }

      .jm-prep-timer-toggle { display: flex; align-items: center; gap: 6px; justify-content: center; margin-bottom: 16px; font-size: 12px; color: var(--ac-text-secondary); }
      .jm-prep-timer-toggle input { accent-color: var(--ac-primary); }

      .jm-prep-category-pill {
        display: inline-block; padding: 2px 8px; border-radius: 10px;
        font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;
      }
      .jm-prep-pill-behavioral { background: #dbeafe; color: #1d4ed8; }
      .jm-prep-pill-technical { background: #ede9fe; color: #6d28d9; }
      .jm-prep-pill-situational { background: #ffedd5; color: #c2410c; }
      .jm-prep-pill-role-specific { background: #dcfce7; color: #15803d; }

      .jm-prep-difficulty { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 4px; }
      .jm-prep-diff-easy { background: #22c55e; }
      .jm-prep-diff-medium { background: #f59e0b; }
      .jm-prep-diff-hard { background: #ef4444; }

      .jm-prep-qlist { display: flex; flex-direction: column; gap: 6px; }
      .jm-prep-qcard {
        background: var(--ac-card-bg); border-radius: 8px; padding: 10px 12px;
        border: 1px solid var(--ac-border); cursor: pointer; transition: border-color 0.15s;
        position: relative;
      }
      .jm-prep-qcard:hover { border-color: var(--ac-primary); }
      .jm-prep-qcard.follow-up { margin-left: 20px; border-left: 3px solid var(--ac-primary); }
      .jm-prep-qcard-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
      .jm-prep-qcard-text { font-size: 13px; color: var(--ac-text); line-height: 1.4; }
      .jm-prep-qcard-status {
        position: absolute; top: 10px; right: 10px; font-size: 11px; font-weight: 600;
        padding: 2px 6px; border-radius: 4px;
      }
      .jm-prep-status-pending { background: var(--ac-border); color: var(--ac-text-muted); }
      .jm-prep-status-scored { color: #fff; }

      .jm-prep-qlist-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .jm-prep-qlist-title { font-size: 13px; font-weight: 600; color: var(--ac-text); }

      /* Timer */
      .jm-prep-timer {
        font-size: 28px; font-weight: 700; text-align: center; margin: 8px 0;
        font-variant-numeric: tabular-nums; color: #22c55e; transition: color 0.3s;
      }
      .jm-prep-timer.warning { color: #f59e0b; }
      .jm-prep-timer.critical { color: #ef4444; }
      .jm-prep-timer.flash { animation: timerFlash 0.5s ease-in-out infinite alternate; }
      @keyframes timerFlash { from { opacity: 1; } to { opacity: 0.3; } }

      .jm-prep-timer-controls { display: flex; justify-content: center; gap: 8px; margin-bottom: 8px; }
      .jm-prep-timer-btn {
        background: var(--ac-card-bg); border: 1px solid var(--ac-border); border-radius: 4px;
        padding: 2px 10px; font-size: 11px; cursor: pointer; color: var(--ac-text);
      }
      .jm-prep-timer-btn:hover { border-color: var(--ac-primary); }

      .jm-prep-question-display { font-size: 14px; font-weight: 500; color: var(--ac-text); line-height: 1.5; margin-bottom: 8px; }
      .jm-prep-hints {
        background: var(--ac-card-bg); border: 1px solid var(--ac-border); border-radius: 6px;
        padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: var(--ac-text-secondary);
      }
      .jm-prep-hints summary { cursor: pointer; font-weight: 600; color: var(--ac-text); }
      .jm-prep-hints ul { margin: 6px 0 0; padding-left: 16px; }
      .jm-prep-hints li { margin-bottom: 3px; }

      .jm-prep-textarea {
        width: 100%; min-height: 100px; max-height: 250px; resize: vertical;
        border: 1px solid var(--ac-border); border-radius: 6px; padding: 8px;
        font-size: 13px; font-family: inherit; color: var(--ac-text);
        background: var(--ac-card-bg); box-sizing: border-box;
      }
      .jm-prep-textarea:focus { outline: none; border-color: var(--ac-primary); }
      .jm-prep-wordcount { font-size: 11px; color: var(--ac-text-muted); text-align: right; margin-top: 4px; }

      /* Feedback */
      .jm-prep-score-circle {
        width: 56px; height: 56px; border-radius: 50%; display: flex;
        align-items: center; justify-content: center; font-size: 20px; font-weight: 700;
        color: #fff; margin: 0 auto 8px;
      }
      .jm-prep-score-low { background: #ef4444; }
      .jm-prep-score-mid { background: #f59e0b; }
      .jm-prep-score-high { background: #22c55e; }
      .jm-prep-time-badge { text-align: center; font-size: 11px; color: var(--ac-text-muted); margin-bottom: 12px; }

      .jm-prep-feedback-section { margin-bottom: 10px; }
      .jm-prep-feedback-label { font-size: 12px; font-weight: 600; color: var(--ac-text); margin-bottom: 4px; }
      .jm-prep-feedback-list { list-style: none; padding: 0; margin: 0; }
      .jm-prep-feedback-list li { font-size: 12px; color: var(--ac-text-secondary); padding: 2px 0; padding-left: 16px; position: relative; }
      .jm-prep-feedback-list li::before { position: absolute; left: 0; }
      .jm-prep-feedback-list.strengths li::before { content: "\\2713"; color: #22c55e; }
      .jm-prep-feedback-list.improvements li::before { content: "\\2192"; color: #f59e0b; }

      .jm-prep-sample-answer { margin-top: 8px; }
      .jm-prep-sample-answer summary { font-size: 12px; font-weight: 600; color: var(--ac-primary); cursor: pointer; }
      .jm-prep-sample-answer p { font-size: 12px; color: var(--ac-text-secondary); line-height: 1.5; margin: 6px 0 0; }

      .jm-prep-followup-banner {
        background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px;
        padding: 10px 12px; margin-top: 10px; text-align: center;
      }
      .jm-prep-followup-banner p { font-size: 12px; color: #92400e; margin: 0 0 8px; }

      .jm-prep-action-row { display: flex; gap: 8px; justify-content: center; margin-top: 12px; }

      /* Analytics */
      .jm-prep-analytics-grid { display: flex; flex-direction: column; gap: 12px; }
      .jm-prep-stat-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--ac-text-secondary); }
      .jm-prep-stat-value { font-weight: 600; color: var(--ac-text); }
      .jm-prep-bar-container { margin-bottom: 8px; }
      .jm-prep-bar-label { display: flex; justify-content: space-between; font-size: 11px; color: var(--ac-text-secondary); margin-bottom: 3px; }
      .jm-prep-bar-track { height: 8px; background: var(--ac-border); border-radius: 4px; overflow: hidden; }
      .jm-prep-bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
      .jm-prep-weak-list { list-style: disc; padding-left: 16px; margin: 0; }
      .jm-prep-weak-list li { font-size: 12px; color: var(--ac-text-secondary); margin-bottom: 3px; }

      /* Tab content visibility */
      .jm-tab-content { display: none; }
      .jm-tab-content.active { display: block; }

      /* ─── Ask AI Chat ─────────────────────────────────────── */
      .jm-chat-container {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 130px);
        max-height: 600px;
      }
      .jm-chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid var(--ac-border);
        margin-bottom: 8px;
      }
      .jm-chat-context {
        font-size: 12px;
        color: var(--ac-text-secondary);
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .jm-chat-clear {
        background: none;
        border: none;
        cursor: pointer;
        font-size: 14px;
        color: var(--ac-text-muted);
        padding: 4px 6px;
        border-radius: 4px;
        transition: color 0.15s, background 0.15s;
        min-width: 32px;
        min-height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .jm-chat-clear:hover { color: #ef4444; background: var(--ac-hover-bg); }

      .jm-chat-messages {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 4px 0;
        min-height: 0;
      }

      /* Empty states */
      .jm-chat-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        padding: 32px 16px;
        gap: 12px;
        flex: 1;
      }
      .jm-chat-empty-icon { font-size: 36px; }
      .jm-chat-empty-title { font-size: 15px; font-weight: 600; color: var(--ac-text); }
      .jm-chat-empty-text { font-size: 13px; color: var(--ac-text-secondary); line-height: 1.5; }
      .jm-chat-analyze-btn { margin-top: 8px; padding: 10px 24px; font-size: 13px; }

      /* Suggestion chips */
      .jm-chat-chips {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        width: 100%;
        max-width: 280px;
      }
      .jm-chat-chip {
        padding: 10px 12px;
        border: 1px solid var(--ac-border);
        border-radius: 10px;
        background: var(--ac-bg);
        color: var(--ac-text);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
        min-height: 44px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .jm-chat-chip:hover {
        border-color: var(--ac-primary);
        color: var(--ac-primary);
        background: var(--ac-hover-bg);
      }

      /* Resume instruction chips */
      .jm-resume-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .jm-resume-chip {
        padding: 5px 10px;
        border: 1px solid var(--ac-border);
        border-radius: 16px;
        background: var(--ac-bg);
        color: var(--ac-text-secondary);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
      }
      .jm-resume-chip:hover {
        border-color: var(--ac-primary);
        color: var(--ac-primary);
        background: var(--ac-hover-bg);
      }
      .jm-resume-chip.selected {
        border-color: var(--ac-primary);
        background: var(--ac-primary);
        color: #fff;
      }

      /* Resume result section */
      .jm-resume-result-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
      }
      .jm-resume-result-badge {
        font-size: 13px;
        font-weight: 600;
        color: #059669;
      }
      .jm-resume-result-meta {
        font-size: 11px;
        color: var(--ac-text-muted);
      }
      .jm-resume-mini-preview {
        position: relative;
        border: 1px solid var(--ac-border);
        border-radius: 10px;
        overflow: hidden;
        max-height: 200px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .jm-resume-mini-preview:hover, .jm-resume-mini-preview:focus {
        border-color: var(--ac-primary);
        box-shadow: 0 0 0 2px var(--ac-shadow);
      }
      .jm-resume-mini-content {
        padding: 12px 14px;
        font-size: 8px;
        line-height: 1.4;
        color: var(--ac-text);
        pointer-events: none;
        transform-origin: top left;
      }
      .jm-resume-mini-content h1 { font-size: 14px; margin: 0 0 2px 0; }
      .jm-resume-mini-content h2 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 3px 0; border-bottom: 1px solid var(--ac-border); padding-bottom: 2px; }
      .jm-resume-mini-content h3 { font-size: 8px; font-weight: 600; margin: 4px 0 1px 0; }
      .jm-resume-mini-content p { margin: 1px 0; }
      .jm-resume-mini-content ul { margin: 2px 0; padding-left: 12px; }
      .jm-resume-mini-content li { margin: 1px 0; }
      .jm-resume-mini-fade {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 50px;
        background: linear-gradient(transparent, var(--ac-bg));
        display: flex;
        align-items: flex-end;
        justify-content: center;
        padding-bottom: 8px;
      }
      .jm-resume-mini-fade span {
        font-size: 11px;
        font-weight: 500;
        color: var(--ac-primary);
      }
      .jm-resume-actions {
        display: flex;
        gap: 8px;
        margin-bottom: 8px;
      }
      .jm-resume-redo {
        width: 100%;
        font-size: 12px;
        color: var(--ac-text-secondary);
        border: 1px dashed var(--ac-border);
        background: none;
      }
      .jm-resume-redo:hover {
        border-color: var(--ac-primary);
        color: var(--ac-primary);
      }

      /* Message bubbles */
      .jm-chat-bubble {
        max-width: 85%;
        padding: 10px 14px;
        border-radius: 14px;
        font-size: 13px;
        line-height: 1.5;
        word-wrap: break-word;
        overflow-wrap: break-word;
        position: relative;
      }
      .jm-chat-user {
        align-self: flex-end;
        background: var(--ac-primary);
        color: #fff;
        border-bottom-right-radius: 4px;
      }
      .jm-chat-assistant {
        align-self: flex-start;
        background: var(--ac-hover-bg, #f3f4f6);
        color: var(--ac-text);
        border-bottom-left-radius: 4px;
      }
      .jm-chat-error {
        align-self: flex-start;
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #fecaca;
        border-bottom-left-radius: 4px;
      }
      .jm-chat-bubble-text { white-space: pre-wrap; }
      .jm-chat-copy, .jm-chat-retry {
        background: none;
        border: none;
        font-size: 11px;
        cursor: pointer;
        padding: 2px 6px;
        margin-top: 6px;
        border-radius: 4px;
        font-family: inherit;
        transition: background 0.15s;
      }
      .jm-chat-copy { color: var(--ac-text-muted); }
      .jm-chat-copy:hover { background: rgba(0,0,0,0.05); color: var(--ac-text); }
      .jm-chat-retry { color: #991b1b; font-weight: 500; }
      .jm-chat-retry:hover { background: #fee2e2; }

      /* Typing indicator */
      .jm-chat-typing {
        align-self: flex-start;
        display: flex;
        gap: 4px;
        padding: 12px 16px;
        background: var(--ac-hover-bg, #f3f4f6);
        border-radius: 14px;
        border-bottom-left-radius: 4px;
      }
      .jm-chat-typing span {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--ac-text-muted);
        animation: jm-typing-dot 1.4s infinite ease-in-out;
      }
      .jm-chat-typing span:nth-child(2) { animation-delay: 0.2s; }
      .jm-chat-typing span:nth-child(3) { animation-delay: 0.4s; }
      @keyframes jm-typing-dot {
        0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
        40% { opacity: 1; transform: scale(1); }
      }

      /* Input area */
      .jm-chat-input-row {
        display: flex;
        align-items: flex-end;
        gap: 8px;
        padding: 10px 0 0;
        border-top: 1px solid var(--ac-border);
        margin-top: auto;
      }
      .jm-chat-input {
        flex: 1;
        padding: 10px 12px;
        border: 1px solid var(--ac-border);
        border-radius: 10px;
        font-size: 13px;
        font-family: inherit;
        resize: none;
        max-height: 80px;
        overflow-y: auto;
        background: var(--ac-bg);
        color: var(--ac-text);
        line-height: 1.4;
      }
      .jm-chat-input:focus { outline: none; border-color: var(--ac-primary); }
      .jm-chat-input:disabled { opacity: 0.5; }
      .jm-chat-send {
        width: 40px;
        height: 40px;
        min-width: 40px;
        border: none;
        border-radius: 10px;
        background: var(--ac-primary);
        color: #fff;
        font-size: 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
      }
      .jm-chat-send:hover { background: var(--ac-primary-hover); }
      .jm-chat-send:disabled { opacity: 0.5; cursor: default; }

      @media (max-width: 500px) {
        #jm-panel { width: 100vw !important; }
        .jm-body { padding: 12px !important; }
      }
    `;
  }

  /**
   * Returns the static inner HTML string for the side panel.
   * Sections that are initially hidden (display:none) are shown
   * programmatically after analysis / autofill completes.
   * @returns {string} HTML markup for the panel body.
   */
  function getPanelHTML() {
    return `
      <div class="jm-header">
        <h2>
          <span>&#9733;</span>
          <div class="jm-title-text">
            Applicant Copilot
            <span class="jm-subtitle">Resume & Job Analyzer</span>
          </div>
        </h2>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="jm-theme-btn" id="jmThemeToggle" title="Switch theme">&#9728;&#65039;</button>
        </div>
      </div>
      <div class="jm-nav">
        <button class="jm-nav-btn active" data-nav="home">Home</button>
        <button class="jm-nav-btn" data-nav="ask-ai">Ask AI</button>
        <button class="jm-nav-btn" data-nav="saved">Saved</button>
        <button class="jm-nav-btn" data-nav="profile">Profile</button>
        <button class="jm-nav-btn" data-nav="settings">Settings</button>
      </div>
      <div class="jm-body">
        <!-- Saved Jobs tab -->
        <div class="jm-tab-content" id="jmSavedTab">
          <div class="jm-saved-list" id="jmSavedList">
            <div class="jm-saved-empty" id="jmSavedEmpty">No saved jobs yet. Click 'Save Job' on any job posting to bookmark it.</div>
          </div>
        </div>

        <!-- Interview Prep tab (sub-view of Saved) -->
        <div class="jm-tab-content" id="jmInterviewPrepTab">
          <div class="jm-prep-header">
            <button class="jm-prep-back" id="jmPrepBack" aria-label="Back to Saved Jobs">&#8592;</button>
            <div>
              <div class="jm-prep-title" id="jmPrepTitle"></div>
              <div class="jm-prep-subtitle" id="jmPrepSubtitle"></div>
            </div>
          </div>

          <!-- Start screen -->
          <div id="jmPrepStart" class="jm-prep-start">
            <h3>Interview Prep</h3>
            <p>Practice with AI-generated questions tailored to this role</p>
            <div class="jm-prep-categories" id="jmPrepCategories">
              <label class="jm-prep-cat-check"><input type="checkbox" value="behavioral" checked> Behavioral</label>
              <label class="jm-prep-cat-check"><input type="checkbox" value="technical" checked> Technical</label>
              <label class="jm-prep-cat-check"><input type="checkbox" value="situational" checked> Situational</label>
              <label class="jm-prep-cat-check"><input type="checkbox" value="role-specific" checked> Role-Specific</label>
            </div>
            <div class="jm-prep-timer-toggle">
              <label><input type="checkbox" id="jmPrepTimerEnabled" checked> Enable countdown timer</label>
            </div>
            <button class="jm-btn jm-btn-primary" id="jmPrepGenerateBtn">Generate Questions</button>
          </div>

          <!-- Question list -->
          <div id="jmPrepQuestionList" style="display:none">
            <div class="jm-prep-qlist-header">
              <span class="jm-prep-qlist-title" id="jmPrepQCount"></span>
              <button class="jm-btn jm-btn-sm" id="jmPrepAnalyticsBtn" disabled>View Analytics</button>
            </div>
            <div class="jm-prep-qlist" id="jmPrepQList"></div>
          </div>

          <!-- Answer view -->
          <div id="jmPrepAnswerView" style="display:none">
            <div class="jm-prep-qcard-header" id="jmPrepAnsHeader"></div>
            <div class="jm-prep-question-display" id="jmPrepAnsQuestion"></div>
            <div class="jm-prep-timer" id="jmPrepTimer" style="display:none">2:00</div>
            <div class="jm-prep-timer-controls" id="jmPrepTimerControls" style="display:none">
              <button class="jm-prep-timer-btn" id="jmPrepTimerPause">Pause</button>
            </div>
            <details class="jm-prep-hints" id="jmPrepHints">
              <summary>Hints (key points to cover)</summary>
              <ul id="jmPrepHintsList"></ul>
            </details>
            <textarea class="jm-prep-textarea" id="jmPrepAnswerInput" placeholder="Type your answer here..."></textarea>
            <div class="jm-prep-wordcount" id="jmPrepWordCount">0 words</div>
            <div class="jm-prep-action-row">
              <button class="jm-btn" id="jmPrepBackToList">Back</button>
              <button class="jm-btn jm-btn-primary" id="jmPrepSubmitAnswer">Submit Answer</button>
            </div>
          </div>

          <!-- Feedback view -->
          <div id="jmPrepFeedbackView" style="display:none">
            <div class="jm-prep-score-circle" id="jmPrepScoreCircle"></div>
            <div class="jm-prep-time-badge" id="jmPrepTimeBadge"></div>
            <div class="jm-prep-feedback-section" id="jmPrepStrengths">
              <div class="jm-prep-feedback-label">Strengths</div>
              <ul class="jm-prep-feedback-list strengths" id="jmPrepStrengthsList"></ul>
            </div>
            <div class="jm-prep-feedback-section" id="jmPrepImprovements">
              <div class="jm-prep-feedback-label">Areas to Improve</div>
              <ul class="jm-prep-feedback-list improvements" id="jmPrepImprovementsList"></ul>
            </div>
            <details class="jm-prep-sample-answer">
              <summary>View Sample Answer</summary>
              <p id="jmPrepSampleAnswer"></p>
            </details>
            <div class="jm-prep-followup-banner" id="jmPrepFollowUpBanner" style="display:none">
              <p>This area needs more practice. Try a follow-up question.</p>
              <button class="jm-btn jm-btn-primary jm-btn-sm" id="jmPrepFollowUpBtn">Practice Follow-Up</button>
            </div>
            <div class="jm-prep-action-row">
              <button class="jm-btn" id="jmPrepTryAgain">Try Again</button>
              <button class="jm-btn jm-btn-primary" id="jmPrepNextQuestion">Next Question</button>
            </div>
          </div>

          <!-- Analytics summary -->
          <div id="jmPrepAnalyticsView" style="display:none">
            <div class="jm-prep-score-circle" id="jmPrepReadinessCircle" style="width:72px;height:72px;font-size:26px;"></div>
            <div style="text-align:center;font-size:12px;color:var(--ac-text-secondary);margin-bottom:12px;">Interview Readiness</div>
            <div class="jm-prep-analytics-grid">
              <div>
                <div class="jm-prep-feedback-label">Category Scores</div>
                <div id="jmPrepCategoryBars"></div>
              </div>
              <div>
                <div class="jm-prep-stat-row"><span>Questions answered</span><span class="jm-prep-stat-value" id="jmPrepStatAnswered">0</span></div>
                <div class="jm-prep-stat-row"><span>Avg. time per answer</span><span class="jm-prep-stat-value" id="jmPrepStatAvgTime">--</span></div>
                <div class="jm-prep-stat-row"><span>Follow-ups generated</span><span class="jm-prep-stat-value" id="jmPrepStatFollowUps">0</span></div>
              </div>
              <div id="jmPrepWeakAreasSection">
                <div class="jm-prep-feedback-label">Weak Areas</div>
                <ul class="jm-prep-weak-list" id="jmPrepWeakAreasList"></ul>
              </div>
              <div class="jm-prep-action-row">
                <button class="jm-btn" id="jmPrepAnalyticsBack">Back to Questions</button>
                <button class="jm-btn jm-btn-primary" id="jmPrepPositioningBtn" disabled>Generate Positioning Advice</button>
              </div>
              <div id="jmPrepPositioningAdvice" style="display:none">
                <div class="jm-prep-feedback-label">Positioning Strategy</div>
                <div id="jmPrepPositioningContent" style="font-size:12px;color:var(--ac-text-secondary);line-height:1.6;white-space:pre-wrap;"></div>
              </div>
              <div class="jm-prep-action-row" id="jmPrepReportRow" style="display:none">
                <button class="jm-btn jm-btn-primary" id="jmPrepFullReportBtn">View Full Report</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Ask AI chat tab -->
        <div class="jm-tab-content" id="jmAskAiTab">
          <div class="jm-chat-container">
            <!-- Context badge — visible when analysis exists -->
            <div class="jm-chat-header" id="jmChatHeader" style="display:none">
              <span class="jm-chat-context" id="jmChatContext"></span>
              <button class="jm-chat-clear" id="jmChatClear" aria-label="Clear conversation" title="Clear conversation">&#128465;</button>
            </div>
            <!-- Messages area -->
            <div class="jm-chat-messages" id="jmChatMessages" role="log" aria-live="polite" aria-label="Chat messages">
              <!-- Empty state: no analysis -->
              <div class="jm-chat-empty" id="jmChatEmptyNoAnalysis">
                <div class="jm-chat-empty-icon">&#128172;</div>
                <div class="jm-chat-empty-title">Analyze a job first</div>
                <div class="jm-chat-empty-text">I'll have full context of the JD and your profile to help you.</div>
                <button class="jm-btn jm-btn-primary jm-chat-analyze-btn" id="jmChatAnalyzeBtn">Analyze Job</button>
              </div>
              <!-- Empty state: analysis done, no messages -->
              <div class="jm-chat-empty" id="jmChatEmptyReady" style="display:none">
                <div class="jm-chat-empty-text">I know this role and your profile. Ask me anything.</div>
                <div class="jm-chat-chips" id="jmChatChips">
                  <button class="jm-chat-chip" aria-label="Ask: Am I a good fit for this role?">Am I a good fit?</button>
                  <button class="jm-chat-chip" aria-label="Ask: Help me prepare for the interview">Interview prep</button>
                  <button class="jm-chat-chip" aria-label="Ask: Tell me about this company">Company research</button>
                  <button class="jm-chat-chip" aria-label="Ask: What should I highlight from my experience?">What to highlight?</button>
                </div>
              </div>
            </div>
            <!-- Input area — sticky bottom -->
            <div class="jm-chat-input-row" id="jmChatInputRow" style="display:none">
              <textarea class="jm-chat-input" id="jmChatInput" placeholder="Ask anything..." rows="1" aria-label="Chat message input"></textarea>
              <button class="jm-chat-send" id="jmChatSend" aria-label="Send message" title="Send">&#10148;</button>
            </div>
          </div>
        </div>

        <!-- Main content (default) -->
        <div class="jm-tab-content active" id="jmMainTab">
        <div class="jm-status" id="jmStatus"></div>

        <div class="jm-job-info" id="jmJobInfo">
          <div class="jm-job-title" id="jmJobTitle"></div>
          <div class="jm-job-company" id="jmJobCompany"></div>
          <div class="jm-job-meta">
            <span id="jmJobLocation" style="display:none">&#128205; <span id="jmJobLocationText"></span></span>
            <span id="jmJobSalary" style="display:none">&#128176; <span id="jmJobSalaryText"></span></span>
          </div>
        </div>

        <!-- Resume slot switcher -->
        <div class="jm-resume-switcher" id="jmResumeSwitch">
          <span class="jm-switch-label">Resume:</span>
          <div class="jm-switch-pills" id="jmSwitchPills"></div>
        </div>

        <div class="jm-actions">
          <button class="jm-btn jm-btn-primary" id="jmAnalyze">Analyze Job</button>
          <button class="jm-btn jm-btn-secondary" id="jmAutofill">AutoFill Application</button>
          <button class="jm-btn jm-btn-success" id="jmSaveJob" style="display:none">Save Job</button>
          <button class="jm-btn jm-btn-applied" id="jmMarkApplied" style="display:none">Mark as Applied</button>
          <button class="jm-btn jm-btn-outline" id="jmCoverLetterBtn" style="display:none">&#9993; Cover Letter</button>
          <button class="jm-btn jm-btn-outline" id="jmGenerateResumeBtn" style="display:none">&#128196; ATS Resume</button>
        </div>

        <div class="jm-score-section" id="jmScoreSection">
          <div class="jm-score-circle" id="jmScoreCircle">--</div>
          <div class="jm-score-label">Match Score</div>
        </div>

        <div class="jm-section" id="jmMatchingSection">
          <h3>Matching Skills</h3>
          <div class="jm-tags" id="jmMatchingSkills"></div>
        </div>

        <div class="jm-section" id="jmMissingSection">
          <h3>Missing Skills</h3>
          <div class="jm-tags" id="jmMissingSkills"></div>
        </div>

        <div class="jm-section" id="jmRecsSection">
          <h3>Recommendations</h3>
          <ul class="jm-recs" id="jmRecs"></ul>
        </div>

        <div class="jm-section" id="jmInsightsSection">
          <h3>Insights</h3>
          <div id="jmInsights"></div>
        </div>

        <div class="jm-section" id="jmKeywordsSection">
          <h3>ATS Keywords</h3>
          <div class="jm-tags" id="jmKeywords"></div>
        </div>

        <!-- Truncation notice -->
        <div class="jm-trunc-notice" id="jmTruncNotice">
          &#9888; Job description was too long and was trimmed — match score may be approximate.
        </div>
        <div class="jm-trunc-notice" id="jmResumeTruncNotice">
          &#9888; Note: Your resume was truncated for analysis. Consider shortening it for better results.
        </div>

        <!-- AutoFill preview -->
        <div class="jm-section" id="jmAutofillPreview" style="display:none">
          <h3>Review Autofill <span id="jmPreviewCount" style="font-weight:400;color:var(--ac-text-secondary);text-transform:none;letter-spacing:0"></span></h3>
          <div class="jm-preview-list" id="jmPreviewList"></div>
          <div class="jm-preview-actions">
            <button class="jm-btn jm-btn-primary" id="jmApplyFill" style="flex:1">Apply Selected</button>
            <button class="jm-btn jm-btn-secondary" id="jmCancelFill">Cancel</button>
          </div>
        </div>

        <!-- Cover letter output -->
        <div class="jm-section" id="jmCoverLetterSection" style="display:none">
          <div class="jm-section-head">
            <h3>Cover Letter</h3>
            <button class="jm-btn jm-btn-secondary jm-copy-btn" id="jmCopyCoverLetter">Copy</button>
          </div>
          <div class="jm-cover-letter" id="jmCoverLetterText"></div>
        </div>

        <!-- ATS Resume generator -->
        <div class="jm-section" id="jmResumeSection" style="display:none">
          <!-- Build phase — instructions + generate -->
          <div id="jmResumeBuild">
            <div class="jm-section-head">
              <h3>ATS-Optimized Resume</h3>
              <span style="font-size:11px;background:#059669;color:#fff;padding:2px 8px;border-radius:10px;">90+ ATS</span>
            </div>
            <div style="margin-bottom:8px;">
              <div style="font-size:11px;color:var(--ac-text-secondary);margin-bottom:6px;">Tailor your resume (click to add):</div>
              <div class="jm-resume-chips" id="jmResumeChips">
                <button class="jm-resume-chip" data-instruction="Emphasize leadership and team management">Leadership</button>
                <button class="jm-resume-chip" data-instruction="Highlight technical skills and programming experience">Technical</button>
                <button class="jm-resume-chip" data-instruction="Focus on quantified achievements and metrics">Metrics</button>
                <button class="jm-resume-chip" data-instruction="Rewrite bullets to match JD keywords exactly">Match JD</button>
                <button class="jm-resume-chip" data-instruction="Condense to fit 1 page — prioritize recent and relevant experience only">Fit 1 Page</button>
                <button class="jm-resume-chip" data-instruction="Emphasize cross-functional collaboration and stakeholder management">Cross-functional</button>
              </div>
            </div>
            <div style="margin-bottom:10px;">
              <textarea class="jm-notes-textarea" id="jmResumeInstructions" placeholder="Add your own: e.g. 'Remove internship from 2019', 'Add AWS cert', 'Emphasize Python + ML'..." style="min-height:50px;font-size:12px;"></textarea>
            </div>
            <button class="jm-btn jm-btn-primary" id="jmDoGenerateResume" style="width:100%;">&#10024; Generate Resume</button>
          </div>

          <!-- Result phase — preview + actions -->
          <div id="jmResumeResult" style="display:none;">
            <div class="jm-resume-result-header">
              <span class="jm-resume-result-badge">&#9989; Resume ready</span>
              <span class="jm-resume-result-meta" id="jmResumeResultMeta"></span>
            </div>

            <!-- Mini rendered preview (click to open full) -->
            <div class="jm-resume-mini-preview" id="jmResumeMiniPreview" role="button" tabindex="0" aria-label="Click to open full resume preview">
              <div class="jm-resume-mini-content" id="jmResumeMiniContent"></div>
              <div class="jm-resume-mini-fade">
                <span>Click to open full preview &#8599;</span>
              </div>
            </div>

            <!-- Action buttons -->
            <div class="jm-resume-actions">
              <button class="jm-btn jm-btn-primary" id="jmOpenResumePreview" style="flex:2;">&#128196; Open Full Preview</button>
              <button class="jm-btn jm-btn-secondary" id="jmCopyResume" style="flex:1;">Copy</button>
            </div>
            <button class="jm-btn jm-btn-outline jm-resume-redo" id="jmRedoResume">&#128260; Regenerate with changes</button>

            <!-- Hidden raw markdown storage -->
            <div id="jmResumeText" style="display:none;"></div>
          </div>
        </div>

        <!-- Job notes (always visible) -->
        <div class="jm-notes-section">
          <h3>Notes</h3>
          <textarea class="jm-notes-textarea" id="jmNotesInput" placeholder="Add notes about this job — saved automatically..."></textarea>
        </div>
        </div><!-- end jmMainTab -->
      </div>
    `;
  }

  /**
   * Attaches all button click listeners and tab-switch handlers to the panel.
   * Called once after the panel HTML is injected into the Shadow DOM.
   * @param {HTMLElement} panel - The #jm-panel element inside the Shadow DOM.
   */
  function wireEvents(panel) {
    panel.querySelector('#jmAnalyze').addEventListener('click', () => {
      const btn = shadowRoot.getElementById('jmAnalyze');
      // If button says "Re-Analyze", force refresh; otherwise use cache
      const forceRefresh = btn.textContent.trim() === 'Re-Analyze';
      analyzeJob(forceRefresh);
    });
    panel.querySelector('#jmAutofill').addEventListener('click', autofillForm);
    panel.querySelector('#jmSaveJob').addEventListener('click', saveJob);

    panel.querySelector('#jmMarkApplied').addEventListener('click', markApplied);
    panel.querySelector('#jmCoverLetterBtn').addEventListener('click', generateCoverLetter);
    panel.querySelector('#jmGenerateResumeBtn').addEventListener('click', () => {
      const section = shadowRoot.getElementById('jmResumeSection');
      if (section.style.display === 'none') {
        section.style.display = 'block';
        // Always show build view when opening from button
        shadowRoot.getElementById('jmResumeBuild').style.display = 'block';
        scrollPanelTo(section);
      } else {
        section.style.display = 'none';
      }
    });
    panel.querySelector('#jmDoGenerateResume').addEventListener('click', generateATSResume);

    // Resume instruction chip clicks — toggle chip and append/remove instruction
    panel.querySelectorAll('.jm-resume-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const textarea = shadowRoot.getElementById('jmResumeInstructions');
        const instruction = chip.dataset.instruction;
        if (!textarea || !instruction) return;
        const current = textarea.value;
        if (chip.classList.contains('selected')) {
          chip.classList.remove('selected');
          textarea.value = current.replace(instruction, '').replace(/\.\s*\./g, '.').replace(/^\.\s*/, '').replace(/\s*\.\s*$/, '').trim();
        } else {
          chip.classList.add('selected');
          textarea.value = current ? current + '. ' + instruction : instruction;
        }
      });
    });

    // Open full preview in a new tab (with download/print buttons built in)
    const openPreviewHandler = () => {
      const resumeMarkdown = shadowRoot.getElementById('jmResumeText').textContent;
      if (!resumeMarkdown) return;
      openResumePreviewTab(resumeMarkdown);
    };
    panel.querySelector('#jmOpenResumePreview').addEventListener('click', openPreviewHandler);
    panel.querySelector('#jmResumeMiniPreview').addEventListener('click', openPreviewHandler);
    panel.querySelector('#jmResumeMiniPreview').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreviewHandler(); }
    });

    // Copy resume text
    panel.querySelector('#jmCopyResume').addEventListener('click', () => {
      const text = shadowRoot.getElementById('jmResumeText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = shadowRoot.getElementById('jmCopyResume');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }).catch(() => {});
    });

    // Redo — switch back to build view so user can tweak instructions
    panel.querySelector('#jmRedoResume').addEventListener('click', () => {
      shadowRoot.getElementById('jmResumeResult').style.display = 'none';
      shadowRoot.getElementById('jmResumeBuild').style.display = 'block';
      scrollPanelTo(shadowRoot.getElementById('jmResumeBuild'));
    });
    panel.querySelector('#jmApplyFill').addEventListener('click', applyAutofill);
    panel.querySelector('#jmCancelFill').addEventListener('click', cancelAutofill);
    panel.querySelector('#jmCopyCoverLetter').addEventListener('click', () => {
      const text = shadowRoot.getElementById('jmCoverLetterText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = shadowRoot.getElementById('jmCopyCoverLetter');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {});
    });
    panel.querySelector('#jmNotesInput').addEventListener('blur', saveJobNotes);
    let _notesDebounce = null;
    panel.querySelector('#jmNotesInput').addEventListener('input', () => {
      clearTimeout(_notesDebounce);
      _notesDebounce = setTimeout(saveJobNotes, 800);
    });

    // Theme toggle button
    panel.querySelector('#jmThemeToggle').addEventListener('click', cycleTheme);

    // Nav buttons — Home and in-panel tabs stay in panel; Profile/Settings open profile page
    panel.querySelectorAll('.jm-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.nav;
        // Always deactivate interview prep when switching tabs
        deactivateInterviewPrep();
        if (tab === 'home') {
          deactivateSavedTab();
          deactivateAskAiTab();
          // Highlight Home nav button
          shadowRoot.querySelectorAll('.jm-nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.nav === 'home');
          });
        } else if (tab === 'saved') {
          deactivateAskAiTab();
          activateSavedTab();
        } else if (tab === 'ask-ai') {
          deactivateSavedTab();
          activateAskAiTab();
        } else {
          // Profile and Settings open in a new tab
          chrome.runtime.sendMessage({ type: 'OPEN_PROFILE_TAB', hash: tab });
        }
      });
    });

    // ── Ask AI chat listeners ──────────────────────────────────────────
    const chatInput = panel.querySelector('#jmChatInput');
    const chatSend = panel.querySelector('#jmChatSend');
    const chatAnalyze = panel.querySelector('#jmChatAnalyzeBtn');
    const chatClear = panel.querySelector('#jmChatClear');

    // Send on button click
    if (chatSend) {
      chatSend.addEventListener('click', () => {
        if (chatInput) {
          sendChatMessage(chatInput.value);
          chatInput.value = '';
          chatInput.style.height = 'auto';
        }
      });
    }

    // Send on Enter (Shift+Enter for newline), auto-grow textarea
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage(chatInput.value);
          chatInput.value = '';
          chatInput.style.height = 'auto';
        }
      });
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
      });
    }

    // "Analyze Job" button inside empty state — triggers analysis then refreshes chat
    if (chatAnalyze) {
      chatAnalyze.addEventListener('click', () => {
        deactivateAskAiTab();
        analyzeJob(false);
      });
    }

    // Clear chat
    if (chatClear) {
      chatClear.addEventListener('click', () => {
        if (confirm('Clear this conversation?')) {
          clearChat();
        }
      });
    }

    // Suggestion chip clicks → send as message
    panel.querySelectorAll('.jm-chat-chip').forEach(chip => {
      const CHIP_MESSAGES = {
        'Am I a good fit?': 'Am I a good fit for this role?',
        'Interview prep': 'Help me prepare for the interview',
        'Company research': 'Tell me about this company',
        'What to highlight?': 'What should I highlight from my experience?'
      };
      chip.addEventListener('click', () => {
        const fullMessage = CHIP_MESSAGES[chip.textContent] || chip.textContent;
        sendChatMessage(fullMessage);
      });
    });

    // ── Interview Prep listeners ──────────────────────────────────────
    const prepBack = panel.querySelector('#jmPrepBack');
    if (prepBack) prepBack.addEventListener('click', () => deactivateInterviewPrep(true));

    const prepGenBtn = panel.querySelector('#jmPrepGenerateBtn');
    if (prepGenBtn) prepGenBtn.addEventListener('click', handleGeneratePrepQuestions);

    const prepSubmitBtn = panel.querySelector('#jmPrepSubmitAnswer');
    if (prepSubmitBtn) prepSubmitBtn.addEventListener('click', submitCurrentAnswer);

    const prepBackToList = panel.querySelector('#jmPrepBackToList');
    if (prepBackToList) prepBackToList.addEventListener('click', () => {
      clearPrepTimer();
      if (_currentPrepSession) renderPrepQuestionList(_currentPrepSession);
    });

    const prepNextQ = panel.querySelector('#jmPrepNextQuestion');
    if (prepNextQ) prepNextQ.addEventListener('click', () => {
      if (!_currentPrepSession) return;
      // Find next unanswered question
      const nextIdx = _currentPrepSession.questions.findIndex((q, i) => i > _currentPrepQuestionIdx && !q.evaluation);
      if (nextIdx !== -1) {
        _currentPrepQuestionIdx = nextIdx;
        renderPrepAnswerView(_currentPrepSession.questions[nextIdx]);
        showPrepView('answer');
      } else {
        renderPrepQuestionList(_currentPrepSession);
      }
    });

    const prepTryAgain = panel.querySelector('#jmPrepTryAgain');
    if (prepTryAgain) prepTryAgain.addEventListener('click', () => {
      if (_currentPrepSession && _currentPrepQuestionIdx != null) {
        const q = _currentPrepSession.questions[_currentPrepQuestionIdx];
        renderPrepAnswerView(q);
        showPrepView('answer');
      }
    });

    const prepFollowUpBtn = panel.querySelector('#jmPrepFollowUpBtn');
    if (prepFollowUpBtn) prepFollowUpBtn.addEventListener('click', handlePrepFollowUp);

    const prepAnalyticsBtn = panel.querySelector('#jmPrepAnalyticsBtn');
    if (prepAnalyticsBtn) prepAnalyticsBtn.addEventListener('click', () => {
      if (_currentPrepSession) renderPrepAnalytics(_currentPrepSession);
    });

    const prepAnalyticsBack = panel.querySelector('#jmPrepAnalyticsBack');
    if (prepAnalyticsBack) prepAnalyticsBack.addEventListener('click', () => {
      if (_currentPrepSession) renderPrepQuestionList(_currentPrepSession);
    });

    const prepPositioningBtn = panel.querySelector('#jmPrepPositioningBtn');
    if (prepPositioningBtn) prepPositioningBtn.addEventListener('click', handleGeneratePositioning);

    const prepFullReportBtn = panel.querySelector('#jmPrepFullReportBtn');
    if (prepFullReportBtn) prepFullReportBtn.addEventListener('click', () => {
      if (_currentPrepJobId) {
        chrome.runtime.sendMessage({ type: 'OPEN_PROFILE_TAB', hash: `interview-prep-report&jobId=${_currentPrepJobId}` });
      }
    });

    // Timer pause/resume
    const timerPauseBtn = panel.querySelector('#jmPrepTimerPause');
    if (timerPauseBtn) timerPauseBtn.addEventListener('click', () => {
      _prepTimerPaused = !_prepTimerPaused;
      timerPauseBtn.textContent = _prepTimerPaused ? 'Resume' : 'Pause';
    });

    // Word count on answer textarea
    const answerInput = panel.querySelector('#jmPrepAnswerInput');
    if (answerInput) {
      answerInput.addEventListener('input', () => {
        const wc = shadowRoot.getElementById('jmPrepWordCount');
        if (wc) {
          const words = answerInput.value.trim().split(/\s+/).filter(Boolean).length;
          wc.textContent = words + ' word' + (words !== 1 ? 's' : '');
        }
      });
    }
  }

  // ─── Saved Jobs tab ──────────────────────────────────────────

  /**
   * Activates the Saved tab: highlights the nav button, shows the saved
   * tab content, hides the main tab content, and fetches saved jobs.
   */
  function activateSavedTab() {
    if (!shadowRoot) return;
    // Highlight the Saved nav button
    shadowRoot.querySelectorAll('.jm-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === 'saved');
    });
    // Show saved tab, hide main tab
    const savedTab = shadowRoot.getElementById('jmSavedTab');
    const mainTab = shadowRoot.getElementById('jmMainTab');
    if (savedTab) savedTab.classList.add('active');
    if (mainTab) mainTab.classList.remove('active');
    // Fetch and render saved jobs each time the tab is activated
    loadSavedJobs();
  }

  /**
   * Deactivates the Saved tab: removes nav highlight, hides saved tab,
   * and restores the main tab content.
   */
  function deactivateSavedTab() {
    if (!shadowRoot) return;
    const savedTab = shadowRoot.getElementById('jmSavedTab');
    const mainTab = shadowRoot.getElementById('jmMainTab');
    if (savedTab) savedTab.classList.remove('active');
    if (mainTab) mainTab.classList.add('active');
  }

  // ─── Ask AI chat tab ────────────────────────────────────────────

  /** Module-level chat state */
  let _chatMessages = [];    // [{role: 'user'|'assistant', content: string}]
  let _chatWaiting = false;  // True while waiting for AI response

  /** Simple hash for URL-based chat storage keys */
  function hashUrl(url) {
    let hash = 0;
    for (let i = 0; i < url.length; i++) {
      hash = ((hash << 5) - hash) + url.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  /** Save chat history to chrome.storage via background.js */
  function saveChatHistory() {
    const urlHash = hashUrl(window.location.href);
    sendMessage({
      type: 'SAVE_CHAT',
      urlHash,
      messages: _chatMessages,
      meta: {
        jobTitle: currentAnalysis?.title || extractJobTitle() || '',
        company: currentAnalysis?.company || extractCompany() || ''
      }
    }).catch(() => {});
  }

  /** Load chat history from chrome.storage and render it */
  async function loadChatHistory() {
    const urlHash = hashUrl(window.location.href);
    try {
      const data = await sendMessage({ type: 'GET_CHAT', urlHash });
      if (data?.messages?.length > 0) {
        _chatMessages = data.messages;
        // Render all saved messages
        for (const msg of _chatMessages) {
          renderChatMessage(msg.role, msg.content);
        }
      }
    } catch (_) {}
  }

  /**
   * Activates the Ask AI tab: highlights nav, shows chat, hides other tabs.
   * Updates empty state based on whether analysis has been performed.
   */
  function activateAskAiTab() {
    if (!shadowRoot) return;
    shadowRoot.querySelectorAll('.jm-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.nav === 'ask-ai');
    });
    const askAiTab = shadowRoot.getElementById('jmAskAiTab');
    const mainTab = shadowRoot.getElementById('jmMainTab');
    const savedTab = shadowRoot.getElementById('jmSavedTab');
    if (askAiTab) askAiTab.classList.add('active');
    if (mainTab) mainTab.classList.remove('active');
    if (savedTab) savedTab.classList.remove('active');
    updateChatEmptyState();
    // Load persisted chat history for this URL (if any)
    if (_chatMessages.length === 0) {
      loadChatHistory();
    }
  }

  /**
   * Deactivates the Ask AI tab: hides it, restores main tab.
   */
  function deactivateAskAiTab() {
    if (!shadowRoot) return;
    const askAiTab = shadowRoot.getElementById('jmAskAiTab');
    const mainTab = shadowRoot.getElementById('jmMainTab');
    if (askAiTab) askAiTab.classList.remove('active');
    if (mainTab) mainTab.classList.add('active');
    // Remove active from ask-ai nav if it was active
    const askAiBtn = shadowRoot.querySelector('.jm-nav-btn[data-nav="ask-ai"]');
    if (askAiBtn) askAiBtn.classList.remove('active');
  }

  /**
   * Updates the chat empty state based on current analysis.
   * Shows "Analyze first" if no analysis, or chips + input if ready.
   */
  function updateChatEmptyState() {
    if (!shadowRoot) return;
    const noAnalysis = shadowRoot.getElementById('jmChatEmptyNoAnalysis');
    const ready = shadowRoot.getElementById('jmChatEmptyReady');
    const inputRow = shadowRoot.getElementById('jmChatInputRow');
    const header = shadowRoot.getElementById('jmChatHeader');
    const contextEl = shadowRoot.getElementById('jmChatContext');

    const hasAnalysis = !!currentAnalysis;
    const hasMessages = _chatMessages.length > 0;

    if (noAnalysis) noAnalysis.style.display = (!hasAnalysis && !hasMessages) ? 'flex' : 'none';
    if (ready) ready.style.display = (hasAnalysis && !hasMessages) ? 'flex' : 'none';
    if (inputRow) inputRow.style.display = hasAnalysis ? 'flex' : 'none';

    // Show context badge when analysis exists
    if (header && contextEl && hasAnalysis) {
      const company = currentAnalysis.company || extractCompany() || '';
      const title = currentAnalysis.title || extractJobTitle() || '';
      const score = currentAnalysis.matchScore || currentAnalysis.score || '';
      contextEl.textContent = [company, title, score ? score + '% match' : ''].filter(Boolean).join(' \u00B7 ');
      header.style.display = 'flex';
    } else if (header) {
      header.style.display = 'none';
    }
  }

  /**
   * Appends a message bubble to the chat area.
   * @param {'user'|'assistant'|'error'} role - The message sender.
   * @param {string} text - The message content.
   */
  function renderChatMessage(role, text) {
    if (!shadowRoot) return;
    const container = shadowRoot.getElementById('jmChatMessages');
    if (!container) return;

    // Hide empty states once messages exist
    const noAnalysis = shadowRoot.getElementById('jmChatEmptyNoAnalysis');
    const ready = shadowRoot.getElementById('jmChatEmptyReady');
    if (noAnalysis) noAnalysis.style.display = 'none';
    if (ready) ready.style.display = 'none';

    const bubble = document.createElement('div');
    bubble.className = `jm-chat-bubble jm-chat-${role}`;

    const textEl = document.createElement('div');
    textEl.className = 'jm-chat-bubble-text';
    textEl.textContent = text;
    bubble.appendChild(textEl);

    // Copy button on AI responses
    if (role === 'assistant') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'jm-chat-copy';
      copyBtn.textContent = 'Copy';
      copyBtn.setAttribute('aria-label', 'Copy response');
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
        });
      });
      bubble.appendChild(copyBtn);
    }

    // Retry button on error messages
    if (role === 'error') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'jm-chat-retry';
      retryBtn.textContent = 'Retry';
      retryBtn.setAttribute('aria-label', 'Retry last message');
      retryBtn.addEventListener('click', () => {
        bubble.remove();
        // Re-send the last user message
        const lastUserMsg = _chatMessages.filter(m => m.role === 'user').pop();
        if (lastUserMsg) sendChatMessage(lastUserMsg.content, true);
      });
      bubble.appendChild(retryBtn);
    }

    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
  }

  /** Shows the typing indicator (animated dots) */
  function showTypingIndicator() {
    if (!shadowRoot) return;
    const container = shadowRoot.getElementById('jmChatMessages');
    if (!container || container.querySelector('.jm-chat-typing')) return;
    const indicator = document.createElement('div');
    indicator.className = 'jm-chat-typing';
    indicator.setAttribute('aria-label', 'AI is thinking');
    indicator.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
  }

  /** Removes the typing indicator */
  function removeTypingIndicator() {
    if (!shadowRoot) return;
    const indicator = shadowRoot.querySelector('.jm-chat-typing');
    if (indicator) indicator.remove();
  }

  /**
   * Sends a user message to the AI and renders the response.
   * @param {string} text - The user's message.
   * @param {boolean} [isRetry=false] - If true, don't add to history (already there).
   */
  async function sendChatMessage(text, isRetry = false) {
    if (!text.trim() || _chatWaiting) return;

    // Render user bubble and add to history
    if (!isRetry) {
      _chatMessages.push({ role: 'user', content: text.trim() });
      renderChatMessage('user', text.trim());
    }

    // Hide suggestion chips after first message
    const chips = shadowRoot?.getElementById('jmChatChips');
    if (chips) chips.style.display = 'none';
    const readyEmpty = shadowRoot?.getElementById('jmChatEmptyReady');
    if (readyEmpty) readyEmpty.style.display = 'none';

    // Show typing indicator and disable input
    _chatWaiting = true;
    const sendBtn = shadowRoot?.getElementById('jmChatSend');
    const input = shadowRoot?.getElementById('jmChatInput');
    if (sendBtn) sendBtn.disabled = true;
    if (input) input.disabled = true;
    showTypingIndicator();

    try {
      // Send to background.js — last 10 messages for context, with 30s timeout
      const history = _chatMessages.slice(-10);
      const responsePromise = sendMessage({
        type: 'CHAT_MESSAGE',
        message: text.trim(),
        history,
        jobUrl: window.location.href
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Response timed out. The AI took too long — please try again.')), 30000)
      );
      const response = await Promise.race([responsePromise, timeoutPromise]);

      removeTypingIndicator();

      if (response?.reply) {
        _chatMessages.push({ role: 'assistant', content: response.reply });
        renderChatMessage('assistant', response.reply);
        saveChatHistory();
      } else {
        renderChatMessage('error', 'No response received. Try again.');
      }
    } catch (err) {
      removeTypingIndicator();
      renderChatMessage('error', err.message || 'Something went wrong. Try again.');
    } finally {
      _chatWaiting = false;
      if (sendBtn) sendBtn.disabled = false;
      if (input) {
        input.disabled = false;
        input.focus();
      }
    }
  }

  /**
   * Clears the chat UI and message history for the current page.
   */
  function clearChat() {
    _chatMessages = [];
    if (!shadowRoot) return;
    const container = shadowRoot.getElementById('jmChatMessages');
    if (container) {
      container.querySelectorAll('.jm-chat-bubble, .jm-chat-typing').forEach(el => el.remove());
    }
    // Clear persisted history for this URL
    const urlHash = hashUrl(window.location.href);
    sendMessage({ type: 'CLEAR_CHAT', urlHash }).catch(() => {});
    updateChatEmptyState();
  }

  // ─── Saved Jobs tab ────────────────────────────────────────────

  /**
   * Fetches saved jobs from background.js and renders them in the Saved tab.
   * @async
   */
  async function loadSavedJobs() {
    if (!shadowRoot) return;
    const list = shadowRoot.getElementById('jmSavedList');
    const emptyMsg = shadowRoot.getElementById('jmSavedEmpty');
    if (!list) return;

    try {
      const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
      // Clear previous cards (keep the empty message element)
      list.querySelectorAll('.jm-saved-card').forEach(c => c.remove());

      if (!jobs || jobs.length === 0) {
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
      }

      if (emptyMsg) emptyMsg.style.display = 'none';

      jobs.forEach(job => {
        const card = document.createElement('div');
        card.className = 'jm-saved-card';
        card.dataset.jobId = job.id;

        // Title link
        const title = document.createElement('a');
        title.className = 'jm-saved-title';
        title.textContent = job.title || 'Unknown Position';
        title.href = job.url || '#';
        title.target = '_blank';
        title.rel = 'noopener';

        // Company
        const company = document.createElement('div');
        company.className = 'jm-saved-company';
        company.textContent = job.company || 'Unknown Company';

        // Meta row (score + date)
        const meta = document.createElement('div');
        meta.className = 'jm-saved-meta';

        if (job.score != null && job.score !== 0) {
          const score = document.createElement('span');
          score.className = 'jm-saved-score';
          score.textContent = job.score + '%';
          if (job.score >= 70) score.style.background = '#059669';
          else if (job.score >= 45) score.style.background = '#d97706';
          else score.style.background = '#dc2626';
          meta.appendChild(score);
        }

        if (job.date) {
          const date = document.createElement('span');
          date.textContent = 'Saved ' + job.date;
          meta.appendChild(date);
        }

        // Applied toggle
        const appliedBtn = document.createElement('button');
        appliedBtn.className = 'jm-saved-applied-btn' + (job.applied ? ' applied' : '');
        appliedBtn.textContent = job.applied ? 'Applied' : 'Mark Applied';
        appliedBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const result = await sendMessage({ type: 'TOGGLE_JOB_APPLIED', jobId: job.id });
            appliedBtn.classList.toggle('applied', result.applied);
            appliedBtn.textContent = result.applied ? 'Applied' : 'Mark Applied';
            card.classList.toggle('is-applied', result.applied);
          } catch (_) {}
        });
        meta.appendChild(appliedBtn);

        if (job.applied) card.classList.add('is-applied');

        // Prep button
        const prep = document.createElement('button');
        prep.className = 'jm-saved-prep';
        prep.textContent = 'Prep';
        prep.title = 'Interview Prep';
        prep.addEventListener('click', (e) => {
          e.stopPropagation();
          activateInterviewPrep(job.id, job.title, job.company, job.url);
        });

        // Delete button
        const del = document.createElement('button');
        del.className = 'jm-saved-delete';
        del.innerHTML = '&#10005;';
        del.title = 'Remove saved job';
        del.addEventListener('click', () => deleteSavedJob(job.id, card));

        card.appendChild(title);
        card.appendChild(company);
        card.appendChild(meta);
        card.appendChild(prep);
        card.appendChild(del);
        list.appendChild(card);
      });
    } catch (e) {
      // Silently fail — user can retry by switching tabs
    }
  }

  /**
   * Deletes a saved job by ID (optimistic UI removal).
   * @async
   * @param {string} jobId - The saved job's ID.
   * @param {HTMLElement} cardEl - The card DOM element to remove.
   */
  async function deleteSavedJob(jobId, cardEl) {
    // Optimistic removal from DOM
    cardEl.remove();

    // Show empty state if no cards remain
    if (shadowRoot) {
      const list = shadowRoot.getElementById('jmSavedList');
      const emptyMsg = shadowRoot.getElementById('jmSavedEmpty');
      if (list && list.querySelectorAll('.jm-saved-card').length === 0 && emptyMsg) {
        emptyMsg.style.display = 'block';
      }
    }

    try {
      await sendMessage({ type: 'DELETE_JOB', jobId: jobId });
    } catch (e) {
      // If delete fails, reload the list to restore correct state
      loadSavedJobs();
    }
  }

  // ─── Interview Prep ──────────────────────────────────────────────

  let _currentPrepJobId = null;
  let _currentPrepSession = null;
  let _currentPrepQuestionIdx = null;
  let _prepTimerEnabled = true;
  let _prepTimerInterval = null;
  let _prepTimerRemaining = 0;
  let _prepTimerPaused = false;
  let _prepTimerStartTime = 0;
  let _prepElapsedBeforePause = 0;

  function activateInterviewPrep(jobId, title, company, url) {
    if (!shadowRoot) return;
    _currentPrepJobId = jobId;

    // Hide saved tab, show prep tab
    const savedTab = shadowRoot.getElementById('jmSavedTab');
    const prepTab = shadowRoot.getElementById('jmInterviewPrepTab');
    if (savedTab) savedTab.classList.remove('active');
    if (prepTab) prepTab.classList.add('active');

    // Set header
    const titleEl = shadowRoot.getElementById('jmPrepTitle');
    const subtitleEl = shadowRoot.getElementById('jmPrepSubtitle');
    if (titleEl) titleEl.textContent = title || 'Interview Prep';
    if (subtitleEl) subtitleEl.textContent = company || '';

    // Check for existing session
    sendMessage({ type: 'GET_INTERVIEW_SESSION', jobId }).then(session => {
      if (session && session.questions && session.questions.length > 0) {
        _currentPrepSession = session;
        showPrepView('questionList');
        renderPrepQuestionList(session);
      } else {
        showPrepView('start');
      }
    }).catch(() => showPrepView('start'));
  }

  function deactivateInterviewPrep(returnToSaved) {
    if (!shadowRoot) return;
    clearPrepTimer();

    const prepTab = shadowRoot.getElementById('jmInterviewPrepTab');
    const wasActive = prepTab?.classList.contains('active');
    if (prepTab) prepTab.classList.remove('active');

    // Only show saved tab if explicitly returning (back button), not when nav handler is switching tabs
    if (returnToSaved && wasActive) {
      const savedTab = shadowRoot.getElementById('jmSavedTab');
      if (savedTab) savedTab.classList.add('active');
    }

    _currentPrepJobId = null;
    _currentPrepSession = null;
    _currentPrepQuestionIdx = null;
  }

  function showPrepView(view) {
    if (!shadowRoot) return;
    const views = ['jmPrepStart', 'jmPrepQuestionList', 'jmPrepAnswerView', 'jmPrepFeedbackView', 'jmPrepAnalyticsView'];
    views.forEach(id => {
      const el = shadowRoot.getElementById(id);
      if (el) el.style.display = 'none';
    });
    const map = { start: 'jmPrepStart', questionList: 'jmPrepQuestionList', answer: 'jmPrepAnswerView', feedback: 'jmPrepFeedbackView', analytics: 'jmPrepAnalyticsView' };
    const target = shadowRoot.getElementById(map[view]);
    if (target) target.style.display = 'block';
  }

  // Timer functions
  function startPrepTimer(seconds, onExpire) {
    clearPrepTimer();
    _prepTimerRemaining = seconds;
    _prepTimerPaused = false;
    _prepTimerStartTime = Date.now();
    _prepElapsedBeforePause = 0;
    updateTimerDisplay();

    const timerEl = shadowRoot.getElementById('jmPrepTimer');
    const controlsEl = shadowRoot.getElementById('jmPrepTimerControls');
    if (timerEl) timerEl.style.display = 'block';
    if (controlsEl) controlsEl.style.display = 'flex';

    _prepTimerInterval = setInterval(() => {
      if (_prepTimerPaused) return;
      _prepTimerRemaining--;
      updateTimerDisplay();
      if (_prepTimerRemaining <= 0) {
        clearPrepTimer();
        if (onExpire) onExpire();
      }
    }, 1000);
  }

  function clearPrepTimer() {
    if (_prepTimerInterval) {
      clearInterval(_prepTimerInterval);
      _prepTimerInterval = null;
    }
  }

  function updateTimerDisplay() {
    const timerEl = shadowRoot?.getElementById('jmPrepTimer');
    if (!timerEl) return;
    const mins = Math.floor(Math.max(0, _prepTimerRemaining) / 60);
    const secs = Math.max(0, _prepTimerRemaining) % 60;
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

    // Color coding
    const totalTime = _currentPrepSession?.questions[_currentPrepQuestionIdx]?.timeLimitSec || 120;
    const pct = _prepTimerRemaining / totalTime;
    timerEl.className = 'jm-prep-timer';
    if (pct <= 0.1) timerEl.classList.add('flash', 'critical');
    else if (pct <= 0.25) timerEl.classList.add('critical');
    else if (pct <= 0.5) timerEl.classList.add('warning');
  }

  function getTimeSpent() {
    const q = _currentPrepSession?.questions[_currentPrepQuestionIdx];
    if (!q) return 0;
    const totalTime = q.timeLimitSec || 120;
    return totalTime - Math.max(0, _prepTimerRemaining);
  }

  // Render functions
  function renderPrepQuestionList(session) {
    if (!shadowRoot) return;
    const list = shadowRoot.getElementById('jmPrepQList');
    const countEl = shadowRoot.getElementById('jmPrepQCount');
    const analyticsBtn = shadowRoot.getElementById('jmPrepAnalyticsBtn');
    if (!list) return;

    list.innerHTML = '';
    const answered = session.questions.filter(q => q.evaluation).length;
    if (countEl) countEl.textContent = `${answered}/${session.questions.length} answered`;
    if (analyticsBtn) analyticsBtn.disabled = answered < 3;

    session.questions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'jm-prep-qcard' + (q.isFollowUp ? ' follow-up' : '');
      card.addEventListener('click', () => {
        _currentPrepQuestionIdx = idx;
        if (q.evaluation) {
          renderPrepFeedbackView(q);
          showPrepView('feedback');
        } else {
          renderPrepAnswerView(q);
          showPrepView('answer');
        }
      });

      const header = document.createElement('div');
      header.className = 'jm-prep-qcard-header';

      if (q.isFollowUp) {
        const arrow = document.createElement('span');
        arrow.textContent = '\u21B3 ';
        arrow.style.color = 'var(--ac-primary)';
        header.appendChild(arrow);
      }

      const pill = document.createElement('span');
      pill.className = `jm-prep-category-pill jm-prep-pill-${q.category}`;
      pill.textContent = q.category;
      header.appendChild(pill);

      const diff = document.createElement('span');
      diff.className = `jm-prep-difficulty jm-prep-diff-${q.difficulty}`;
      diff.title = q.difficulty;
      header.appendChild(diff);

      card.appendChild(header);

      const text = document.createElement('div');
      text.className = 'jm-prep-qcard-text';
      text.textContent = q.question;
      card.appendChild(text);

      // Status badge
      const status = document.createElement('span');
      status.className = 'jm-prep-qcard-status';
      if (q.evaluation) {
        status.classList.add('jm-prep-status-scored');
        status.textContent = q.evaluation.score + '/10';
        const s = q.evaluation.score;
        status.style.background = s >= 7 ? '#22c55e' : s >= 4 ? '#f59e0b' : '#ef4444';
      } else {
        status.classList.add('jm-prep-status-pending');
        status.textContent = 'Pending';
      }
      card.appendChild(status);

      list.appendChild(card);
    });

    showPrepView('questionList');
  }

  function renderPrepAnswerView(question) {
    if (!shadowRoot) return;
    const headerEl = shadowRoot.getElementById('jmPrepAnsHeader');
    const questionEl = shadowRoot.getElementById('jmPrepAnsQuestion');
    const hintsListEl = shadowRoot.getElementById('jmPrepHintsList');
    const inputEl = shadowRoot.getElementById('jmPrepAnswerInput');
    const wordCountEl = shadowRoot.getElementById('jmPrepWordCount');

    if (headerEl) {
      headerEl.innerHTML = '';
      const pill = document.createElement('span');
      pill.className = `jm-prep-category-pill jm-prep-pill-${question.category}`;
      pill.textContent = question.category;
      headerEl.appendChild(pill);
      const diff = document.createElement('span');
      diff.className = `jm-prep-difficulty jm-prep-diff-${question.difficulty}`;
      headerEl.appendChild(diff);
      const diffLabel = document.createElement('span');
      diffLabel.textContent = question.difficulty;
      diffLabel.style.cssText = 'font-size:11px;color:var(--ac-text-muted);';
      headerEl.appendChild(diffLabel);
    }

    if (questionEl) questionEl.textContent = question.question;

    if (hintsListEl) {
      hintsListEl.innerHTML = '';
      (question.keyPoints || []).forEach(kp => {
        const li = document.createElement('li');
        li.textContent = kp;
        hintsListEl.appendChild(li);
      });
    }

    if (inputEl) {
      inputEl.value = question.userAnswer || '';
      inputEl.focus();
    }
    if (wordCountEl) wordCountEl.textContent = '0 words';

    // Start timer
    if (_prepTimerEnabled) {
      startPrepTimer(question.timeLimitSec || 120, () => {
        // Auto-submit on timer expiry
        submitCurrentAnswer();
      });
    } else {
      const timerEl = shadowRoot.getElementById('jmPrepTimer');
      const controlsEl = shadowRoot.getElementById('jmPrepTimerControls');
      if (timerEl) timerEl.style.display = 'none';
      if (controlsEl) controlsEl.style.display = 'none';
      _prepTimerStartTime = Date.now();
    }
  }

  function renderPrepFeedbackView(question) {
    if (!shadowRoot || !question.evaluation) return;
    const eval_ = question.evaluation;
    const score = eval_.score;

    const circleEl = shadowRoot.getElementById('jmPrepScoreCircle');
    if (circleEl) {
      circleEl.textContent = score + '/10';
      circleEl.className = 'jm-prep-score-circle';
      if (score >= 7) circleEl.classList.add('jm-prep-score-high');
      else if (score >= 4) circleEl.classList.add('jm-prep-score-mid');
      else circleEl.classList.add('jm-prep-score-low');
    }

    const timeBadge = shadowRoot.getElementById('jmPrepTimeBadge');
    if (timeBadge && question.timeSpentSec != null) {
      const limit = question.timeLimitSec || 120;
      timeBadge.textContent = `Answered in ${question.timeSpentSec}s (${Math.floor(limit / 60)}:${(limit % 60).toString().padStart(2, '0')} limit)`;
    }

    const strengthsList = shadowRoot.getElementById('jmPrepStrengthsList');
    if (strengthsList) {
      strengthsList.innerHTML = '';
      (eval_.strengths || []).forEach(s => {
        const li = document.createElement('li');
        li.textContent = s;
        strengthsList.appendChild(li);
      });
    }

    const improvementsList = shadowRoot.getElementById('jmPrepImprovementsList');
    if (improvementsList) {
      improvementsList.innerHTML = '';
      (eval_.improvements || []).forEach(s => {
        const li = document.createElement('li');
        li.textContent = s;
        improvementsList.appendChild(li);
      });
    }

    const sampleEl = shadowRoot.getElementById('jmPrepSampleAnswer');
    if (sampleEl) sampleEl.textContent = eval_.sampleAnswer || '';

    // Follow-up banner
    const banner = shadowRoot.getElementById('jmPrepFollowUpBanner');
    if (banner) banner.style.display = score < 5 ? 'block' : 'none';
  }

  function renderPrepAnalytics(session) {
    if (!shadowRoot) return;
    const analytics = session.analytics;

    const readinessEl = shadowRoot.getElementById('jmPrepReadinessCircle');
    if (readinessEl) {
      readinessEl.textContent = analytics.overallReadiness + '%';
      readinessEl.className = 'jm-prep-score-circle';
      readinessEl.style.cssText = 'width:72px;height:72px;font-size:26px;';
      if (analytics.overallReadiness >= 70) readinessEl.classList.add('jm-prep-score-high');
      else if (analytics.overallReadiness >= 40) readinessEl.classList.add('jm-prep-score-mid');
      else readinessEl.classList.add('jm-prep-score-low');
    }

    // Category bars
    const barsEl = shadowRoot.getElementById('jmPrepCategoryBars');
    if (barsEl) {
      barsEl.innerHTML = '';
      const cats = [
        { key: 'behavioral', label: 'Behavioral', color: '#3b82f6' },
        { key: 'technical', label: 'Technical', color: '#8b5cf6' },
        { key: 'situational', label: 'Situational', color: '#f97316' },
        { key: 'role-specific', label: 'Role-Specific', color: '#22c55e' },
      ];
      cats.forEach(cat => {
        const val = analytics.categoryScores[cat.key];
        const container = document.createElement('div');
        container.className = 'jm-prep-bar-container';
        const label = document.createElement('div');
        label.className = 'jm-prep-bar-label';
        label.innerHTML = `<span>${cat.label}</span><span>${val != null ? val + '%' : '--'}</span>`;
        const track = document.createElement('div');
        track.className = 'jm-prep-bar-track';
        const fill = document.createElement('div');
        fill.className = 'jm-prep-bar-fill';
        fill.style.width = (val || 0) + '%';
        fill.style.background = cat.color;
        track.appendChild(fill);
        container.appendChild(label);
        container.appendChild(track);
        barsEl.appendChild(container);
      });
    }

    // Stats
    const answeredEl = shadowRoot.getElementById('jmPrepStatAnswered');
    if (answeredEl) answeredEl.textContent = `${analytics.questionsAnswered}/${analytics.questionsTotal}`;
    const avgTimeEl = shadowRoot.getElementById('jmPrepStatAvgTime');
    if (avgTimeEl) avgTimeEl.textContent = analytics.avgTimePerAnswer ? analytics.avgTimePerAnswer + 's' : '--';
    const followUpsEl = shadowRoot.getElementById('jmPrepStatFollowUps');
    if (followUpsEl) followUpsEl.textContent = analytics.followUpsGenerated;

    // Weak areas
    const weakList = shadowRoot.getElementById('jmPrepWeakAreasList');
    const weakSection = shadowRoot.getElementById('jmPrepWeakAreasSection');
    if (weakList && weakSection) {
      weakList.innerHTML = '';
      if (analytics.weakAreas && analytics.weakAreas.length > 0) {
        weakSection.style.display = 'block';
        analytics.weakAreas.forEach(w => {
          const li = document.createElement('li');
          li.textContent = w;
          weakList.appendChild(li);
        });
      } else {
        weakSection.style.display = 'none';
      }
    }

    // Positioning button
    const posBtn = shadowRoot.getElementById('jmPrepPositioningBtn');
    if (posBtn) posBtn.disabled = analytics.questionsAnswered < 5;

    // Positioning advice (if already generated)
    const posAdviceEl = shadowRoot.getElementById('jmPrepPositioningAdvice');
    const posContentEl = shadowRoot.getElementById('jmPrepPositioningContent');
    const reportRow = shadowRoot.getElementById('jmPrepReportRow');
    if (analytics.positioningAdvice && posAdviceEl && posContentEl) {
      posAdviceEl.style.display = 'block';
      posContentEl.textContent = analytics.positioningAdvice;
      if (reportRow) reportRow.style.display = 'flex';
    } else if (posAdviceEl) {
      posAdviceEl.style.display = 'none';
      if (reportRow) reportRow.style.display = 'none';
    }

    showPrepView('analytics');
  }

  async function submitCurrentAnswer() {
    if (!shadowRoot || _currentPrepQuestionIdx == null || !_currentPrepSession) return;
    const inputEl = shadowRoot.getElementById('jmPrepAnswerInput');
    const answer = inputEl?.value?.trim() || '';
    if (!answer) return;

    clearPrepTimer();
    const q = _currentPrepSession.questions[_currentPrepQuestionIdx];
    const timeSpent = _prepTimerEnabled ? getTimeSpent() : Math.round((Date.now() - _prepTimerStartTime) / 1000);

    // Show loading
    const submitBtn = shadowRoot.getElementById('jmPrepSubmitAnswer');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Evaluating...'; }

    try {
      const result = await sendMessage({
        type: 'EVALUATE_INTERVIEW_ANSWER',
        jobId: _currentPrepJobId,
        questionId: q.id,
        question: q.question,
        userAnswer: answer,
        category: q.category,
        keyPoints: q.keyPoints,
        timeSpentSec: timeSpent,
      });

      // Update local session
      _currentPrepSession.questions[_currentPrepQuestionIdx].userAnswer = answer;
      _currentPrepSession.questions[_currentPrepQuestionIdx].timeSpentSec = timeSpent;
      _currentPrepSession.questions[_currentPrepQuestionIdx].answeredAt = Date.now();
      _currentPrepSession.questions[_currentPrepQuestionIdx].evaluation = result.evaluation;
      _currentPrepSession.analytics = result.analytics;

      renderPrepFeedbackView(_currentPrepSession.questions[_currentPrepQuestionIdx]);
      showPrepView('feedback');

      // Show follow-up banner if needed
      const banner = shadowRoot.getElementById('jmPrepFollowUpBanner');
      if (banner) banner.style.display = result.shouldFollowUp ? 'block' : 'none';

    } catch (err) {
      if (submitBtn) submitBtn.textContent = 'Error - Retry';
      console.error('[prep] Evaluation failed:', err);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; if (submitBtn.textContent === 'Evaluating...') submitBtn.textContent = 'Submit Answer'; }
    }
  }

  async function handlePrepFollowUp() {
    if (!_currentPrepSession || _currentPrepQuestionIdx == null) return;
    const q = _currentPrepSession.questions[_currentPrepQuestionIdx];

    const followUpBtn = shadowRoot.getElementById('jmPrepFollowUpBtn');
    if (followUpBtn) { followUpBtn.disabled = true; followUpBtn.textContent = 'Generating...'; }

    try {
      const result = await sendMessage({
        type: 'GENERATE_FOLLOWUP_QUESTION',
        jobId: _currentPrepJobId,
        parentQuestionId: q.id,
        question: q.question,
        userAnswer: q.userAnswer,
        evaluation: q.evaluation,
        category: q.category,
      });

      _currentPrepSession = result.session;
      renderPrepQuestionList(_currentPrepSession);

    } catch (err) {
      console.error('[prep] Follow-up generation failed:', err);
      if (followUpBtn) followUpBtn.textContent = 'Error - Retry';
    } finally {
      if (followUpBtn) { followUpBtn.disabled = false; if (followUpBtn.textContent === 'Generating...') followUpBtn.textContent = 'Practice Follow-Up'; }
    }
  }

  async function handleGeneratePrepQuestions() {
    if (!shadowRoot) return;
    const categories = [];
    shadowRoot.querySelectorAll('#jmPrepCategories input:checked').forEach(cb => categories.push(cb.value));
    _prepTimerEnabled = shadowRoot.getElementById('jmPrepTimerEnabled')?.checked !== false;

    if (categories.length === 0) return;

    const btn = shadowRoot.getElementById('jmPrepGenerateBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating questions...'; }

    try {
      const session = await sendMessage({
        type: 'GENERATE_INTERVIEW_QUESTIONS',
        jobId: _currentPrepJobId,
        jobUrl: window.location.href,
        categories,
      });

      _currentPrepSession = session;
      renderPrepQuestionList(session);

    } catch (err) {
      console.error('[prep] Question generation failed:', err);
      const errMsg = err?.message || String(err);
      if (btn) btn.textContent = 'Error - Retry';
      // Show error detail below the button
      let errDiv = shadowRoot?.getElementById('jmPrepError');
      if (!errDiv) {
        errDiv = document.createElement('div');
        errDiv.id = 'jmPrepError';
        errDiv.style.cssText = 'color:#dc2626;font-size:12px;padding:10px;background:#fef2f2;border-radius:8px;margin-top:10px;line-height:1.4';
        btn?.parentNode?.appendChild(errDiv);
      }
      errDiv.textContent = errMsg;
    } finally {
      if (btn) { btn.disabled = false; if (btn.textContent === 'Generating questions...') btn.textContent = 'Generate Questions'; }
    }
  }

  async function handleGeneratePositioning() {
    const btn = shadowRoot?.getElementById('jmPrepPositioningBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

    try {
      const result = await sendMessage({
        type: 'GENERATE_POSITIONING_ADVICE',
        jobId: _currentPrepJobId,
      });

      _currentPrepSession.analytics = result.analytics;
      renderPrepAnalytics(_currentPrepSession);

    } catch (err) {
      console.error('[prep] Positioning advice failed:', err);
      if (btn) btn.textContent = 'Error - Retry';
    } finally {
      if (btn) { btn.disabled = false; if (btn.textContent === 'Generating...') btn.textContent = 'Generate Positioning Advice'; }
    }
  }

  /**
   * Checks if the current page URL is already saved and updates
   * the Save Job button to show "Saved" state if so.
   * @async
   */
  async function checkIfSaved() {
    try {
      const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
      const btn = shadowRoot.getElementById('jmSaveJob');
      if (!btn) return;
      if (jobs && jobs.some(j => j.url === window.location.href)) {
        btn.textContent = 'Saved';
        btn.disabled = true;
        btn.style.opacity = '0.7';
      } else {
        btn.textContent = 'Save Job';
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    } catch (e) { /* ignore */ }
  }

  // ─── Toggle button (always visible) ────────────────────────────
  // The ★ button is a separate Shadow DOM host from the panel so it can float
  // freely without interfering with the panel's stacking context.
  // It supports both mouse drag and touch drag, and persists its last position
  // across page navigations using localStorage.

  /**
   * Creates the draggable floating ★ toggle button and appends it to the page.
   *
   * Position is restored from localStorage on creation. Drag state is tracked
   * with mousedown/mousemove/mouseup (and touch equivalents). A click only fires
   * togglePanel() if the button was not meaningfully dragged (delta < 4px).
   */
  function createToggleButton() {
    const btn = document.createElement('button');
    btn.className = 'jm-toggle';
    btn.id = 'applicant-copilot-toggle';
    btn.innerHTML = '&#9733;';
    btn.title = 'Applicant Copilot';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Open Applicant Copilot panel');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('tabindex', '0');
    toggleBtnRef = btn;

    // Restore saved position or default to bottom-right
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem('ac-fab-pos')); } catch { return null; }
    })();
    const defaultRight = 24;
    const defaultBottom = 24;
    if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
      btn.style.right  = saved.right + 'px';
      btn.style.bottom = saved.bottom + 'px';
      btn.style.left   = 'auto';
      btn.style.top    = 'auto';
    } else {
      btn.style.right  = defaultRight + 'px';
      btn.style.bottom = defaultBottom + 'px';
      btn.style.left   = 'auto';
      btn.style.top    = 'auto';
    }

    // ── Drag logic ──
    let didDrag = false, startX, startY, startRight, startBottom;
    const MIN_MARGIN = 8;
    const DRAG_THRESHOLD = 4;

    function onMove(e) {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = cx - startX;
      const dy = cy - startY;

      // Only start dragging after movement exceeds threshold
      if (!didDrag && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      didDrag = true;
      btn.classList.add('dragging');

      // Calculate new right/bottom with bounds checking (8px min margin)
      let newRight  = startRight - dx;
      let newBottom = startBottom - dy;
      newRight  = Math.max(MIN_MARGIN, Math.min(newRight,  window.innerWidth  - 48 - MIN_MARGIN));
      newBottom = Math.max(MIN_MARGIN, Math.min(newBottom, window.innerHeight - 48 - MIN_MARGIN));

      btn.style.right  = newRight + 'px';
      btn.style.bottom = newBottom + 'px';
      btn.style.left   = 'auto';
      btn.style.top    = 'auto';
    }

    function onEnd(e) {
      btn.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend',  onEnd);

      if (didDrag) {
        // Save position as {right, bottom}
        const pos = {
          right:  parseInt(btn.style.right,  10),
          bottom: parseInt(btn.style.bottom, 10)
        };
        try { localStorage.setItem('ac-fab-pos', JSON.stringify(pos)); } catch {}
      }
    }

    btn.addEventListener('mousedown', e => {
      startX = e.clientX; startY = e.clientY;
      startRight  = parseInt(btn.style.right,  10) || defaultRight;
      startBottom = parseInt(btn.style.bottom, 10) || defaultBottom;
      didDrag = false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onEnd);
      e.preventDefault();
    });

    btn.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      startRight  = parseInt(btn.style.right,  10) || defaultRight;
      startBottom = parseInt(btn.style.bottom, 10) || defaultBottom;
      didDrag = false;
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd);
      e.preventDefault();
    }, { passive: false });

    // Only fire click if not dragged (threshold already checked during move)
    btn.addEventListener('click', e => {
      if (!didDrag) togglePanel();
    });

    // Keyboard accessibility: Enter and Space trigger toggle
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePanel();
      }
    });

    // Attach to shadow root for isolation
    const host = document.createElement('div');
    host.id = 'applicant-copilot-toggle-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = getPanelCSS();
    shadow.appendChild(style);
    shadow.appendChild(btn);
    document.body.appendChild(host);
  }

  // ─── Resume slot switcher ─────────────────────────────────────

  /**
   * Loads slot state from chrome.storage.local and renders the switcher pills.
   * Called when the panel opens so the switcher always reflects current storage.
   * @async
   */
  async function loadSlotState() {
    try {
      const result = await chrome.storage.local.get(['profileSlots', 'activeProfileSlot', 'slotNames']);
      _activeSlot  = result.activeProfileSlot ?? 0;
      _slotNames   = result.slotNames   || ['Resume 1', 'Resume 2', 'Resume 3'];
      const slots  = result.profileSlots || [null, null, null];
      _slotHasData = slots.map(s => !!s);
      renderSlotSwitcher();
    } catch (e) { /* ignore — switcher stays hidden */ }
  }

  /**
   * Renders the three slot pills into #jmSwitchPills.
   * Disables pills for empty slots. Marks the active slot with .active class.
   */
  function renderSlotSwitcher() {
    const container = shadowRoot && shadowRoot.getElementById('jmSwitchPills');
    if (!container) return;
    container.innerHTML = '';
    _slotNames.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.className = 'jm-switch-pill' + (i === _activeSlot ? ' active' : '');
      btn.textContent = name || `Resume ${i + 1}`;
      btn.title = _slotHasData[i] ? name : `${name} (empty)`;
      btn.disabled = !_slotHasData[i];
      btn.addEventListener('click', () => switchSlot(i));
      container.appendChild(btn);
    });
  }

  /**
   * Switches the active resume slot, updates chrome.storage.local, and resets
   * the current analysis so the user re-analyzes with the new resume.
   * @async
   * @param {number} slotIndex - The slot index (0, 1, or 2) to switch to.
   */
  async function switchSlot(slotIndex) {
    if (slotIndex === _activeSlot) return;
    try {
      const result = await chrome.storage.local.get(['profileSlots', 'slotNames']);
      const slots  = result.profileSlots || [null, null, null];
      if (!slots[slotIndex]) return; // slot is empty — should not happen (button is disabled)

      // Persist the new active slot and update the top-level `profile` key
      // so background.js always reads the correct resume for AI calls.
      await chrome.storage.local.set({
        activeProfileSlot: slotIndex,
        profile: slots[slotIndex]
      });

      _activeSlot = slotIndex;
      renderSlotSwitcher();

      // Reset analysis — it was scored against the previous resume
      currentAnalysis = null;
      const analyzeBtn = shadowRoot.getElementById('jmAnalyze');
      if (analyzeBtn) analyzeBtn.textContent = 'Analyze Job';

      // Hide all result sections so the panel is clean for the new resume
      ['jmScoreSection','jmMatchingSection','jmMissingSection','jmRecsSection',
       'jmInsightsSection','jmKeywordsSection','jmCoverLetterSection',
       'jmSaveJob','jmMarkApplied','jmCoverLetterBtn'
      ].forEach(id => {
        const el = shadowRoot.getElementById(id);
        if (el) el.style.display = 'none';
      });

      setStatus(`Switched to ${_slotNames[slotIndex] || `Resume ${slotIndex + 1}`}. Click Analyze Job.`, 'success');
      setTimeout(clearStatus, 2500);
    } catch (e) {
      setStatus('Could not switch resume: ' + e.message, 'error');
    }
  }

  // ─── Panel toggle ─────────────────────────────────────────────

  /**
   * Opens or closes the side panel.
   * On first open, createPanel() is called to build the Shadow DOM.
   * When opening, also triggers checkIfApplied() and loadJobNotes()
   * so the panel always reflects the latest state for the current URL.
   */
  // Reference to the backdrop element inside the panel's shadow DOM
  let _backdropEl = null;
  // Reference to the escape key handler so we can add/remove it
  let _escHandler = null;
  let _outsideClickHandler = null;

  function togglePanel() {
    panelOpen = !panelOpen;
    if (!panelRoot) createPanel();

    const panel = shadowRoot.getElementById('jm-panel');

    // Update accessibility attributes on the toggle button
    if (toggleBtnRef) {
      toggleBtnRef.setAttribute('aria-label', panelOpen ? 'Close Applicant Copilot panel' : 'Open Applicant Copilot panel');
      toggleBtnRef.setAttribute('aria-pressed', String(panelOpen));
    }

    if (panelOpen) {
      panelRoot.classList.add('open');
      panel.classList.add('open');

      // Close panel when clicking outside (replaces full-page backdrop that blocked scrolling)
      _outsideClickHandler = (e) => {
        // Only react to real user clicks — ignore programmatic .click() calls
        // (e.g. expandTruncatedContent clicking LinkedIn's "Show more" button)
        if (!e.isTrusted) return;
        if (panelOpen && !panelRoot.contains(e.target) && (!toggleBtnRef || !toggleBtnRef.getRootNode().host?.contains(e.target))) {
          togglePanel();
        }
      };
      // Delay to avoid catching the current click that opened the panel
      setTimeout(() => document.addEventListener('click', _outsideClickHandler), 0);

      // Add Escape key handler
      _escHandler = (e) => {
        if (e.key === 'Escape' && panelOpen) togglePanel();
      };
      document.addEventListener('keydown', _escHandler);

      loadSlotState();
      checkIfApplied();
      checkIfSaved();
      loadJobNotes();
      showConsentBannerIfNeeded();
      // Ensure we start on the main tab when opening the panel
      deactivateSavedTab();
    } else {
      panel.classList.remove('open');
      panelRoot.classList.remove('open');

      // Remove click-outside handler
      if (_outsideClickHandler) {
        document.removeEventListener('click', _outsideClickHandler);
        _outsideClickHandler = null;
      }

      // Remove Escape key handler
      if (_escHandler) {
        document.removeEventListener('keydown', _escHandler);
        _escHandler = null;
      }
    }
    // Button always stays visible — never hide the toggle host
  }

  // ─── Consent banner ─────────────────────────────────────────────

  async function showConsentBannerIfNeeded() {
    try {
      const consent = await sendMessage({ type: 'GET_DATA_CONSENT' });
      if (consent.asked) return; // Already asked (yes or no), don't show again

      const auth = await sendMessage({ type: 'GET_AUTH_STATE' });
      if (!auth.signedIn) return; // Only ask signed-in users

      // Create banner
      let banner = shadowRoot.getElementById('jmConsentBanner');
      if (banner) return; // Already showing

      banner = document.createElement('div');
      banner.id = 'jmConsentBanner';
      banner.style.cssText = 'padding:12px 14px;margin:8px 12px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1px solid #bfdbfe;border-radius:10px;font-size:12px;line-height:1.5;color:#1e40af';
      banner.innerHTML = `
        <div style="font-weight:600;margin-bottom:6px">Help improve Applicant Copilot</div>
        <div style="color:#3b82f6;margin-bottom:10px">Share anonymous usage data to help us build better tools for job seekers. You can opt out anytime in Settings.</div>
        <div style="display:flex;gap:8px">
          <button id="jmConsentYes" style="flex:1;padding:6px 12px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer">Yes, I'm in</button>
          <button id="jmConsentNo" style="flex:1;padding:6px 12px;background:white;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;cursor:pointer">No thanks</button>
        </div>`;

      // Insert at top of panel body
      const panelBody = shadowRoot.querySelector('.jm-panel-body') || shadowRoot.getElementById('jm-panel');
      if (panelBody) panelBody.prepend(banner);

      banner.querySelector('#jmConsentYes').addEventListener('click', async () => {
        await sendMessage({ type: 'SET_DATA_CONSENT', consented: true });
        banner.remove();
      });
      banner.querySelector('#jmConsentNo').addEventListener('click', async () => {
        await sendMessage({ type: 'SET_DATA_CONSENT', consented: false });
        banner.remove();
      });
    } catch (_) {}
  }

  // ─── Status helpers ───────────────────────────────────────────

  /**
   * Displays a status message inside the panel (info / success / error styles).
   * @param {string} text - Message to display.
   * @param {'info'|'success'|'error'} type - CSS modifier class for color.
   */
  function setStatus(text, type) {
    const el = shadowRoot.getElementById('jmStatus');
    el.textContent = text;
    el.className = 'jm-status ' + type;
  }

  /** Hides the status bar (used after a timed delay post-success). */
  function clearStatus() {
    const el = shadowRoot.getElementById('jmStatus');
    el.className = 'jm-status';
    el.style.display = 'none';
  }

  /**
   * Scrolls the panel's scrollable body to bring a section into view.
   * Uses the panel's own scrollable container rather than window.scrollIntoView,
   * which would scroll the host page instead of the Shadow DOM panel.
   * @param {HTMLElement} el - The element to scroll to inside the panel.
   */
  function scrollPanelTo(el) {
    const body = shadowRoot.querySelector('.jm-body');
    if (!body) return;
    body.scrollTo({ top: el.offsetTop - 10, behavior: 'smooth' });
  }

  // ─── Job description extraction ───────────────────────────────
  // Each function tries a prioritised list of CSS selectors for supported job
  // sites, then falls back to heuristic DOM scanning.  Returns an empty string
  // (or null) when nothing can be found, so callers can show an error.

  /**
   * Extracts the full job description text from the current page.
   * Tries site-specific selectors first, then generic heuristics.
   * @returns {string} The extracted job description text, or '' if not found.
   */
  /**
   * Extracts the job description from the current page using a two-stage approach:
   *   Stage 1 — Platform-specific selectors for P0/P1 ATS platforms (fast, precise)
   *   Stage 2 — Readability-inspired text-density algorithm (works on any site)
   *
   * This combo replaces the old 20+ fragile selector list with a focused set of
   * 5 high-confidence selectors plus a universal fallback that scores DOM nodes
   * by text density, paragraph count, and link ratio.
   *
   * @returns {string} The extracted job description text.
   */
  /**
   * Clicks "Show more" / expand buttons on platforms that truncate the JD.
   * Must be called before extraction so the full text is in the DOM.
   */
  async function expandTruncatedContent() {
    const expandSelectors = [
      // LinkedIn "Show more" on JD
      '.jobs-description__content .show-more-less-html__button--more',
      'button[aria-label="Click to see more description"]',
      '.show-more-less-html__button--more',
      // Workday expand
      'button[data-automation-id="Show More"]',
      // Indeed
      '#jobDescriptionText .viewMoreButton',
      '.jobsearch-ViewJobButtons-showMoreButton',
    ];
    for (const sel of expandSelectors) {
      try {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetParent !== null) {
          btn.click();
          await new Promise(r => setTimeout(r, 500));
        }
      } catch (_) {}
    }
  }

  async function extractJobDescription() {
    // Expand truncated content before extracting
    await expandTruncatedContent();

    // ── Stage 1: Platform selectors (P0/P1 — covers ~90% of usage) ──────
    const PLATFORM_SELECTORS = [
      // LinkedIn (P0) — multiple variants for different LinkedIn layouts
      '.jobs-description__content, .description__text, .jobs-box__html-content',
      // Workday (P0)
      '[data-automation-id="jobPostingDescription"], .job-description',
      // Greenhouse (P1)
      '#content .job-post-content, #content #gh_jid, .job__description',
      // Lever (P1)
      '.posting-page .content, .section-wrapper.page-full-width',
      // Indeed (P2)
      '#jobDescriptionText, .jobsearch-jobDescriptionText',
    ];

    for (const selectorGroup of PLATFORM_SELECTORS) {
      for (const sel of selectorGroup.split(', ')) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 100) {
          return el.innerText.trim();
        }
      }
    }

    // ── Stage 2: Readability-inspired content extraction ────────────────
    // Scores every candidate node by text density, paragraph count, and
    // inverse link density. The highest-scoring node is the JD.
    return _extractByTextDensity();
  }

  /**
   * Readability-inspired algorithm that finds the main content block on any page
   * by scoring DOM nodes on text density, paragraph/list-item count, and link ratio.
   *
   * How it works:
   *   1. Collect all semantic container nodes (article, section, main, div, td)
   *   2. For each node, compute:
   *      - wordCount: total words in innerText (more words = more likely content)
   *      - paragraphCount: number of <p> and <li> children (structured content signal)
   *      - linkDensity: ratio of link text to total text (high = navigation, low = content)
   *   3. Score = (wordCount × 1) + (paragraphCount × 10) − (linkDensity × 500)
   *   4. Nodes with < 80 words or link density > 0.5 are skipped (nav/footer/sidebar)
   *   5. The highest scoring node wins
   *
   * This reliably extracts JDs from unknown ATS platforms, career pages, and
   * custom job boards without any site-specific selectors.
   *
   * @returns {string} The extracted content text, or first 10000 chars of body as last resort.
   */
  function _extractByTextDensity() {
    const candidates = document.querySelectorAll('article, section, main, [role="main"], div, td');
    let bestNode = null;
    let bestScore = 0;

    for (const node of candidates) {
      const text = node.innerText || '';
      const words = text.split(/\s+/).filter(w => w.length > 0);
      const wordCount = words.length;

      // Skip nodes that are too short to be a JD
      if (wordCount < 80) continue;

      // Count structured content indicators (paragraphs and list items)
      const paragraphCount = node.querySelectorAll('p, li').length;

      // Calculate link density: ratio of anchor text to total text
      const links = node.querySelectorAll('a');
      let linkTextLen = 0;
      for (const a of links) linkTextLen += (a.innerText || '').length;
      const linkDensity = text.length > 0 ? linkTextLen / text.length : 0;

      // High link density = navigation/footer/sidebar — skip
      if (linkDensity > 0.5) continue;

      // Score: more words + more structured content − link-heavy content
      const score = (wordCount * 1) + (paragraphCount * 10) - (linkDensity * 500);

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    }

    if (bestNode) {
      return bestNode.innerText.trim();
    }

    // Last resort: body text (capped at 10000 chars)
    return document.body.innerText.substring(0, 10000);
  }

  /** @returns {string} The job title extracted from the page, or ''. */
  function extractJobTitle() {
    const selectors = [
      'h1.job-title', 'h1.posting-headline', '.job-title h1',
      'h1[class*="title"]', '.jobs-unified-top-card__job-title',
      'h1', '.posting-headline h2',
      'h2.job-title', '[data-automation-id="jobTitle"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 2 && el.innerText.trim().length < 200) {
        return el.innerText.trim();
      }
    }
    return document.title.split('|')[0].split('-')[0].trim();
  }

  /** @returns {string} The company name extracted from the page, or ''. */
  function extractCompany() {
    const selectors = [
      '.company-name', '[class*="company"]', '.posting-categories .location',
      '.jobs-unified-top-card__company-name',
      '[data-automation-id="company"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 1 && el.innerText.trim().length < 100) {
        return el.innerText.trim();
      }
    }
    return '';
  }

  /** @returns {string} The job location extracted from the page, or ''. */
  function extractLocation() {
    const selectors = [
      // LinkedIn
      '.jobs-unified-top-card__bullet',
      '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
      // Indeed
      '[data-testid="job-location"], .jobsearch-JobInfoHeader-subtitle > div:last-child',
      // Glassdoor
      '[data-test="emp-location"]',
      // Greenhouse
      '.location', '.job-post-location',
      // Lever
      '.posting-categories .sort-by-team.posting-category:nth-child(2)',
      '.posting-categories .location',
      // Workday
      '[data-automation-id="locations"]',
      // Generic
      '[class*="location"]', '[class*="job-location"]',
      '[data-field="location"]', '[itemprop="jobLocation"]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 1 && text.length < 150) return text;
        }
      } catch (e) { /* skip invalid selectors */ }
    }
    return '';
  }

  /** @returns {string} The salary/compensation text extracted from the page, or ''. */
  function extractSalary() {
    // Site-specific selectors
    const selectors = [
      // LinkedIn
      '.salary-main-rail__data-body',
      '.jobs-unified-top-card__job-insight--highlight span',
      // Indeed
      '#salaryInfoAndJobType', '.jobsearch-JobMetadataHeader-item',
      '[data-testid="attribute_snippet_testid"]',
      // Glassdoor
      '[data-test="detailSalary"]',
      // Greenhouse / Lever / Workday
      '[data-automation-id="salary"]',
      // Generic
      '[class*="salary"]', '[class*="compensation"]', '[class*="pay-range"]',
      '[data-field="salary"]'
    ];
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el) {
          const text = el.innerText.trim();
          if (text.length > 1 && text.length < 200 && /\d/.test(text)) return text;
        }
      } catch (e) { /* skip */ }
    }
    // Regex fallback: search JD text for salary patterns
    const jdText = (document.querySelector('.jobs-description__content') ||
                    document.querySelector('#jobDescriptionText') ||
                    document.querySelector('[class*="job-description"]') ||
                    document.body).innerText || '';
    const patterns = [
      /\$[\d,]+(?:\.\d{2})?\s*[-–to]+\s*\$[\d,]+(?:\.\d{2})?(?:\s*\/?\s*(?:year|yr|annually|hour|hr|month|mo))?/i,
      /\$[\d,]+(?:\.\d{2})?\s*(?:\/?\s*(?:year|yr|annually|hour|hr|month|mo))/i,
      /\d{2,3}k\s*[-–to]+\s*\d{2,3}k(?:\s*(?:\/?\s*(?:year|yr|annually))?)/i,
      /(?:salary|compensation|pay)[:\s]*\$[\d,]+(?:\s*[-–to]+\s*\$[\d,]+)?/i
    ];
    for (const pat of patterns) {
      const match = jdText.match(pat);
      if (match) return match[0].trim();
    }
    return '';
  }

  // ─── Analyze job ──────────────────────────────────────────────

  /**
   * Runs a job analysis for the current page: extracts the JD, sends it to the
   * AI via background.js, caches the result, and renders it in the panel.
   *
   * If a cached result exists for the current URL and forceRefresh is false,
   * the cached result is displayed immediately with no API call.
   *
   * @async
   * @param {boolean} [forceRefresh=false] - When true, bypasses the cache and
   *   always makes a fresh AI call (triggered by the "Re-Analyze" button).
   */
  async function analyzeJob(forceRefresh) {
    const btn = shadowRoot.getElementById('jmAnalyze');
    const pageUrl = window.location.href;

    // Check cache first (unless force re-analyze)
    const cached = await getCachedAnalysis(pageUrl);
    if (!forceRefresh && cached) {
      currentAnalysis = cached.analysis;
      showJobMeta(cached.title, cached.company, cached.location, cached.salary);
      renderAnalysis(cached.response);
      shadowRoot.getElementById('jmSaveJob').style.display = 'flex';
      shadowRoot.getElementById('jmCoverLetterBtn').style.display = 'flex';

      shadowRoot.getElementById('jmGenerateResumeBtn').style.display = 'flex';
      btn.textContent = 'Re-Analyze';
      setStatus('Showing cached results.', 'success');
      updateChatEmptyState();
      setTimeout(clearStatus, 2000);
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="jm-spinner"></span> Analyzing...';
    let analysisSucceeded = false;

    try {
      const jd = await extractJobDescription();
      const title = extractJobTitle();
      const company = extractCompany();
      const location = extractLocation();
      const salary = extractSalary();

      if (jd.length < 50) {
        setStatus('Could not find a job description on this page.', 'error');
        return;
      }

      showJobMeta(title, company, location, salary);

      // Warn if the extracted JD is too short to produce reliable results,
      // but don't block — the user can still trigger analysis.
      if (jd.length < 100) {
        setStatus('Could not extract enough job details from this page. Try copying the job description manually.', 'error');
        btn.disabled = false;
        btn.textContent = 'Analyze Job';
        return;
      }

      setStatus('Analyzing job match...', 'info');

      const response = await sendMessage({
        type: 'ANALYZE_JOB',
        jobDescription: jd,
        jobTitle: title,
        company: company,
        url: window.location.href
      });

      currentAnalysis = { ...response, title, company, location, salary, url: pageUrl };
      await setCachedAnalysis(pageUrl, { response, analysis: currentAnalysis, title, company, location, salary });
      analysisSucceeded = true;
      renderAnalysis(response);
      clearStatus();
      // Update Ask AI chat state so it knows analysis is available
      updateChatEmptyState();

      // Show truncation notices if text was trimmed
      shadowRoot.getElementById('jmTruncNotice').style.display = response.jdTruncated ? 'block' : 'none';
      shadowRoot.getElementById('jmResumeTruncNotice').style.display = response.truncated ? 'block' : 'none';

      // Show save, applied, cover letter, bullet rewriter buttons
      shadowRoot.getElementById('jmSaveJob').style.display = 'flex';
      const appliedBtn = shadowRoot.getElementById('jmMarkApplied');
      if (appliedBtn.textContent !== 'Applied') {
        appliedBtn.style.display = 'flex';
      }
      shadowRoot.getElementById('jmCoverLetterBtn').style.display = 'flex';

      shadowRoot.getElementById('jmGenerateResumeBtn').style.display = 'flex';
      // Reset any previous AI output sections
      shadowRoot.getElementById('jmCoverLetterSection').style.display = 'none';
      shadowRoot.getElementById('jmResumeSection').style.display = 'none';
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = analysisSucceeded ? 'Re-Analyze' : 'Analyze Job';
    }
  }

  /**
   * Renders the job title, company, location, and salary in the panel header.
   * Elements with no data are hidden to avoid empty UI gaps.
   * @param {string} title    - Job title text.
   * @param {string} company  - Company name.
   * @param {string} location - Job location string.
   * @param {string} salary   - Salary/compensation string.
   */
  function showJobMeta(title, company, location, salary) {
    const jobInfo = shadowRoot.getElementById('jmJobInfo');
    shadowRoot.getElementById('jmJobTitle').textContent = title;
    shadowRoot.getElementById('jmJobCompany').textContent = company;
    jobInfo.style.display = 'block';
    if (location) {
      shadowRoot.getElementById('jmJobLocationText').textContent = location;
      shadowRoot.getElementById('jmJobLocation').style.display = 'inline-flex';
    }
    if (salary) {
      shadowRoot.getElementById('jmJobSalaryText').textContent = salary;
      shadowRoot.getElementById('jmJobSalary').style.display = 'inline-flex';
    }
  }

  /**
   * Populates all analysis sections in the panel (score, matching skills,
   * missing skills, recommendations, insights, ATS keywords).
   * Each section is shown only if the AI returned data for it.
   * @param {Object} data - The analysis object returned by background.js handleAnalyzeJob.
   */
  function renderAnalysis(data) {
    // If JSON parsing failed, show a retry hint
    if (data._parseError) {
      setStatus('AI response format was unexpected. Try Re-Analyze for better results.', 'error');
    }

    // Score
    const scoreSection = shadowRoot.getElementById('jmScoreSection');
    const scoreCircle = shadowRoot.getElementById('jmScoreCircle');
    const score = data.matchScore || 0;
    scoreCircle.textContent = score;
    scoreCircle.className = 'jm-score-circle ' + getScoreClass(score);
    scoreSection.style.display = 'block';

    // Matching skills
    const matchingSection = shadowRoot.getElementById('jmMatchingSection');
    const matchingEl = shadowRoot.getElementById('jmMatchingSkills');
    if (data.matchingSkills && data.matchingSkills.length) {
      matchingEl.innerHTML = data.matchingSkills.map(s =>
        `<span class="jm-tag jm-tag-match">${escapeHTML(s)}</span>`
      ).join('');
      matchingSection.style.display = 'block';
    }

    // Missing skills
    const missingSection = shadowRoot.getElementById('jmMissingSection');
    const missingEl = shadowRoot.getElementById('jmMissingSkills');
    if (data.missingSkills && data.missingSkills.length) {
      missingEl.innerHTML = data.missingSkills.map(s =>
        `<span class="jm-tag jm-tag-missing">${escapeHTML(s)}</span>`
      ).join('');
      missingSection.style.display = 'block';
    }

    // Recommendations
    const recsSection = shadowRoot.getElementById('jmRecsSection');
    const recsEl = shadowRoot.getElementById('jmRecs');
    if (data.recommendations && data.recommendations.length) {
      recsEl.innerHTML = data.recommendations.map(r =>
        `<li>${escapeHTML(r)}</li>`
      ).join('');
      recsSection.style.display = 'block';
    }

    // Insights
    const insightsSection = shadowRoot.getElementById('jmInsightsSection');
    const insightsEl = shadowRoot.getElementById('jmInsights');
    if (data.insights) {
      let html = '';
      if (data.insights.strengths) {
        html += `<div class="jm-insight-block"><h4>Strengths</h4><p>${escapeHTML(data.insights.strengths)}</p></div>`;
      }
      if (data.insights.gaps) {
        html += `<div class="jm-insight-block"><h4>Gaps</h4><p>${escapeHTML(data.insights.gaps)}</p></div>`;
      }
      insightsEl.innerHTML = html;
      insightsSection.style.display = 'block';

      // Keywords
      if (data.insights.keywords && data.insights.keywords.length) {
        const keySection = shadowRoot.getElementById('jmKeywordsSection');
        const keyEl = shadowRoot.getElementById('jmKeywords');
        keyEl.innerHTML = data.insights.keywords.map(k =>
          `<span class="jm-tag jm-tag-keyword">${escapeHTML(k)}</span>`
        ).join('');
        keySection.style.display = 'block';
      }
    }
  }

  /**
   * Maps a 0–100 match score to a CSS class for color-coding the score circle.
   * @param {number} score - The match score.
   * @returns {'score-green'|'score-amber'|'score-red'}
   */
  function getScoreClass(score) {
    if (score >= 70) return 'score-green';
    if (score >= 45) return 'score-amber';
    return 'score-red';
  }

  // ─── Save job ─────────────────────────────────────────────────

  /**
   * Saves the current job to the user's saved-jobs list via background.js.
   * Requires a completed analysis (currentAnalysis must be non-null).
   * @async
   */
  async function saveJob() {
    if (!currentAnalysis) return;
    try {
      await sendMessage({
        type: 'SAVE_JOB',
        jobData: {
          title: currentAnalysis.title,
          company: currentAnalysis.company,
          location: currentAnalysis.location || '',
          salary: currentAnalysis.salary || '',
          score: currentAnalysis.matchScore,
          url: currentAnalysis.url,
          analysis: currentAnalysis,
        }
      });
      // Update button to "Saved" state
      const saveBtn = shadowRoot.getElementById('jmSaveJob');
      if (saveBtn) {
        saveBtn.textContent = 'Saved';
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.7';
      }
      setStatus('Job saved to tracker!', 'success');
      setTimeout(clearStatus, 2000);
    } catch (err) {
      setStatus('Error saving: ' + err.message, 'error');
    }
  }

  // ─── Mark as Applied ─────────────────────────────────────────

  /**
   * Records the current job as applied in the user's applied-jobs list.
   * Deduplication is handled by background.js (URL-based).
   * Updates the button text to "Applied ✓" on success.
   * @async
   */
  async function markApplied() {
    if (!currentAnalysis) return;
    const btn = shadowRoot.getElementById('jmMarkApplied');
    btn.disabled = true;
    try {
      await sendMessage({
        type: 'MARK_APPLIED',
        jobData: {
          title: currentAnalysis.title,
          company: currentAnalysis.company,
          location: currentAnalysis.location || '',
          salary: currentAnalysis.salary || '',
          score: currentAnalysis.matchScore || 0,
          url: currentAnalysis.url
        }
      });
      btn.textContent = 'Applied';
      btn.className = 'jm-btn jm-btn-applied-done';
      setStatus('Marked as applied!', 'success');
      setTimeout(clearStatus, 2000);
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
      btn.disabled = false;
    }
  }

  async function checkIfApplied() {
    try {
      const jobs = await sendMessage({ type: 'GET_APPLIED_JOBS' });
      if (jobs && jobs.some(j => j.url === window.location.href)) {
        const btn = shadowRoot.getElementById('jmMarkApplied');
        btn.textContent = 'Applied';
        btn.className = 'jm-btn jm-btn-applied-done';
        btn.style.display = 'flex';
      }
    } catch (e) { /* ignore */ }
  }

  // ─── AutoFill ─────────────────────────────────────────────────
  // The autofill pipeline:
  //   1. Detect — detectFormFields() scans the page and builds _fieldMap.
  //   2. AI     — GENERATE_AUTOFILL sends questions to background, gets answers.
  //   3. Fill   — fillFormFromAnswers() immediately writes answers into the form.

  /**
   * Initiates the autofill pipeline: detects fields, asks AI for answers,
   * then immediately fills the form.
   * @async
   */
  async function autofillForm() {
    const btn = shadowRoot.getElementById('jmAutofill');
    btn.disabled = true;
    btn.innerHTML = '<span class="jm-spinner"></span> Scanning form...';

    try {
      // Step 1: detect fields and store DOM references
      _fieldMap = {};
      const questions = detectFormFields();
      if (questions.length === 0) {
        setStatus('No form fields found on this page.', 'error');
        return;
      }

      setStatus(`Found ${questions.length} fields. Filling...`, 'info');

      // Step 2: send serializable questions to AI (no DOM refs)
      const questionsForAI = questions.map(q => {
        const clean = { ...q };
        delete clean._el;
        delete clean._radios;
        return clean;
      });

      const response = await sendMessage({
        type: 'GENERATE_AUTOFILL',
        formFields: questionsForAI
      });

      // Step 3: directly fill the form
      const answers = response.answers || response;
      const { filled, skipped } = await fillFormFromAnswers(answers);
      const msg = `Filled ${filled} field${filled === 1 ? '' : 's'}` +
        (skipped.length ? ` (${skipped.length} need your input)` : '');
      setStatus(msg, 'success');
      setTimeout(clearStatus, 3000);
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'AutoFill Application';
    }
  }

  /**
   * Renders the autofill preview panel, showing each detected field alongside
   * the AI's proposed answer.  Fields flagged as NEEDS_USER_INPUT are highlighted.
   * Stores answers and questions in _pendingAnswers/_pendingQuestions for applyAutofill.
   * @param {Array<Object>} answers   - AI answer objects from GENERATE_AUTOFILL.
   * @param {Array<Object>} questions - Detected form field descriptors.
   */
  function showAutofillPreview(answers, questions) {
    const previewSection = shadowRoot.getElementById('jmAutofillPreview');
    const list = shadowRoot.getElementById('jmPreviewList');
    const countEl = shadowRoot.getElementById('jmPreviewCount');

    list.innerHTML = '';

    const questionMap = {};
    questions.forEach(q => { questionMap[q.question_id] = q; });

    let fillableCount = 0;
    let needsInputCount = 0;

    (Array.isArray(answers) ? answers : []).forEach(ans => {
      const val = ans.selected_option || ans.generated_text || '';
      const isNeeded = !val || val === 'NEEDS_USER_INPUT';
      const qInfo = questionMap[ans.question_id];
      const label = qInfo?.question_text || ans.question_id || '';

      if (isNeeded) needsInputCount++;
      else fillableCount++;

      const row = document.createElement('div');
      row.className = 'jm-preview-row' + (isNeeded ? ' jm-needs-input' : '');
      row.dataset.qid = ans.question_id;

      if (isNeeded) {
        row.innerHTML = `
          <div style="flex:1">
            <div class="jm-preview-label">${escapeHTML(label)}</div>
            <div class="jm-preview-val">&#9888; Needs manual input</div>
          </div>`;
      } else {
        const displayVal = val.length > 70 ? val.substring(0, 70) + '…' : val;
        row.innerHTML = `
          <input type="checkbox" checked data-qid="${escapeHTML(ans.question_id)}">
          <div style="flex:1;min-width:0">
            <div class="jm-preview-label">${escapeHTML(label)}</div>
            <div class="jm-preview-val" title="${escapeHTML(val)}">${escapeHTML(displayVal)}</div>
          </div>`;
      }
      list.appendChild(row);
    });

    countEl.textContent = `— ${fillableCount} fillable, ${needsInputCount} need manual input`;
    previewSection.style.display = 'block';
    scrollPanelTo(previewSection);
  }

  /**
   * Applies the pending autofill answers to the form (phase 3 of the pipeline).
   * Called when the user clicks "Apply Selected" in the preview panel.
   * Shows a summary toast indicating how many fields were filled vs skipped.
   * @async
   */
  async function applyAutofill() {
    if (!_pendingAnswers) return;
    const applyBtn = shadowRoot.getElementById('jmApplyFill');
    applyBtn.disabled = true;
    applyBtn.innerHTML = '<span class="jm-spinner"></span> Filling...';

    try {
      const checkedIds = new Set(
        Array.from(shadowRoot.querySelectorAll('#jmPreviewList input[type="checkbox"]:checked'))
          .map(cb => cb.dataset.qid)
      );

      const selectedAnswers = (Array.isArray(_pendingAnswers) ? _pendingAnswers : [])
        .filter(a => checkedIds.has(a.question_id));

      const { filled, skipped } = await fillFormFromAnswers(selectedAnswers);

      let msg = `Filled ${filled} of ${selectedAnswers.length} selected fields.`;
      if (skipped.length > 0) {
        msg += ` ${skipped.length} could not be filled — check manually.`;
      }
      msg += ' Review before submitting!';
      setStatus(msg, 'success');

      shadowRoot.getElementById('jmAutofillPreview').style.display = 'none';
      _pendingAnswers = null;
      _pendingQuestions = [];
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    } finally {
      applyBtn.disabled = false;
      applyBtn.innerHTML = 'Apply Selected';
    }
  }

  /** Dismisses the autofill preview panel and clears pending state. */
  function cancelAutofill() {
    shadowRoot.getElementById('jmAutofillPreview').style.display = 'none';
    _pendingAnswers = null;
    _pendingQuestions = [];
    clearStatus();
  }

  // ─── Inline autofill chips ────────────────────────────────────
  // Chips are injected directly into document.body (not Shadow DOM) so they
  // can be positioned right next to the actual form fields on the page.
  // Each chip shows the AI's proposed answer with ✓ Accept, ✗ Dismiss, and
  // inline editing. A sticky bar at the bottom provides Apply All / Dismiss All.

  const CHIP_STYLE_ID = 'jmai-chip-styles'; // ID of the injected <style> tag

  /**
   * Injects chip CSS into document.head once. Uses a unique `jmai-` prefix
   * to avoid colliding with the host page's styles.
   */
  function injectChipStyles() {
    if (document.getElementById(CHIP_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = CHIP_STYLE_ID;
    style.textContent = `
      .jmai-chip {
        position: fixed;
        z-index: 2147483640;
        background: #fff;
        border: 1.5px solid #3b82f6;
        border-radius: 10px;
        box-shadow: 0 3px 14px rgba(59,130,246,0.22);
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 5px 7px 5px 9px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 12px;
        color: #1e293b;
        max-width: 360px;
        min-width: 140px;
        pointer-events: all;
        transition: opacity 0.18s, transform 0.18s;
      }
      .jmai-chip.jmai-needs-input {
        border-color: #f59e0b;
        background: #fffbeb;
      }
      .jmai-chip-icon { font-size: 12px; flex-shrink: 0; color: #3b82f6; }
      .jmai-chip.jmai-needs-input .jmai-chip-icon { color: #f59e0b; }
      .jmai-chip-answer {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        cursor: text;
        padding: 2px 4px;
        border-radius: 4px;
        border: 1px solid transparent;
        font-size: 12px;
      }
      .jmai-chip-answer:focus {
        outline: none;
        border-color: #3b82f6;
        background: #eff6ff;
        white-space: normal;
        overflow: visible;
      }
      .jmai-chip-answer[data-empty]:before {
        content: attr(data-placeholder);
        color: #94a3b8;
        font-style: italic;
      }
      .jmai-chip-accept, .jmai-chip-dismiss {
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        font-size: 13px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        line-height: 1;
      }
      .jmai-chip-accept { background: #059669; color: #fff; }
      .jmai-chip-accept:hover { background: #047857; }
      .jmai-chip-dismiss { background: #f1f5f9; color: #64748b; }
      .jmai-chip-dismiss:hover { background: #fecaca; color: #dc2626; }
      .jmai-chip.jmai-fade-out {
        opacity: 0;
        transform: scale(0.88) translateY(-4px);
        pointer-events: none;
      }
      .jmai-chip-bar {
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 2147483641;
        background: #3b82f6;
        color: #fff;
        padding: 10px 20px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        box-shadow: 0 -3px 20px rgba(59,130,246,0.3);
      }
      .jmai-bar-logo { font-size: 16px; }
      .jmai-bar-text { flex: 1; font-weight: 500; }
      .jmai-bar-apply {
        background: #fff;
        color: #3b82f6;
        border: none;
        border-radius: 7px;
        padding: 6px 18px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        transition: background 0.15s;
      }
      .jmai-bar-apply:hover { background: #eff6ff; }
      .jmai-bar-dismiss {
        background: rgba(255,255,255,0.18);
        color: #fff;
        border: 1.5px solid rgba(255,255,255,0.4);
        border-radius: 7px;
        padding: 6px 14px;
        font-size: 13px;
        cursor: pointer;
      }
      .jmai-bar-dismiss:hover { background: rgba(255,255,255,0.28); }
      .jmai-field-ring {
        outline: 2.5px solid #3b82f6 !important;
        outline-offset: 2px !important;
      }
      .jmai-badge {
        position: fixed;
        z-index: 2147483639;
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 2px 7px 2px 5px;
        background: #ecfdf5;
        border: 1px solid #10b981;
        border-radius: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 10px;
        font-weight: 500;
        color: #065f46;
        pointer-events: none;
        user-select: none;
        white-space: nowrap;
        box-shadow: 0 1px 4px rgba(16,185,129,0.15);
      }
      .jmai-badge svg {
        width: 10px;
        height: 10px;
        flex-shrink: 0;
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * Shows a small fixed-position "✦ Refined by Applicant Copilot" pill anchored to
   * the bottom-right corner of the filled field. Uses position:fixed so it never
   * pushes other elements down or disrupts the page layout.
   * @param {Element} el - The filled form element (input, select, radio, etc.).
   */
  function showAutofillBadge(el) {
    if (!el) return;
    injectChipStyles();

    const badge = document.createElement('div');
    badge.className = 'jmai-badge';
    badge.innerHTML = `<svg viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 1l1 3h3l-2.5 1.8.95 3L6 7.2 3.55 8.8l.95-3L2 4h3L6 1z" fill="#10b981"/>
    </svg>Refined by Applicant Copilot`;
    document.body.appendChild(badge);

    // Position badge at the bottom-right corner of the field
    function place() {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // element not visible
      badge.style.top  = (r.bottom - 1) + 'px';
      badge.style.left = Math.max(0, r.right - badge.offsetWidth) + 'px';
    }
    place();

    _badges.push({ badgeEl: badge, fieldEl: el, place });

    // Reposition on scroll/resize using shared listeners (set up once)
    if (_badges.length === 1) {
      _badgeScrollHandler = () => _badges.forEach(b => b.place());
      window.addEventListener('scroll', _badgeScrollHandler, { passive: true, capture: true });
      _badgeResizeObs = new ResizeObserver(() => _badges.forEach(b => b.place()));
      _badgeResizeObs.observe(document.body);
    }
  }

  /** Removes all autofill badges and their scroll/resize listeners. */
  function clearAutofillBadges() {
    _badges.forEach(({ badgeEl }) => badgeEl.remove());
    _badges = [];
    if (_badgeScrollHandler) {
      window.removeEventListener('scroll', _badgeScrollHandler, { capture: true });
      _badgeScrollHandler = null;
    }
    if (_badgeResizeObs) { _badgeResizeObs.disconnect(); _badgeResizeObs = null; }
  }

  /**
   * Main entry point: creates a chip for every AI answer that has a value,
   * positions each chip near its form field, and shows the sticky bottom bar.
   * @param {Array<Object>} answers - AI answer objects from GENERATE_AUTOFILL.
   */
  function showInlineChips(answers) {
    clearAllChips();
    injectChipStyles();

    if (!Array.isArray(answers)) answers = answers ? [answers] : [];

    let count = 0;

    answers.forEach(ans => {
      const val   = (ans.answer_value || ans.answer || '').trim();
      const qid   = ans.question_id;
      const ref   = _fieldMap[qid];
      if (!ref) return;

      // Resolve the DOM element to anchor the chip to
      const fieldEl = ref.type === 'radio'
        ? ref.options?.[0]?.el     // first radio button in the group
        : ref.el;
      if (!fieldEl) return;

      const needsInput = !val || val === 'NEEDS_USER_INPUT' || val === 'SKIP';

      // Highlight the field so the user can see it's detected
      fieldEl.classList.add('jmai-field-ring');

      // ── Build the chip ──────────────────────────────────────────
      const chip = document.createElement('div');
      chip.className = 'jmai-chip' + (needsInput ? ' jmai-needs-input' : '');
      chip.dataset.qid = qid;

      // Icon
      const icon = document.createElement('span');
      icon.className = 'jmai-chip-icon';
      icon.textContent = needsInput ? '?' : '★';

      // Editable answer text
      const ansEl = document.createElement('span');
      ansEl.className = 'jmai-chip-answer';
      ansEl.contentEditable = 'true';
      ansEl.spellcheck = false;
      if (needsInput) {
        ansEl.setAttribute('data-empty', '');
        ansEl.setAttribute('data-placeholder', 'Enter your answer…');
        ansEl.title = `${ans.question_text || 'Field'} — enter your answer`;
      } else {
        ansEl.textContent = val;
        ansEl.title = `${ans.question_text || 'Field'}: ${val} — click to edit`;
      }
      // Remove empty-placeholder attribute once user starts typing
      ansEl.addEventListener('input', () => {
        if (ansEl.textContent.trim()) ansEl.removeAttribute('data-empty');
        else ansEl.setAttribute('data-empty', '');
      });

      // ✓ Accept button
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'jmai-chip-accept';
      acceptBtn.textContent = '✓';
      acceptBtn.title = 'Apply this answer';

      // ✗ Dismiss button
      const dismissBtn = document.createElement('button');
      dismissBtn.className = 'jmai-chip-dismiss';
      dismissBtn.textContent = '✕';
      dismissBtn.title = 'Skip this field';

      chip.appendChild(icon);
      chip.appendChild(ansEl);
      chip.appendChild(acceptBtn);
      chip.appendChild(dismissBtn);
      document.body.appendChild(chip);

      const chipData = { chipEl: chip, fieldEl, ans, ansEl };
      _chips.set(qid, chipData);
      positionChip(chip, fieldEl);
      count++;

      // ── Accept handler ──────────────────────────────────────────
      acceptBtn.addEventListener('click', async () => {
        const currentVal = ansEl.textContent.trim();
        if (!currentVal) { ansEl.focus(); return; } // force user to type something for empty fields
        ans.answer_value = currentVal;
        ans.answer       = currentVal;
        await fillSingleField(ans);
        removeChip(qid);
      });

      // ── Dismiss handler ─────────────────────────────────────────
      dismissBtn.addEventListener('click', () => removeChip(qid));
    });

    if (count === 0) {
      setStatus('No fillable fields detected on this page.', 'info');
      setTimeout(clearStatus, 2500);
      return;
    }

    createChipBar(count);

    // Reposition chips on scroll (page scrolls, field rects change)
    _chipScrollHandler = repositionAllChips;
    window.addEventListener('scroll', _chipScrollHandler, { passive: true });

    // Reposition chips if the page layout changes (e.g. accordions opening)
    _chipResizeObs = new ResizeObserver(repositionAllChips);
    _chipResizeObs.observe(document.documentElement);
  }

  /**
   * Positions a chip above the field if space allows, otherwise below.
   * Uses position:fixed with getBoundingClientRect() so it tracks the viewport.
   * @param {HTMLElement} chipEl  - The chip element.
   * @param {HTMLElement} fieldEl - The form field to anchor to.
   */
  function positionChip(chipEl, fieldEl) {
    const rect = fieldEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      chipEl.style.display = 'none'; // field not visible — hide chip
      return;
    }
    chipEl.style.display = '';

    // Width: match field width, clamped between 160px and 360px
    const w = Math.min(360, Math.max(160, rect.width));
    chipEl.style.width = w + 'px';

    // Horizontal: align left edge with field, clamp to viewport
    const left = Math.min(Math.max(4, rect.left), window.innerWidth - w - 4);
    chipEl.style.left = left + 'px';

    // Vertical: prefer above (need ~42px clearance), fall back to below
    const CHIP_H = 42;
    if (rect.top >= CHIP_H + 6) {
      chipEl.style.top = (rect.top - CHIP_H - 4) + 'px';
    } else {
      chipEl.style.top = (rect.bottom + 4) + 'px';
    }
  }

  /** Repositions all visible chips — called on scroll/resize. */
  function repositionAllChips() {
    _chips.forEach(({ chipEl, fieldEl }) => positionChip(chipEl, fieldEl));
  }

  /**
   * Removes a single chip with a fade animation, unhighlights its field,
   * and updates the bottom bar count. Clears everything when the last chip goes.
   * @param {string} qid - The question_id of the chip to remove.
   */
  function removeChip(qid) {
    const data = _chips.get(qid);
    if (!data) return;
    const { chipEl, fieldEl } = data;
    fieldEl.classList.remove('jmai-field-ring');
    chipEl.classList.add('jmai-fade-out');
    setTimeout(() => { chipEl.remove(); }, 200);
    _chips.delete(qid);
    if (_chips.size === 0) {
      clearAllChips();
      // Reset the AutoFill button
      const btn = shadowRoot && shadowRoot.getElementById('jmAutofill');
      if (btn) { btn.innerHTML = 'AutoFill Application'; btn.onclick = null; }
    } else {
      updateChipBar();
    }
  }

  /**
   * Creates the sticky bottom bar with Apply All / Dismiss All controls.
   * @param {number} count - Initial suggestion count for the label.
   */
  function createChipBar(count) {
    if (_chipBar) _chipBar.remove();
    const bar = document.createElement('div');
    bar.className = 'jmai-chip-bar';
    bar.innerHTML = `
      <span class="jmai-bar-logo">★</span>
      <span class="jmai-bar-text">${count} suggestion${count === 1 ? '' : 's'} ready</span>
      <button class="jmai-bar-apply">Apply All</button>
      <button class="jmai-bar-dismiss">Dismiss All</button>
    `;
    document.body.appendChild(bar);
    _chipBar = bar;
    bar.querySelector('.jmai-bar-apply').addEventListener('click', applyAllChips);
    bar.querySelector('.jmai-bar-dismiss').addEventListener('click', clearAllChips);
  }

  /** Updates the suggestion count label in the bottom bar. */
  function updateChipBar() {
    if (!_chipBar) return;
    const n = _chips.size;
    const label = _chipBar.querySelector('.jmai-bar-text');
    if (label) label.textContent = `${n} suggestion${n === 1 ? '' : 's'} remaining`;
  }

  /**
   * Applies all remaining chip answers to their respective form fields, then cleans up.
   * Skips any chip whose answer text is empty.
   * @async
   */
  async function applyAllChips() {
    const entries = Array.from(_chips.values());
    let filled = 0;
    for (const { ans, ansEl, fieldEl } of entries) {
      const currentVal = ansEl.textContent.trim();
      if (!currentVal || currentVal === 'NEEDS_USER_INPUT') continue;
      ans.answer_value = currentVal;
      ans.answer       = currentVal;
      await fillSingleField(ans);
      fieldEl.classList.remove('jmai-field-ring');
      filled++;
    }
    // Show brief success message in the bar before clearing
    if (_chipBar) {
      const label = _chipBar.querySelector('.jmai-bar-text');
      if (label) label.textContent = `✓ ${filled} field${filled === 1 ? '' : 's'} filled!`;
    }
    setTimeout(() => {
      clearAllChips();
      const btn = shadowRoot && shadowRoot.getElementById('jmAutofill');
      if (btn) { btn.innerHTML = 'AutoFill Application'; btn.onclick = null; }
    }, 700);
  }

  /**
   * Removes all chips, the bottom bar, field highlights, and event listeners.
   * Safe to call even when no chips are active.
   */
  function clearAllChips() {
    _chips.forEach(({ chipEl, fieldEl }) => {
      fieldEl.classList.remove('jmai-field-ring');
      chipEl.remove();
    });
    _chips.clear();
    if (_chipBar)          { _chipBar.remove();                _chipBar = null; }
    if (_chipScrollHandler){ window.removeEventListener('scroll', _chipScrollHandler); _chipScrollHandler = null; }
    if (_chipResizeObs)    { _chipResizeObs.disconnect();      _chipResizeObs = null; }
  }

  /**
   * Fills a single form field from one AI answer object.
   * Routes to the correct fill function based on the field type in _fieldMap.
   * @async
   * @param {Object} ans - Answer object with question_id and answer_value.
   */
  async function fillSingleField(ans) {
    const ref = _fieldMap[ans.question_id];
    if (!ref) return;
    const val = (ans.answer_value || ans.answer || '').trim();
    if (!val) return;
    try {
      if (ref.type === 'dropdown') {
        const questionText = ref.questionText || ans.question_text || '';
        if (questionText && ref.optionTexts?.length) {
          const best = await sendMessage({ type: 'MATCH_DROPDOWN', questionText, options: ref.optionTexts });
          if (best && best !== 'SKIP' && best !== 'NEEDS_USER_INPUT') {
            fillSelectByText(ref.el, best, ref.optionMap, ref.optionTexts);
            return;
          }
        }
        fillSelectByText(ref.el, val, ref.optionMap, ref.optionTexts);
      } else if (ref.type === 'custom_dropdown') {
        await fillCustomDropdown(ref.el, ref.questionText || val);
      } else if (ref.type === 'radio') {
        fillRadioFromRef(ref.options, val);
      } else if (ref.type === 'checkbox') {
        fillCheckboxFromRef(ref.el, val);
      } else {
        fillInput(ref.el, val);
      }
    } catch (_) { /* ignore individual fill errors — don't block other fields */ }
  }

  // ─── Form field detection ─────────────────────────────────────
  // Scans the live DOM for all fillable form fields and builds two data structures:
  //   questions[] — serialisable descriptors sent to the AI (label, type, options)
  //   _fieldMap   — maps each question_id to the actual DOM element(s) for filling
  //
  // Supported field types: text/email/tel/number inputs, textareas, native <select>,
  // custom dropdown triggers (aria-combobox, aria-haspopup), radio groups, checkboxes.

  /**
   * Detects all fillable form fields on the current page.
   * Populates the module-level _fieldMap and returns a serialisable questions array.
   * @returns {Array<Object>} Array of field descriptors to send to the AI.
   */
  function detectFormFields() {
    const questions = [];
    let qIndex = 0;
    const seen = new Set(); // track qids to avoid duplicates

    // ── Helper: build select option data ──
    function buildSelectOptions(selectEl) {
      const optMap = {};
      const optTexts = [];
      Array.from(selectEl.options).forEach(o => {
        const v = o.value.trim();
        const t = o.textContent.trim();
        if (!v || v === '' || v === '-1') return;
        if (!t || /^(select|choose|--|pick)/i.test(t)) return;
        optTexts.push(t);
        optMap[t.toLowerCase()] = o.value;
      });
      return { optMap, optTexts };
    }

    // ── Helper: detect if an input is a custom dropdown trigger ──
    function isCustomDropdown(el) {
      if (el.getAttribute('role') === 'combobox') return true;
      if (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-haspopup') === 'true') return true;
      if (el.getAttribute('aria-autocomplete')) return true;
      if (el.getAttribute('data-testid')?.includes('select')) return true;
      // Check if parent/grandparent looks like a select wrapper
      const wrapper = el.closest('[class*="select"], [class*="dropdown"], [class*="combobox"], [class*="listbox"]');
      if (wrapper && wrapper.querySelector('[role="listbox"], [role="option"], [class*="option"]')) return true;
      return false;
    }

    // ── Helper: read options from custom dropdown's associated listbox ──
    function readCustomOptions(el) {
      const optTexts = [];
      // 1. Check aria-controls / aria-owns
      const listboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      if (listboxId) {
        const lb = document.getElementById(listboxId);
        if (lb) {
          lb.querySelectorAll('[role="option"]').forEach(o => {
            const t = o.textContent.trim();
            if (t) optTexts.push(t);
          });
          if (optTexts.length > 0) return optTexts;
        }
      }
      // 2. Search nearby in DOM
      const container = el.closest('[class*="select"], [class*="dropdown"], [class*="field"], [data-testid]') || el.parentElement;
      if (container) {
        container.querySelectorAll('[role="option"], [class*="option"]:not([class*="options"])').forEach(o => {
          const t = o.textContent.trim();
          if (t && !optTexts.includes(t)) optTexts.push(t);
        });
      }
      return optTexts;
    }

    // ── 1. ALL <select> elements (visible AND hidden) ──
    document.querySelectorAll('select').forEach(sel => {
      const qid = sel.id || sel.name;
      if (!qid || seen.has(qid)) return;
      const label = getFieldLabel(sel);
      if (!label && !sel.id && !sel.name) return;

      const { optMap, optTexts } = buildSelectOptions(sel);
      if (optTexts.length === 0) return;

      seen.add(qid);
      questions.push({
        question_id: qid,
        question_text: label || sel.name || '',
        field_type: 'dropdown',
        required: sel.required,
        available_options: optTexts
      });
      _fieldMap[qid] = { el: sel, type: 'dropdown', optionMap: optMap, optionTexts: optTexts, questionText: label || sel.name || '' };
      qIndex++;
    });

    // ── 2. Text inputs, textareas (detect custom dropdowns among them) ──
    document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea'
    ).forEach(input => {
      if (input.offsetParent === null) return;
      const label = getFieldLabel(input);
      const qid = input.id || input.name || ('q_' + qIndex);
      if ((!label && !input.id && !input.name) || seen.has(qid)) return;

      const tag = input.tagName.toLowerCase();

      // Check if this text input is actually a custom dropdown
      if (tag !== 'textarea' && isCustomDropdown(input)) {
        const optTexts = readCustomOptions(input);
        seen.add(qid);
        questions.push({
          question_id: qid,
          question_text: label || input.placeholder || input.name || '',
          field_type: 'dropdown',
          required: input.required,
          available_options: optTexts // may be empty — will be read during fill
        });
        _fieldMap[qid] = { el: input, type: 'custom_dropdown', optionTexts: optTexts, questionText: label || input.placeholder || input.name || '' };
        qIndex++;
        return;
      }

      // Check if a hidden <select> shares this field's container (custom select wrappers)
      const container = input.closest('.field, .form-field, .form-group, [class*="field"], [class*="select"]');
      if (container) {
        const hiddenSelect = container.querySelector('select');
        if (hiddenSelect && !seen.has(hiddenSelect.id || hiddenSelect.name)) {
          const selQid = hiddenSelect.id || hiddenSelect.name || qid;
          if (!seen.has(selQid)) {
            const { optMap, optTexts } = buildSelectOptions(hiddenSelect);
            if (optTexts.length > 0) {
              seen.add(selQid);
              seen.add(qid);
              questions.push({
                question_id: selQid,
                question_text: label || input.placeholder || '',
                field_type: 'dropdown',
                required: input.required || hiddenSelect.required,
                available_options: optTexts
              });
              // Store BOTH the hidden select and the visible input
              _fieldMap[selQid] = {
                el: hiddenSelect, visibleEl: input,
                type: 'dropdown', optionMap: optMap, optionTexts: optTexts,
                questionText: label || input.placeholder || ''
              };
              qIndex++;
              return;
            }
          }
        }
      }

      // Regular text / textarea
      seen.add(qid);
      const fieldType = tag === 'textarea' ? 'textarea' : 'text';
      questions.push({
        question_id: qid,
        question_text: label || input.placeholder || input.name || '',
        field_type: fieldType,
        required: input.required
      });
      _fieldMap[qid] = { el: input, type: fieldType };
      qIndex++;
    });

    // ── 3. Radio button groups ──
    const radioGroups = {};
    document.querySelectorAll('input[type="radio"]').forEach(radio => {
      if (radio.offsetParent === null) return;
      const groupName = radio.name;
      if (!groupName) return;
      if (!radioGroups[groupName]) {
        radioGroups[groupName] = {
          question_id: groupName,
          question_text: getFieldLabel(radio) || groupName.replace(/[_-]/g, ' '),
          field_type: 'radio',
          required: radio.required,
          available_options: [],
          _radios: []
        };
        _fieldMap[groupName] = { type: 'radio', radios: [] };
      }
      const optText = getRadioLabel(radio);
      if (optText && !radioGroups[groupName].available_options.includes(optText)) {
        radioGroups[groupName].available_options.push(optText);
      }
      radioGroups[groupName]._radios.push(radio);
      _fieldMap[groupName].radios.push({ el: radio, text: optText });
    });
    for (const group of Object.values(radioGroups)) {
      if (group.available_options.length > 0) {
        const clean = { ...group };
        delete clean._radios;
        questions.push(clean);
      }
    }

    // ── 4. Standalone checkboxes ──
    document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.offsetParent === null) return;
      const label = getFieldLabel(cb) || getRadioLabel(cb);
      if (!label) return;
      const qid = cb.id || cb.name || ('cb_' + qIndex);
      if (seen.has(qid)) return;
      seen.add(qid);
      questions.push({
        question_id: qid,
        question_text: label,
        field_type: 'checkbox',
        required: cb.required,
        available_options: ['Yes', 'No']
      });
      _fieldMap[qid] = { el: cb, type: 'checkbox' };
      qIndex++;
    });

    return questions;
  }

  /**
   * Extracts the visible label text for a radio button.
   * Clones the parent label and strips the input element to get only text.
   * @param {HTMLInputElement} input - A radio input element.
   * @returns {string} The label text, or '' if not determinable.
   */
  function getRadioLabel(input) {
    const parentLabel = input.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input').forEach(el => el.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }
    const next = input.nextSibling;
    if (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim()) {
      return next.textContent.trim();
    }
    if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'LABEL') {
      return next.textContent.trim();
    }
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
    if (input.value && input.value !== 'on') return input.value;
    return '';
  }

  /**
   * Resolves a human-readable label for a form input using multiple strategies:
   * 1. <label for="id"> association, 2. wrapping <label>, 3. aria-label/aria-labelledby,
   * 4. placeholder, 5. nearby sibling/parent text.
   * @param {HTMLElement} input - Any form element.
   * @returns {string} The best label text found, or ''.
   */
  function getFieldLabel(input) {
    // 1. <label for="id">
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return label.textContent.trim();
    }

    // 2. Wrapping <label>
    const parentLabel = input.closest('label');
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true);
      clone.querySelectorAll('input, textarea, select').forEach(el => el.remove());
      const text = clone.textContent.trim();
      if (text) return text;
    }

    // 3. aria-label
    if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');

    // 4. aria-labelledby
    const labelledBy = input.getAttribute('aria-labelledby');
    if (labelledBy) {
      const el = document.getElementById(labelledBy);
      if (el) return el.textContent.trim();
    }

    // 5. placeholder
    if (input.placeholder) return input.placeholder;

    // 6. name attribute (humanized)
    if (input.name) return input.name.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

    return '';
  }

  // ─── Form filling (uses _fieldMap from detection) ────────────

  /**
   * Fills form fields using AI-generated answers and the _fieldMap built by detectFormFields.
   * Routes each answer to the correct fill strategy based on the field type:
   *   - 'dropdown'        → fillSelectByText (native <select>)
   *   - 'custom_dropdown' → fillCustomDropdown (ARIA combobox, opens a listbox)
   *   - 'radio'           → fillRadioFromRef
   *   - 'checkbox'        → fillCheckboxFromRef
   *   - default           → fillInput (text/textarea/email/etc.)
   *
   * Falls back to fillFormLegacy() if answers is a plain object (old AI response format).
   * @async
   * @param {Array<Object>|Object} answers - AI answer array or legacy flat object.
   * @returns {Promise<{filled: number, skipped: string[]}>}
   */
  async function fillFormFromAnswers(answers) {
    // Handle array format (new) or flat object (legacy)
    if (!Array.isArray(answers)) {
      return await fillFormLegacy(answers);
    }

    let filled = 0;
    const skipped = [];

    for (const ans of answers) {
      const val = ans.selected_option || ans.generated_text || '';
      if (!val || val === 'NEEDS_USER_INPUT') {
        skipped.push(ans.question_id);
        continue;
      }
      const qid = ans.question_id;

      try {
        const ref = _fieldMap[qid];
        if (!ref) {
          skipped.push(qid);
          continue;
        }


        // Route by ACTUAL element type
        if (ref.type === 'dropdown') {
          // For native selects: use deterministic matcher via background for better accuracy
          const questionText = ref.questionText || ans.question_text || '';
          if (questionText && ref.optionTexts && ref.optionTexts.length > 0) {
            try {
              const bestOption = await sendMessage({
                type: 'MATCH_DROPDOWN',
                questionText: questionText,
                options: ref.optionTexts
              });
              if (bestOption && bestOption !== 'SKIP' && bestOption !== 'NEEDS_USER_INPUT') {
                fillSelectByText(ref.el, bestOption, ref.optionMap, ref.optionTexts);
                showAutofillBadge(ref.el);
                filled++;
                continue;
              }
            } catch (e) {
            }
          }
          // Fallback: use the bulk AI answer directly
          fillSelectByText(ref.el, val, ref.optionMap, ref.optionTexts);
          showAutofillBadge(ref.el);
          filled++;
        } else if (ref.type === 'custom_dropdown') {
          if (await fillCustomDropdown(ref.el, ref.questionText || val)) {
            showAutofillBadge(ref.el);
            filled++;
          } else {
            skipped.push(qid);
          }
        } else if (ref.type === 'radio') {
          if (fillRadioFromRef(ref.radios, val)) {
            // Badge goes below the last radio in the group
            const lastRadio = ref.radios[ref.radios.length - 1]?.el || ref.radios[0]?.el;
            showAutofillBadge(lastRadio);
            filled++;
          } else {
            skipped.push(qid);
          }
        } else if (ref.type === 'checkbox') {
          fillCheckboxFromRef(ref.el, val);
          showAutofillBadge(ref.el);
          filled++;
        } else {
          fillInput(ref.el, val);
          showAutofillBadge(ref.el);
          filled++;
        }
      } catch (e) {
        skipped.push(qid);
      }
    }
    return { filled, skipped };
  }

  /**
   * Legacy fill path for old-format AI responses (flat key→value object).
   * Used as a fallback when the AI returns a map instead of an array.
   * @async
   * @param {Object} mapping - Map of field identifiers to answer strings.
   * @returns {Promise<{filled: number, skipped: []}>}
   */
  async function fillFormLegacy(mapping) {
    let filled = 0;
    for (const [key, value] of Object.entries(mapping)) {
      if (!value || value === 'NEEDS_USER_INPUT') continue;
      const ref = _fieldMap[key];
      if (!ref) continue;
      if (ref.type === 'dropdown') {
        fillSelectByText(ref.el, value, ref.optionMap, ref.optionTexts);
        showAutofillBadge(ref.el);
      } else if (ref.type === 'custom_dropdown') {
        await fillCustomDropdown(ref.el, ref.questionText || value);
        showAutofillBadge(ref.el);
      } else {
        fillInput(ref.el, value);
        showAutofillBadge(ref.el);
      }
      filled++;
    }
    return { filled, skipped: [] };
  }

  // ── Custom dropdown: open → read options → ask AI → click chosen option ──
  // Custom dropdowns (used by Workday, Greenhouse, Lever, etc.) are not native
  // <select> elements — they are ARIA comboboxes that render a listbox on click.
  // Strategy: programmatically open them, read the live option elements, ask AI
  // to pick one, then click the matching element and wait for it to register.

  /**
   * Fills a custom ARIA dropdown by: opening it, reading its options,
   * sending them to the AI, and clicking the AI's chosen option.
   * @async
   * @param {HTMLElement} input        - The combobox trigger element.
   * @param {string}      questionText - The field's label, sent to the AI for context.
   * @returns {Promise<boolean>} true if successfully filled, false otherwise.
   */
  async function fillCustomDropdown(input, questionText) {

    // Step 1: Click to open the dropdown
    input.focus();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    input.click();
    await sleep(600);

    // Step 2: Read all visible option elements from the live DOM
    const optionEls = findVisibleOptions(input);
    if (optionEls.length === 0) {
      // Close the dropdown
      document.body.click();
      return false;
    }

    const optionTexts = optionEls.map(o => o.text);

    // Step 3: Ask AI to pick the best option
    let aiChoice;
    try {
      aiChoice = await sendMessage({
        type: 'MATCH_DROPDOWN',
        questionText: questionText,
        options: optionTexts
      });
    } catch (e) {
      document.body.click();
      return false;
    }


    if (!aiChoice || aiChoice === 'SKIP' || aiChoice === 'NEEDS_USER_INPUT') {
      document.body.click();
      return false;
    }

    // Step 4: Find the option element that matches AI's choice and click it
    const choiceLower = aiChoice.toLowerCase().trim();
    const choiceNorm = choiceLower.replace(/[^a-z0-9]/g, '');

    // Exact text match
    for (const opt of optionEls) {
      if (opt.text.toLowerCase().trim() === choiceLower) {
        clickElement(opt.el);
        await sleep(200);
        return true;
      }
    }

    // Normalized match
    for (const opt of optionEls) {
      if (opt.text.toLowerCase().replace(/[^a-z0-9]/g, '') === choiceNorm) {
        clickElement(opt.el);
        await sleep(200);
        return true;
      }
    }

    // Partial/contains match
    for (const opt of optionEls) {
      const optLower = opt.text.toLowerCase().trim();
      if (optLower.includes(choiceLower) || choiceLower.includes(optLower)) {
        clickElement(opt.el);
        await sleep(200);
        return true;
      }
    }

    document.body.click();
    return false;
  }

  /**
   * Finds all visible option elements for an open custom dropdown.
   * Checks the aria-controls listbox, nearby parent containers, and
   * any floating listbox/option elements currently in the DOM.
   * @param {HTMLElement} triggerEl - The combobox trigger that was clicked to open the dropdown.
   * @returns {Array<{text: string, el: HTMLElement}>} List of option text+element pairs.
   */
  function findVisibleOptions(triggerEl) {
    const results = [];
    const seen = new Set();

    // Strategy 1: ARIA — find listbox via aria-controls/aria-owns
    const lbId = triggerEl.getAttribute('aria-controls') || triggerEl.getAttribute('aria-owns');
    if (lbId) {
      const lb = document.getElementById(lbId);
      if (lb) collectOptions(lb.querySelectorAll('[role="option"]'), results, seen);
    }

    // Strategy 2: Search nearby container
    const container = triggerEl.closest(
      '[class*="select"], [class*="dropdown"], [class*="field"], [class*="combobox"], [data-testid]'
    ) || triggerEl.parentElement?.parentElement;
    if (container) {
      collectOptions(container.querySelectorAll('[role="option"], [class*="option"]:not([class*="options"])'), results, seen);
    }

    // Strategy 3: Search entire document for visible options (dropdown might be portaled)
    if (results.length === 0) {
      const allOptions = document.querySelectorAll(
        '[role="option"], [role="listbox"] > *, .dropdown-option, [class*="menu-item"], [class*="listbox-option"]'
      );
      collectOptions(allOptions, results, seen);
    }

    return results;
  }

  /**
   * Collects visible, non-placeholder option elements from a node list.
   * Skips hidden elements (zero bounding rect) and placeholder text like "Select…".
   * @param {NodeList|Array} nodeList - DOM elements to scan.
   * @param {Array}          results  - Accumulator array of {text, el} objects.
   * @param {Set}            seen     - Set of already-collected text values (dedup).
   */
  function collectOptions(nodeList, results, seen) {
    for (const el of nodeList) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const text = el.textContent.trim();
      if (!text || seen.has(text)) continue;
      if (/^(select|choose|--|pick|search)/i.test(text)) continue;
      seen.add(text);
      results.push({ el, text });
    }
  }

  /**
   * Dispatches mousedown, mouseup, and click events on an element.
   * Required for custom dropdowns that listen to low-level mouse events
   * rather than just the 'click' event.
   * @param {HTMLElement} el - The element to click.
   */
  function clickElement(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    el.click();
  }

  /** Returns a Promise that resolves after `ms` milliseconds. Used for async waits during form fill. */
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ── Select: match AI's option text → actual option value, then select it ──

  /**
   * Selects the best matching option in a native <select> element.
   * Tries six strategies in order: exact map lookup, exact value match,
   * exact text match, normalised match (strip punctuation), partial/contains match,
   * and finally a word-overlap fuzzy score.
   * @param {HTMLSelectElement} select      - The native select element to fill.
   * @param {string}            aiText      - The option text chosen by the AI.
   * @param {Object}            optionMap   - Map of lowercase option text → option value.
   * @param {string[]}          optionTexts - Array of option text strings (for fallback).
   */
  function fillSelectByText(select, aiText, optionMap, optionTexts) {
    const text = String(aiText).trim();
    const textLower = text.toLowerCase();

    // 1. Exact text match → get the real value from our map
    if (optionMap && optionMap[textLower] !== undefined) {
      select.value = optionMap[textLower];
      fireEvents(select);
      return;
    }

    // 2. Try matching against actual <option> elements directly
    const realOptions = Array.from(select.options).filter(o =>
      o.value.trim() && o.value.trim() !== '-1' && o.textContent.trim()
    );

    // Exact value match (AI returned the value attribute)
    for (const opt of realOptions) {
      if (opt.value === text || opt.value.toLowerCase() === textLower) {
        select.value = opt.value;
        fireEvents(select);
        return;
      }
    }

    // 3. Normalized match — strip all non-alphanumeric chars
    const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const textNorm = norm(text);
    for (const opt of realOptions) {
      if (norm(opt.textContent) === textNorm) {
        select.value = opt.value;
        fireEvents(select);
        return;
      }
    }

    // 4. Partial / contains match on text
    for (const opt of realOptions) {
      const optText = opt.textContent.trim().toLowerCase();
      if (optText.includes(textLower) || textLower.includes(optText)) {
        select.value = opt.value;
        fireEvents(select);
        return;
      }
    }

    // 4. Best fuzzy match — word overlap + prefix scoring
    let bestOpt = null;
    let bestScore = 0;
    const words = textLower.split(/[\s,\/\-_]+/).filter(Boolean);
    for (const opt of realOptions) {
      const optText = opt.textContent.trim().toLowerCase();
      const optWords = optText.split(/[\s,\/\-_]+/).filter(Boolean);
      let score = 0;
      for (const w of words) {
        for (const ow of optWords) {
          if (w === ow) { score += 10; continue; }
          let p = 0;
          while (p < w.length && p < ow.length && w[p] === ow[p]) p++;
          if (p >= 2) score += p;
        }
      }
      if (score > bestScore) { bestScore = score; bestOpt = opt; }
    }
    if (bestOpt && bestScore >= 3) {
      select.value = bestOpt.value;
      fireEvents(select);
      return;
    }

  }

  // ── Radio: use stored refs directly ──

  /**
   * Selects a radio button from a group based on the AI's text answer.
   * Tries exact label match, then normalised match, then partial match.
   * @param {Array<{text: string, el: HTMLInputElement}>} radioRefs - Radio option refs.
   * @param {string} selectedText - The option text chosen by the AI.
   */
  function fillRadioFromRef(radioRefs, selectedText) {
    const target = selectedText.toLowerCase().trim();

    // Exact label match
    for (const r of radioRefs) {
      if (r.text.toLowerCase().trim() === target || r.el.value.toLowerCase().trim() === target) {
        r.el.checked = true;
        fireEvents(r.el);
        return true;
      }
    }
    // Partial match
    for (const r of radioRefs) {
      const label = r.text.toLowerCase().trim();
      const val = r.el.value.toLowerCase().trim();
      if (label.includes(target) || target.includes(label) ||
          val.includes(target) || target.includes(val)) {
        r.el.checked = true;
        fireEvents(r.el);
        return true;
      }
    }
    return false;
  }

  // ── Checkbox: use stored ref directly ──

  /**
   * Checks or unchecks a checkbox based on the AI's answer value.
   * Treats 'yes', 'true', '1', 'agree', 'accept' as truthy.
   * @param {HTMLInputElement} cb    - The checkbox element.
   * @param {string}           value - The AI's answer string.
   */
  function fillCheckboxFromRef(cb, value) {
    const shouldCheck = /^(yes|true|1|checked|agree|accept)$/i.test(String(value).trim());
    if (cb.checked !== shouldCheck) {
      cb.checked = shouldCheck;
      fireEvents(cb);
    }
  }

  // ── Shared event dispatcher ──

  /**
   * Fires input, change, and blur events on an element.
   * Required to notify React/Vue/Angular frameworks that the value was
   * changed programmatically — without these events, the framework's
   * internal state won't update and the value may be ignored on submit.
   * @param {HTMLElement} el - The form element that was just filled.
   */
  function fireEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /**
   * Sets a text input or textarea value in a React-compatible way.
   * React overrides the native value setter — if you set input.value directly,
   * React won't detect the change and the field will appear unchanged on submit.
   * Using Object.getOwnPropertyDescriptor to access the native setter bypasses
   * React's override and triggers its synthetic event system correctly.
   * @param {HTMLInputElement|HTMLTextAreaElement} input - The input to fill.
   * @param {string} value - The value to set.
   */
  function fillInput(input, value) {
    // React-compatible value setter
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    const setter = input.tagName.toLowerCase() === 'textarea'
      ? nativeTextAreaValueSetter
      : nativeInputValueSetter;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    // Dispatch events for frameworks
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
  }


  // ─── Cover letter ─────────────────────────────────────────────

  /**
   * Generates a tailored cover letter for the current job via the AI and
   * displays it in the Cover Letter section of the panel.
   * Requires a completed analysis (currentAnalysis must be non-null).
   * @async
   */
  async function generateCoverLetter() {
    const btn = shadowRoot.getElementById('jmCoverLetterBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="jm-spinner"></span> Writing...';
    try {
      if (!currentAnalysis) throw new Error('Analyze the job first.');
      const jd = await extractJobDescription();
      const clResult = await sendMessage({
        type: 'GENERATE_COVER_LETTER',
        jobDescription: jd,
        analysis: {
          matchingSkills: currentAnalysis.matchingSkills,
          matchScore: currentAnalysis.matchScore,
          jdDigest: currentAnalysis.jdDigest || null
        },
        url: window.location.href
      });
      // Support both old string and new object response format
      const text = typeof clResult === 'string' ? clResult : clResult.text;
      const clTruncated = typeof clResult === 'object' && clResult.truncated;
      shadowRoot.getElementById('jmCoverLetterText').textContent = text;
      const section = shadowRoot.getElementById('jmCoverLetterSection');
      section.style.display = 'block';
      scrollPanelTo(section);
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '&#9993; Cover Letter';
    }
  }

  // ─── ATS Resume Generator ────────────────────────────────────

  /**
   * Generates a tailored, ATS-optimized resume using the user's profile and the current JD.
   * Sends GENERATE_RESUME message to background, displays result in the resume section.
   * @async
   */
  /**
   * Converts markdown to simple HTML for the mini preview inside the panel.
   * Lighter than the full PDF version — just enough for visual hierarchy.
   */
  function markdownToPreviewHTML(md) {
    return md
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^\*(.+)\*$/gm, '<p style="color:var(--ac-text-muted);"><em>$1</em></p>')
      .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^(?!<)(.+)$/gm, '<p>$1</p>')
      .replace(/<p><\/p>/g, '')
      // Wrap consecutive <li> items in <ul>
      .replace(/(<li>.*<\/li>\n?)+/g, (match) => '<ul>' + match + '</ul>');
  }

  async function generateATSResume() {
    const btn = shadowRoot.getElementById('jmDoGenerateResume');
    const buildSection = shadowRoot.getElementById('jmResumeBuild');
    const resultSection = shadowRoot.getElementById('jmResumeResult');

    btn.disabled = true;
    btn.innerHTML = '<span class="jm-spinner"></span> Generating resume...';

    try {
      if (!currentAnalysis) throw new Error('Analyze the job first.');
      const jd = await extractJobDescription();
      const instructions = shadowRoot.getElementById('jmResumeInstructions').value.trim();

      const result = await sendMessage({
        type: 'GENERATE_RESUME',
        jobDescription: jd,
        jobTitle: currentAnalysis.title || extractJobTitle() || '',
        company: currentAnalysis.company || extractCompany() || '',
        customInstructions: instructions || undefined,
        url: window.location.href,
      });

      const text = typeof result === 'string' ? result : result.text;

      // Store raw markdown
      shadowRoot.getElementById('jmResumeText').textContent = text;

      // Render mini preview as formatted HTML
      const miniContent = shadowRoot.getElementById('jmResumeMiniContent');
      miniContent.innerHTML = markdownToPreviewHTML(text);

      // Show context in result header
      const meta = shadowRoot.getElementById('jmResumeResultMeta');
      const company = currentAnalysis.company || extractCompany() || '';
      const role = currentAnalysis.title || extractJobTitle() || '';
      meta.textContent = [company, role].filter(Boolean).join(' \u00B7 ');

      // Switch from build → result view
      buildSection.style.display = 'none';
      resultSection.style.display = 'block';
      scrollPanelTo(resultSection);

    } catch (err) {
      setStatus('Resume generation failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '&#10024; Generate Resume';
    }
  }

  /**
   * Opens a new tab with the generated resume as a beautifully formatted HTML page.
   * The page includes its own "Download PDF" and "Print" action bar at the top,
   * which hides when printing. No more auto-triggering the print dialog.
   * @param {string} resumeMarkdown - The raw markdown resume text.
   */
  function openResumePreviewTab(resumeMarkdown) {
    if (!resumeMarkdown || resumeMarkdown.startsWith('Error:')) return;

    const html = markdownToResumeHTML(resumeMarkdown);

    const previewWindow = window.open('', '_blank');
    previewWindow.document.write(html);
    previewWindow.document.close();

    // Attach event listeners after DOM is written (inline onclick can be blocked by CSP)
    previewWindow.addEventListener('DOMContentLoaded', () => {
      attachPreviewListeners(previewWindow);
    });
    // Fallback if DOMContentLoaded already fired
    setTimeout(() => attachPreviewListeners(previewWindow), 200);
  }

  /** Attaches click handlers to the preview tab's action buttons. */
  function attachPreviewListeners(win) {
    try {
      const doc = win.document;
      const printBtn = doc.getElementById('resumePrintBtn');
      const copyBtn = doc.getElementById('resumeCopyBtn');
      if (printBtn && !printBtn._bound) {
        printBtn._bound = true;
        printBtn.addEventListener('click', () => win.print());
      }
      if (copyBtn && !copyBtn._bound) {
        copyBtn._bound = true;
        copyBtn.addEventListener('click', () => {
          const content = doc.querySelector('.resume-content');
          if (content) {
            win.navigator.clipboard.writeText(content.innerText).then(() => {
              copyBtn.textContent = 'Copied!';
              setTimeout(() => { copyBtn.textContent = 'Copy Text'; }, 1500);
            });
          }
        });
      }
    } catch (_) {}
  }

  /**
   * Converts resume markdown to clean, printable HTML with ATS-friendly styling.
   * @param {string} md - Resume text in markdown format.
   * @returns {string} Complete HTML document string.
   */
  function markdownToResumeHTML(md) {
    let html = md
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^\*(.+)\*$/gm, '<div class="dates">$1</div>')
      .replace(/^[•\-\*] (.+)$/gm, '<div class="bullet">&bull; $1</div>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/^(?!<)(.+)$/gm, '<p>$1</p>');

    html = html.replace(/<p><\/p>/g, '');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Resume — Applicant Copilot</title>
  <style>
    @page { margin: 0.6in 0.7in; size: letter; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1a1a1a;
      max-width: 750px;
      margin: 0 auto;
      padding: 20px 40px;
    }
    h1 { font-size: 22px; margin: 0 0 4px 0; color: #111; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1.2px; border-bottom: 1.5px solid #333; padding-bottom: 3px; margin: 20px 0 8px 0; color: #111; }
    h3 { font-size: 13px; margin: 10px 0 2px 0; color: #111; }
    p { margin: 2px 0; font-size: 12px; color: #333; }
    .dates { font-size: 11px; color: #555; margin-bottom: 4px; font-style: italic; }
    .bullet { padding-left: 16px; text-indent: -12px; margin: 2px 0; font-size: 12px; }
    strong { font-weight: 700; }

    /* Action bar — hidden when printing */
    .action-bar {
      position: sticky;
      top: 0;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      margin: -20px -40px 20px -40px;
      z-index: 10;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .action-bar .label {
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      margin-right: auto;
    }
    .action-bar button {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #e2e8f0; color: #334155; }
    .btn-secondary:hover { background: #cbd5e1; }

    @media print {
      .action-bar { display: none !important; }
      body { padding: 0; margin: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <span class="label">Resume Preview</span>
    <button class="btn-secondary" id="resumeCopyBtn">Copy Text</button>
    <button class="btn-primary" id="resumePrintBtn">Download PDF</button>
  </div>
  <div class="resume-content">${html}</div>
</body>
</html>`;
  }

  // ─── Job notes ────────────────────────────────────────────────
  // Per-URL free-text notes stored in chrome.storage.local under 'ac_jobNotes'.
  // Notes are loaded when the panel opens and auto-saved on input/blur.

  const NOTES_STORAGE_KEY = 'ac_jobNotes'; // Key for the notes map in chrome.storage.local

  /**
   * Loads saved notes for the current page URL and populates the notes textarea.
   * @async
   */
  async function loadJobNotes() {
    try {
      const url = window.location.href;
      const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
      const notes = result[NOTES_STORAGE_KEY] || {};
      const textarea = shadowRoot && shadowRoot.getElementById('jmNotesInput');
      if (textarea) textarea.value = notes[url] || '';
    } catch (e) { /* ignore */ }
  }

  /**
   * Saves the current notes textarea value for the current page URL.
   * Called on textarea blur and input events (auto-save).
   * Caps the notes map at 200 entries by evicting the oldest.
   * @async
   */
  async function saveJobNotes() {
    try {
      const url = window.location.href;
      const textarea = shadowRoot && shadowRoot.getElementById('jmNotesInput');
      if (!textarea) return;
      const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
      const notes = result[NOTES_STORAGE_KEY] || {};
      const val = textarea.value.trim();
      if (val) {
        notes[url] = val;
      } else {
        delete notes[url];
      }
      // Prune to 200 entries
      const keys = Object.keys(notes);
      if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(k => delete notes[k]);
      await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes });
    } catch (e) { /* ignore */ }
  }

  // ─── Message handling ─────────────────────────────────────────

  /**
   * Sends a message to the background service worker and returns a Promise.
   * Wraps chrome.runtime.sendMessage to:
   *  - Check chrome.runtime.id before sending (detects invalidated extension context)
   *  - Translate the { success, data/error } envelope into resolve/reject
   *  - Provide a user-friendly error when the extension has been updated mid-session
   * @param {Object} msg - The message object to send (must have a `type` field).
   * @returns {Promise<*>} Resolves with resp.data on success, rejects with Error on failure.
   */
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      try {
        if (!chrome.runtime?.id) {
          return reject(new Error('Extension was updated. Please refresh this page (F5) and try again.'));
        }
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message || '';
            if (errMsg.includes('invalidated') || errMsg.includes('Extension context')) {
              return reject(new Error('Extension was updated. Please refresh this page (F5) and try again.'));
            }
            return reject(new Error(errMsg));
          }
          if (!resp) return reject(new Error('No response'));
          if (!resp.success) return reject(new Error(resp.error));
          resolve(resp.data);
        });
      } catch (e) {
        reject(new Error('Extension was updated. Please refresh this page (F5) and try again.'));
      }
    });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'TOGGLE_PANEL':
        togglePanel();
        sendResponse({ success: true });
        break;
      case 'TRIGGER_ANALYZE':
        if (!panelOpen) togglePanel();
        setTimeout(analyzeJob, 300);
        sendResponse({ success: true });
        break;
      case 'TRIGGER_AUTOFILL':
        if (!panelOpen) togglePanel();
        setTimeout(autofillForm, 300);
        sendResponse({ success: true });
        break;
    }
    return true;
  });

  // ─── Utility ──────────────────────────────────────────────────

  /**
   * Escapes a string for safe insertion into HTML via innerHTML.
   * Uses the browser's own text node serialisation so all special characters
   * (&, <, >, ", ') are correctly escaped without a manual replacement table.
   * @param {string} str - The raw string to escape.
   * @returns {string} HTML-safe string.
   */
  const _escDiv = document.createElement('div');
  function escapeHTML(str) {
    _escDiv.textContent = str;
    return _escDiv.innerHTML;
  }

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── Initialize ───────────────────────────────────────────────
  // On job sites: create panel + toggle immediately.
  // On other sites: only initialize when the user clicks the toolbar icon.

  if (_isJobSite) {
    ensureInitialized();
  }

  // Listen for toolbar icon click on non-job pages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_PANEL') {
      ensureInitialized();
      togglePanel();
      sendResponse({ success: true });
    }
    return false;
  });

  // ─── SPA URL change detection (LinkedIn, Indeed, etc.) ────────
  // Uses lightweight polling instead of MutationObserver on body.
  // MutationObserver with subtree:true fires on every DOM change (hundreds/sec
  // on SPAs like LinkedIn), causing unnecessary battery drain.

  let _lastUrl = window.location.href;

  function handleUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl === _lastUrl) return;
    _lastUrl = currentUrl;
    currentAnalysis = null;
    _pendingAnswers = null;
    clearAllChips();
    clearAutofillBadges();
    // Reset Ask AI chat for the new job
    clearChat();
    if (shadowRoot && panelOpen) {
      const analyzeBtn = shadowRoot.getElementById('jmAnalyze');
      if (analyzeBtn && analyzeBtn.textContent === 'Re-Analyze') analyzeBtn.textContent = 'Analyze Job';
      const autofillBtn = shadowRoot.getElementById('jmAutofill');
      if (autofillBtn) { autofillBtn.innerHTML = 'AutoFill Application'; autofillBtn.onclick = null; }
      [
        'jmScoreSection', 'jmMatchingSection', 'jmMissingSection', 'jmRecsSection',
        'jmInsightsSection', 'jmKeywordsSection', 'jmTruncNotice', 'jmResumeTruncNotice',
        'jmAutofillPreview', 'jmCoverLetterSection', 'jmResumeSection',
        'jmJobInfo', 'jmSaveJob', 'jmMarkApplied', 'jmCoverLetterBtn',
        'jmGenerateResumeBtn'
      ].forEach(id => {
        const el = shadowRoot.getElementById(id);
        if (el) el.style.display = 'none';
      });
      loadJobNotes();
      loadSlotState();
      setStatus('New job detected — click Analyze Job.', 'info');
      setTimeout(clearStatus, 3000);
    }
    // Trigger auto-scan for keyword match widget
    triggerAutoScan();
  }

  // Detect SPA navigations via popstate + polling (800ms interval)
  window.addEventListener('popstate', handleUrlChange);
  if (_isJobSite) setInterval(handleUrlChange, 800);

  // ─── Auto-Scan: Keyword Match Widget ─────────────────────────────
  // Automatically extracts JD text and compares against cached profile
  // keywords to show a floating match score. Zero AI calls.

  /**
   * Returns true if the current page looks like a specific job listing
   * (not just the jobs search/feed page).
   */
  function isOnJobPage() {
    const url = window.location.href;
    // LinkedIn: /jobs/view/12345 or /jobs/collections/... with detail pane
    if (/linkedin\.com/i.test(window.location.hostname)) {
      return /\/jobs\/view\/\d+/i.test(url) ||
        (url.includes('/jobs/') && !!document.querySelector('.jobs-description__content, .jobs-search__job-details, .job-details-module'));
    }
    // Workday
    if (/myworkday|workday\.com/i.test(window.location.hostname)) {
      return !!document.querySelector('[data-automation-id="jobPostingDescription"]');
    }
    // Generic: check if any JD selectors match
    return !!document.querySelector(
      '.job-description, #jobDescriptionText, .posting-page .content, .job-post-content'
    );
  }

  /**
   * Returns true if the profile has enough data to produce a meaningful match.
   */
  function hasMinimalProfile(profile) {
    if (!profile) return false;
    const hasSkills = Array.isArray(profile.skills) ? profile.skills.length > 0 : !!profile.skills;
    const hasSummary = !!profile.summary;
    const hasExperience = Array.isArray(profile.experience) && profile.experience.length > 0;
    return hasSkills || hasSummary || hasExperience;
  }

  /**
   * Loads the user's full profile context and extracts keywords.
   * Cached in _cachedProfileKeywords; only re-runs on profile/context changes.
   */
  async function refreshProfileKeywords() {
    try {
      const data = await chrome.storage.local.get(['profile', 'applicantContext', 'qaList']);
      const profile = data.profile;
      if (!hasMinimalProfile(profile)) {
        _cachedProfileKeywords = null;
        return;
      }
      _cachedProfileKeywords = window.ACKeywordMatcher.extractProfileKeywords(profile, {
        applicantContext: data.applicantContext || null,
        qaList: data.qaList || [],
      });
    } catch (e) {
      console.warn('[AC][autoScan] Failed to refresh profile keywords:', e);
      _cachedProfileKeywords = null;
    }
  }

  /**
   * Extracts JD text without clicking "Show more" (avoids flicker).
   * Falls back to text-density algorithm if selectors miss.
   */
  function extractJDForAutoScan() {
    const PLATFORM_SELECTORS = [
      '.jobs-description__content, .description__text, .jobs-box__html-content',
      '[data-automation-id="jobPostingDescription"], .job-description',
      '#content .job-post-content, #content #gh_jid, .job__description',
      '.posting-page .content, .section-wrapper.page-full-width',
      '#jobDescriptionText, .jobsearch-jobDescriptionText',
    ];
    for (const selectorGroup of PLATFORM_SELECTORS) {
      for (const sel of selectorGroup.split(', ')) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 100) {
          return el.innerText.trim();
        }
      }
    }
    return null;
  }

  /**
   * Debounced auto-scan trigger. Called on URL change and profile update.
   */
  function triggerAutoScan() {
    if (!_isJobSite) return;

    if (_autoScanTimer) clearTimeout(_autoScanTimer);

    _autoScanTimer = setTimeout(async () => {
      try {
        if (!isOnJobPage()) { hideScoreWidget(); return; }

        const currentUrl = window.location.href;
        if (_lastAutoScanUrl === currentUrl && _scoreWidgetHost?.style.display !== 'none') return;

        // Check if feature is enabled
        const settings = await chrome.storage.local.get('acAutoScanEnabled');
        if (settings.acAutoScanEnabled === false) { hideScoreWidget(); return; }

        // Ensure profile keywords are loaded
        if (!_cachedProfileKeywords) await refreshProfileKeywords();
        if (!_cachedProfileKeywords) { hideScoreWidget(); return; }

        // Extract JD (no "Show more" click — use visible text)
        let jd = extractJDForAutoScan();
        if (!jd || jd.length < 50) {
          // Retry once after 1s — LinkedIn may still be loading
          await new Promise(r => setTimeout(r, 1000));
          jd = extractJDForAutoScan();
        }
        if (!jd || jd.length < 50) { hideScoreWidget(); return; }

        // Compute match
        const jdKeywords = window.ACKeywordMatcher.extractKeywords(jd);
        const result = window.ACKeywordMatcher.computeMatchScore(_cachedProfileKeywords, jdKeywords);

        _lastAutoScanUrl = currentUrl;
        showScoreWidget(result);
      } catch (e) {
        console.warn('[AC][autoScan] Error:', e);
        hideScoreWidget();
      }
    }, 1200);
  }

  // ─── Auto-Scan: Floating Score Widget ─────────────────────────────

  function getScoreColor(score) {
    if (score >= 70) return '#16a34a'; // green
    if (score >= 40) return '#d97706'; // amber
    return '#dc2626'; // red
  }

  function getScoreTrackColor(score) {
    if (score >= 70) return '#dcfce7';
    if (score >= 40) return '#fef3c7';
    return '#fee2e2';
  }

  function createScoreWidget() {
    const host = document.createElement('div');
    host.id = 'applicant-copilot-score-host';
    host.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:2147483644;pointer-events:auto;';

    const shadow = host.attachShadow({ mode: 'closed' });
    _scoreWidgetShadow = shadow;

    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; }

      .ac-widget {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 13px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
      }

      .ac-badge {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 12px rgba(0,0,0,0.18);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
        border: 2px solid #e5e7eb;
      }
      .ac-badge:hover {
        transform: scale(1.08);
        box-shadow: 0 4px 16px rgba(0,0,0,0.22);
      }

      .ac-badge svg {
        position: absolute;
        top: 0; left: 0;
        width: 48px; height: 48px;
        transform: rotate(-90deg);
      }
      .ac-badge svg circle {
        fill: none;
        stroke-width: 3;
      }
      .ac-badge-track { stroke: #e5e7eb; }
      .ac-badge-progress {
        stroke-linecap: round;
        transition: stroke-dasharray 0.5s ease, stroke 0.5s ease;
      }

      .ac-badge-score {
        font-size: 15px;
        font-weight: 700;
        z-index: 1;
        color: #374151;
        line-height: 1;
      }
      .ac-badge-label {
        font-size: 7px;
        font-weight: 500;
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        position: absolute;
        bottom: 5px;
        z-index: 1;
      }

      .ac-card {
        display: none;
        width: 260px;
        background: #fff;
        border-radius: 12px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.15);
        padding: 14px;
        margin-bottom: 8px;
        animation: ac-slide-up 0.2s ease;
        border: 1px solid #e5e7eb;
      }
      .ac-card.open { display: block; }

      @keyframes ac-slide-up {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .ac-card-header {
        font-size: 12px;
        font-weight: 600;
        color: #6b7280;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .ac-card-header span { font-size: 14px; }

      .ac-kw-section { margin-bottom: 10px; }
      .ac-kw-label {
        font-size: 11px;
        font-weight: 600;
        color: #374151;
        margin-bottom: 4px;
      }
      .ac-kw-tags { display: flex; flex-wrap: wrap; gap: 4px; }

      .ac-kw-tag {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 10px;
        font-size: 11px;
        font-weight: 500;
        white-space: nowrap;
      }
      .ac-kw-tag.match { background: #dcfce7; color: #166534; }
      .ac-kw-tag.missing { background: #fee2e2; color: #991b1b; }

      .ac-full-btn {
        width: 100%;
        padding: 8px;
        border: 1px solid #3b82f6;
        background: #eff6ff;
        color: #2563eb;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s ease;
        text-align: center;
      }
      .ac-full-btn:hover { background: #dbeafe; }
    `;
    shadow.appendChild(style);

    const widget = document.createElement('div');
    widget.className = 'ac-widget';
    widget.innerHTML = `
      <div class="ac-card" id="acCard">
        <div class="ac-card-header"><span>&#9889;</span> Quick Match</div>
        <div class="ac-kw-section">
          <div class="ac-kw-label">Matching</div>
          <div class="ac-kw-tags" id="acMatchTags"></div>
        </div>
        <div class="ac-kw-section">
          <div class="ac-kw-label">Missing from profile</div>
          <div class="ac-kw-tags" id="acMissTags"></div>
        </div>
        <button class="ac-full-btn" id="acFullBtn">Full AI Analysis &rarr;</button>
      </div>
      <div class="ac-badge" id="acBadge" role="status" aria-label="Keyword match score" tabindex="0">
        <svg viewBox="0 0 48 48">
          <circle class="ac-badge-track" cx="24" cy="24" r="20" />
          <circle class="ac-badge-progress" id="acRing" cx="24" cy="24" r="20" />
        </svg>
        <span class="ac-badge-score" id="acScore">0</span>
        <span class="ac-badge-label">match</span>
      </div>
    `;
    shadow.appendChild(widget);

    // Wire interactions
    const badge = shadow.getElementById('acBadge');
    const card = shadow.getElementById('acCard');
    const fullBtn = shadow.getElementById('acFullBtn');

    badge.addEventListener('click', () => {
      _scoreWidgetExpanded = !_scoreWidgetExpanded;
      card.classList.toggle('open', _scoreWidgetExpanded);
    });
    badge.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        badge.click();
      }
    });

    fullBtn.addEventListener('click', () => {
      _scoreWidgetExpanded = false;
      card.classList.remove('open');
      ensureInitialized();
      if (!panelOpen) togglePanel();
      // Trigger full AI analysis if not already done
      if (!currentAnalysis) {
        setTimeout(() => {
          const btn = shadowRoot?.getElementById('jmAnalyze');
          if (btn && btn.textContent !== 'Re-Analyze') btn.click();
        }, 300);
      }
    });

    // Close card on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && _scoreWidgetExpanded) {
        _scoreWidgetExpanded = false;
        card.classList.remove('open');
      }
    });

    document.body.appendChild(host);
    _scoreWidgetHost = host;
  }

  function showScoreWidget(result) {
    if (!_scoreWidgetHost) createScoreWidget();

    const shadow = _scoreWidgetShadow;
    const score = result.score;
    const color = getScoreColor(score);
    const trackColor = getScoreTrackColor(score);

    // Update score number
    shadow.getElementById('acScore').textContent = score;

    // Update ring arc
    const circumference = 2 * Math.PI * 20; // r=20
    const dashLen = (score / 100) * circumference;
    const ring = shadow.getElementById('acRing');
    ring.style.stroke = color;
    ring.style.strokeDasharray = `${dashLen} ${circumference}`;

    // Update track color
    shadow.querySelector('.ac-badge-track').style.stroke = trackColor;

    // Update border
    shadow.querySelector('.ac-badge').style.borderColor = color;

    // Update matched keywords
    const matchTags = shadow.getElementById('acMatchTags');
    matchTags.innerHTML = result.matchedKeywords.slice(0, 5)
      .map(kw => `<span class="ac-kw-tag match">${kw}</span>`).join('');
    if (result.matchedKeywords.length === 0) {
      matchTags.innerHTML = '<span style="color:#9ca3af;font-size:11px">None found</span>';
    }

    // Update missing keywords
    const missTags = shadow.getElementById('acMissTags');
    missTags.innerHTML = result.missingKeywords.slice(0, 5)
      .map(kw => `<span class="ac-kw-tag missing">${kw}</span>`).join('');
    if (result.missingKeywords.length === 0) {
      missTags.innerHTML = '<span style="color:#9ca3af;font-size:11px">Great coverage!</span>';
    }

    // Update aria label
    shadow.getElementById('acBadge').setAttribute('aria-label', `Keyword match score: ${score}%`);

    // Collapse card on new job
    _scoreWidgetExpanded = false;
    shadow.getElementById('acCard').classList.remove('open');

    _scoreWidgetHost.style.display = 'block';
  }

  function hideScoreWidget() {
    if (_scoreWidgetHost) {
      _scoreWidgetHost.style.display = 'none';
      _scoreWidgetExpanded = false;
      if (_scoreWidgetShadow) {
        const card = _scoreWidgetShadow.getElementById('acCard');
        if (card) card.classList.remove('open');
      }
    }
  }

  // ─── Auto-Scan: Initialization ────────────────────────────────────

  // Load profile keywords on startup (if on a job site)
  if (_isJobSite) {
    refreshProfileKeywords().then(() => {
      triggerAutoScan();
    });

    // Re-extract profile keywords when profile/context changes
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.profile || changes.activeProfileSlot || changes.applicantContext || changes.qaList || changes.acAutoScanEnabled) {
        refreshProfileKeywords().then(() => {
          _lastAutoScanUrl = null; // force re-scan with new profile
          triggerAutoScan();
        });
      }
    });

    // Periodic refresh every 30 min
    _profileKeywordsTimer = setInterval(refreshProfileKeywords, 30 * 60 * 1000);
  }

})();
