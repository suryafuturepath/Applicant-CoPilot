// content-main.js — Entry point for Applicant Copilot content script
// Bundled by esbuild into extension/content.js (IIFE format)

import { isJobSite } from './platform/detector.js';
import { createPanel, togglePanel } from './panel/panel-core.js';
import { createToggleButton } from './panel/toggle-button.js';
import { analyzeJob } from './features/analysis.js';
import { autofillForm } from './autofill/autofill-pipeline.js';
import { initSpaMonitor } from './platform/spa-monitor.js';
import { initAutoScan } from './auto-scan/auto-scan.js';
import { clearAllChips } from './autofill/inline-chips.js';
import { clearAutofillBadges } from './autofill/badges.js';
import { clearChat } from './features/chat.js';
import { loadJobNotes } from './storage/job-notes.js';
import { loadSlotState } from './panel/slot-switcher.js';
import { setStatus, clearStatus } from './panel/status.js';
import { getPanelOpen } from './state.js';
import { registerInterviewPrepHandlers } from './features/interview-prep.js';

// ─── Double-injection guard ─────────────────────────────────────
if (window.__applicantCopilotLoaded) {
  // Already loaded — skip. (Can't use `return` at module top level,
  // so we wrap the rest in a conditional block.)
} else {
  window.__applicantCopilotLoaded = true;

  // ─── Lazy initialization ────────────────────────────────────────
  let _lazyInitDone = false;

  function ensureInitialized() {
    if (_lazyInitDone) return;
    _lazyInitDone = true;
    createPanel();
    createToggleButton();
  }

  // ─── Auto-init on job sites ───────────────────────────────────
  if (isJobSite()) {
    ensureInitialized();
  }

  // ─── Message listeners ────────────────────────────────────────
  // Handles messages from background.js (toolbar icon click, keyboard shortcuts)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'TOGGLE_PANEL':
        ensureInitialized();
        togglePanel();
        sendResponse({ success: true });
        break;
      case 'TRIGGER_ANALYZE':
        ensureInitialized();
        if (!getPanelOpen()) togglePanel();
        setTimeout(analyzeJob, 300);
        sendResponse({ success: true });
        break;
      case 'TRIGGER_AUTOFILL':
        ensureInitialized();
        if (!getPanelOpen()) togglePanel();
        setTimeout(autofillForm, 300);
        sendResponse({ success: true });
        break;
    }
    return true;
  });

  // ─── Register interview prep handlers for late-binding in panel-events ──
  registerInterviewPrepHandlers();

  // ─── SPA navigation detection ─────────────────────────────────
  initSpaMonitor({
    clearChat,
    loadJobNotes,
    loadSlotState,
    isOnJobSite: isJobSite(),
  });

  // ─── Auto-scan keyword match (renders in panel, no floating widget) ──
  console.log('[AC][init] isJobSite:', isJobSite());
  if (isJobSite()) {
    console.log('[AC][init] Starting auto-scan init');
    initAutoScan(true);
  }
}
