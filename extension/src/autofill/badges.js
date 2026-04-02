// autofill/badges.js — Fixed-position "Refined by Applicant Copilot" badges
// Anchored to filled form fields without affecting page layout.

// Module-local state
let _badges = [];
let _badgeScrollHandler = null;
let _badgeResizeObs = null;

const CHIP_STYLE_ID = 'jmai-chip-styles';

/**
 * Injects chip/badge CSS into document.head once. Uses a unique `jmai-` prefix
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
 * Shows a small fixed-position "Refined by Applicant Copilot" pill anchored to
 * the bottom-right corner of the filled field. Uses position:fixed so it never
 * pushes other elements down or disrupts the page layout.
 * @param {Element} el - The filled form element (input, select, radio, etc.).
 */
export function showAutofillBadge(el) {
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
export function clearAutofillBadges() {
  _badges.forEach(({ badgeEl }) => badgeEl.remove());
  _badges = [];
  if (_badgeScrollHandler) {
    window.removeEventListener('scroll', _badgeScrollHandler, { capture: true });
    _badgeScrollHandler = null;
  }
  if (_badgeResizeObs) { _badgeResizeObs.disconnect(); _badgeResizeObs = null; }
}

// Re-export injectChipStyles for use by inline-chips module
export { injectChipStyles };
