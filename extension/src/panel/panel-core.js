// panel/panel-core.js — Shadow DOM panel creation and toggle logic
// Extracted from content-main.js createPanel() and togglePanel()

import {
  getPanelOpen, setPanelOpen,
  getShadowRoot, setShadowRoot,
  getPanelRoot, setPanelRoot,
  getToggleBtnRef
} from '../state.js';
import { getPanelCSS } from './panel-css.js';
import { getPanelHTML } from './panel-html.js';
import { wireEvents } from './panel-events.js';
import { loadTheme } from './theme.js';
import { loadSlotState } from './slot-switcher.js';
import { checkIfApplied, checkIfSaved } from '../features/save-applied.js';
import { loadJobNotes } from '../storage/job-notes.js';
import { showConsentBannerIfNeeded } from './consent.js';
import { deactivateSavedTab } from '../features/saved-jobs.js';

// ─── Module-local state ──────────────────────────────────────────
// Reference to the backdrop element inside the panel's shadow DOM
let _backdropEl = null;
// Reference to the escape key handler so we can add/remove it
let _escHandler = null;
let _outsideClickHandler = null;

// ─── Shadow DOM panel creation ──────────────────────────────────
// The panel lives entirely inside a closed Shadow DOM so that:
//   - The host page's CSS cannot override the panel's styles.
//   - The panel's CSS cannot leak out and break the host page.
//   - The panel's DOM is inaccessible to page scripts (mode: 'closed').

/**
 * Creates the side panel Shadow DOM, injects styles and HTML, and wires events.
 * Called once on first use (lazy init — not on script inject).
 */
export function createPanel() {
    const host = document.createElement('div');
    host.id = 'applicant-copilot-panel-host';
    document.body.appendChild(host);

    const shadowRoot = host.attachShadow({ mode: 'closed' });
    setShadowRoot(shadowRoot);
    setPanelRoot(host);

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
 * Opens or closes the side panel.
 * On first open, createPanel() is called to build the Shadow DOM.
 * When opening, also triggers checkIfApplied() and loadJobNotes()
 * so the panel always reflects the latest state for the current URL.
 */
export function togglePanel() {
    const panelOpen = !getPanelOpen();
    setPanelOpen(panelOpen);
    const panelRoot = getPanelRoot();
    const toggleBtnRef = getToggleBtnRef();

    if (!panelRoot) createPanel();

    const shadowRoot = getShadowRoot();
    const currentPanelRoot = getPanelRoot();
    const panel = shadowRoot.getElementById('jm-panel');

    // Update accessibility attributes on the toggle button
    if (toggleBtnRef) {
      toggleBtnRef.setAttribute('aria-label', panelOpen ? 'Close Applicant Copilot panel' : 'Open Applicant Copilot panel');
      toggleBtnRef.setAttribute('aria-pressed', String(panelOpen));
    }

    if (panelOpen) {
      currentPanelRoot.classList.add('open');
      panel.classList.add('open');

      // Close panel when clicking outside (replaces full-page backdrop that blocked scrolling)
      _outsideClickHandler = (e) => {
        // Only react to real user clicks — ignore programmatic .click() calls
        // (e.g. expandTruncatedContent clicking LinkedIn's "Show more" button)
        if (!e.isTrusted) return;
        if (getPanelOpen() && !currentPanelRoot.contains(e.target) && (!toggleBtnRef || !toggleBtnRef.getRootNode().host?.contains(e.target))) {
          togglePanel();
        }
      };
      // Delay to avoid catching the current click that opened the panel
      setTimeout(() => document.addEventListener('click', _outsideClickHandler), 0);

      // Add Escape key handler
      _escHandler = (e) => {
        if (e.key === 'Escape' && getPanelOpen()) togglePanel();
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
      currentPanelRoot.classList.remove('open');

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
