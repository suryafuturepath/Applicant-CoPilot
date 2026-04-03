import { getToggleBtnRef } from '../state.js';

// ─── Theme management ────────────────────────────────────────────
// Single sage theme — "The Organic Archive" design system.

const SAGE_FAB = { bg: '#4f614d', shadow: 'rgba(79, 97, 77, 0.4)' };

/**
 * Applies the sage theme to the FAB toggle button.
 * Panel CSS variables are set directly in panel-css.js (no class toggling needed).
 */
export function applyTheme() {
  const toggleBtnRef = getToggleBtnRef();
  if (toggleBtnRef) {
    toggleBtnRef.style.background = SAGE_FAB.bg;
    toggleBtnRef.style.boxShadow = `0 4px 12px ${SAGE_FAB.shadow}`;
  }
}

/**
 * Kept for API compatibility — no-op since we have a single theme.
 */
export async function cycleTheme() {
  applyTheme();
}

/**
 * Loads theme on startup. Single theme — just applies sage.
 */
export async function loadTheme() {
  applyTheme();
}
