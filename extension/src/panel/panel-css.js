// panel/panel-css.js — Full CSS string for the side panel Shadow DOM
// Extracted from content-main.js getPanelCSS()

/**
 * Returns the full CSS string for the side panel Shadow DOM.
 * All selectors are scoped inside the shadow root so they cannot
 * affect or be affected by the host page's stylesheet.
 * @returns {string} CSS text to inject into a <style> element.
 */
export function getPanelCSS() {
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
