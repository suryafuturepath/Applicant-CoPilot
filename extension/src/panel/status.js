import { getShadowRoot } from '../state.js';

// ─── Status helpers ───────────────────────────────────────────

/**
 * Displays a status message inside the panel (info / success / error styles).
 * @param {string} text - Message to display.
 * @param {'info'|'success'|'error'} type - CSS modifier class for color.
 */
export function setStatus(text, type) {
  const shadowRoot = getShadowRoot();
  const el = shadowRoot.getElementById('jmStatus');
  el.textContent = text;
  el.className = 'jm-status ' + type;
}

/** Hides the status bar (used after a timed delay post-success). */
export function clearStatus() {
  const shadowRoot = getShadowRoot();
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
export function scrollPanelTo(el) {
  const shadowRoot = getShadowRoot();
  const body = shadowRoot.querySelector('.jm-body');
  if (!body) return;
  body.scrollTo({ top: el.offsetTop - 10, behavior: 'smooth' });
}
