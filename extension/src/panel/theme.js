import { getShadowRoot, getToggleBtnRef } from '../state.js';

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
export function applyTheme(theme) {
  const shadowRoot = getShadowRoot();
  const toggleBtnRef = getToggleBtnRef();
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
export async function cycleTheme() {
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
export async function loadTheme() {
  try {
    const result = await chrome.storage.local.get('ac_theme');
    const theme = result.ac_theme || 'blue';
    if (THEME_ORDER.includes(theme)) {
      applyTheme(theme);
    }
  } catch (e) { /* ignore */ }
}
