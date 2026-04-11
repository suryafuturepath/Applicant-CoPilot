// providers/apply-detector.js — Auto-detect application submission across platforms
// Uses MutationObserver + DOM text matching to detect confirmation states.

import { detectProvider } from '../detector.js';
import { markApplied } from '../../features/save-applied.js';
import { setStatus, clearStatus } from '../../panel/status.js';

let _detectObserver = null;
let _lastDetectedUrl = null;
let _debounceTimer = null;

// ─── Provider-specific confirmation patterns ─────────────────

const DETECTION_RULES = {
  linkedin: {
    // LinkedIn Easy Apply shows a modal with confirmation text
    selectors: [
      '.artdeco-modal .jpac-modal-header', // "Your application was sent"
      '[data-test-modal-id="applied-modal"]',
      '.jobs-apply-form--success',
    ],
    textPatterns: [
      /application\s+(was\s+)?sent/i,
      /successfully\s+applied/i,
      /your\s+application\s+has\s+been\s+submitted/i,
    ],
    // Scope the observer to avoid watching the entire page
    observeTarget: () =>
      document.querySelector('.jobs-search__job-details--container') ||
      document.querySelector('.scaffold-layout__detail') ||
      document.querySelector('main') ||
      document.body,
  },
  workday: {
    selectors: [
      '[data-automation-id="thankYouMessage"]',
      '[data-automation-id="applicationSubmittedMessage"]',
    ],
    textPatterns: [
      /thank\s+you\s+for\s+(your\s+)?application/i,
      /application\s+(has\s+been\s+)?submitted/i,
    ],
    observeTarget: () => document.querySelector('main') || document.body,
  },
  greenhouse: {
    selectors: [
      '#application_confirmation',
      '.confirmation-page',
    ],
    textPatterns: [
      /thank\s+you\s+for\s+applying/i,
      /application\s+(has\s+been\s+)?received/i,
    ],
    observeTarget: () => document.querySelector('main') || document.body,
  },
  lever: {
    selectors: [
      '.application-confirmation',
    ],
    textPatterns: [
      /thank\s+you\s+for\s+applying/i,
      /application\s+submitted/i,
    ],
    observeTarget: () => document.querySelector('main') || document.body,
  },
  indeed: {
    selectors: [
      '[data-testid="ia-PostApplyPage"]',
      '.ia-PostApply',
    ],
    textPatterns: [
      /your\s+application\s+has\s+been\s+submitted/i,
      /application\s+sent/i,
    ],
    observeTarget: () => document.querySelector('main') || document.body,
  },
};

// ─── Generic patterns (fallback for unknown ATS) ─────────────

const GENERIC_TEXT_PATTERNS = [
  /thank\s+you\s+for\s+(your\s+)?application/i,
  /application\s+(has\s+been\s+)?submitted/i,
  /successfully\s+applied/i,
  /your\s+application\s+was\s+sent/i,
  /application\s+received/i,
];

// ─── Detection Logic ─────────────────────────────────────────

/**
 * Checks the current DOM for application confirmation signals.
 * Returns true if a submission is detected.
 */
function checkForSubmission(rules) {
  // Check provider-specific selectors
  if (rules?.selectors) {
    for (const sel of rules.selectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        console.log('[AC][applyDetect] Selector match:', sel);
        return true;
      }
    }
  }

  // Check provider-specific text patterns
  const patterns = rules?.textPatterns || GENERIC_TEXT_PATTERNS;
  // Only search visible text in modals and main content (not full body — too noisy)
  const searchTargets = [
    ...document.querySelectorAll('.artdeco-modal, [role="dialog"], [role="alertdialog"], .modal'),
    document.querySelector('main'),
  ].filter(Boolean);

  for (const target of searchTargets) {
    const text = target.innerText || '';
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        console.log('[AC][applyDetect] Text pattern match:', pattern.source, 'in', target.tagName);
        return true;
      }
    }
  }

  return false;
}

/**
 * Called when a submission is detected. Marks the job as applied
 * with source 'auto-detected'.
 */
function onSubmissionDetected() {
  const currentUrl = window.location.href;

  // Debounce — don't fire multiple times for the same URL within 30s
  if (_lastDetectedUrl === currentUrl) return;
  _lastDetectedUrl = currentUrl;

  // Clear after 30s so re-detection works if user navigates away and back
  setTimeout(() => { _lastDetectedUrl = null; }, 30000);

  console.log('[AC][applyDetect] Application submission detected!');
  setStatus('Application detected — marked as applied!', 'success');
  setTimeout(clearStatus, 4000);

  // Mark as applied with auto-detected source
  markApplied({ source: 'auto-detected' });
}

// ─── Observer Setup ──────────────────────────────────────────

/**
 * Initializes the application submission auto-detector.
 * Sets up a MutationObserver scoped to the job detail pane.
 */
export function initApplyDetector() {
  const provider = detectProvider();
  const rules = DETECTION_RULES[provider] || null;
  const observeTarget = rules?.observeTarget?.() || document.querySelector('main') || document.body;

  // Don't observe document.body directly — too noisy on SPAs
  if (observeTarget === document.body) {
    console.log('[AC][applyDetect] Skipping — no scoped container found');
    return;
  }

  // Clean up previous observer if any
  if (_detectObserver) {
    _detectObserver.disconnect();
    _detectObserver = null;
  }

  _detectObserver = new MutationObserver(() => {
    // Debounce rapid DOM mutations
    if (_debounceTimer) clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(() => {
      if (checkForSubmission(rules)) {
        onSubmissionDetected();
      }
    }, 500);
  });

  _detectObserver.observe(observeTarget, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log('[AC][applyDetect] Watching for submissions on', provider, '→', observeTarget.tagName);
}
