// platform/spa-monitor.js — SPA URL change detection (LinkedIn, Indeed, etc.)
// Uses lightweight polling instead of MutationObserver on body.
// MutationObserver with subtree:true fires on every DOM change (hundreds/sec
// on SPAs like LinkedIn), causing unnecessary battery drain.

import { setCurrentAnalysis, setPendingAnswers, getShadowRoot, getPanelOpen } from '../state.js';
import { clearAllChips } from '../autofill/inline-chips.js';
import { clearAutofillBadges } from '../autofill/badges.js';
import { triggerAutoScan } from '../auto-scan/auto-scan.js';
import { setStatus, clearStatus } from '../panel/status.js';
import { isJobSite } from '../platform/detector.js';

// Module-local state
let _lastUrl = window.location.href;

// These are injected via initSpaMonitor to avoid circular dependencies
let _clearChat = null;
let _loadJobNotes = null;
let _loadSlotState = null;

function handleUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl === _lastUrl) return;
  _lastUrl = currentUrl;
  setCurrentAnalysis(null);
  setPendingAnswers(null);
  clearAllChips();
  clearAutofillBadges();
  // Reset Ask AI chat for the new job
  if (_clearChat) _clearChat();
  const shadowRoot = getShadowRoot();
  const panelOpen = getPanelOpen();
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
    if (_loadJobNotes) _loadJobNotes();
    if (_loadSlotState) _loadSlotState();
    setStatus('New job detected \u2014 click Analyze Job.', 'info');
    setTimeout(clearStatus, 3000);
  }
  // Trigger auto-scan for keyword match widget
  triggerAutoScan();
}

/**
 * Initializes SPA URL change detection via popstate + polling.
 * @param {Object} callbacks - Functions injected to avoid circular deps.
 * @param {Function} callbacks.clearChat - Clears Ask AI chat state.
 * @param {Function} callbacks.loadJobNotes - Loads per-URL job notes.
 * @param {Function} callbacks.loadSlotState - Loads resume slot state.
 * @param {boolean} isOnJobSite - Whether current page is a job site.
 */
export function initSpaMonitor({ clearChat, loadJobNotes, loadSlotState, isOnJobSite }) {
  _clearChat = clearChat;
  _loadJobNotes = loadJobNotes;
  _loadSlotState = loadSlotState;

  // Detect SPA navigations via popstate + polling (800ms interval)
  window.addEventListener('popstate', handleUrlChange);
  if (isOnJobSite) setInterval(handleUrlChange, 800);
}
