// auto-scan/auto-scan.js — Auto-Scan: Keyword Match Widget
// Automatically extracts JD text and compares against cached profile
// keywords to show a floating match score. Zero AI calls.

import { extractKeywords, extractProfileKeywords, computeMatchScore } from './keyword-matcher.js';
import { renderQuickMatch } from '../features/analysis.js';
import {
  extractJobTitle, extractCompany, extractLocation, extractSalary
} from '../platform/jd-extractor.js';

// Module-local state
let _autoScanTimer = null;
let _lastAutoScanUrl = null;
let _cachedProfileKeywords = null;
let _profileKeywordsTimer = null;
let _isJobSiteFlag = false;

/**
 * Returns true if the current page looks like a specific job listing
 * (not just the jobs search/feed page).
 */
function isOnJobPage() {
  const url = window.location.href;
  // LinkedIn: check for job detail pane in DOM (covers /jobs/view/, /jobs/search/, /jobs/collections/)
  if (/linkedin\.com/i.test(window.location.hostname)) {
    if (!url.includes('/jobs/')) return false;
    // Check URL patterns OR presence of JD content in DOM
    return /\/jobs\/view\/\d+/i.test(url) ||
      /currentJobId=\d+/i.test(url) ||
      !!document.querySelector('.jobs-description__content, .jobs-search__job-details, .job-details-module, .jobs-description, .jobs-box__html-content');
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
    _cachedProfileKeywords = extractProfileKeywords(profile, {
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
export function triggerAutoScan() {
  if (!_isJobSiteFlag) return;

  if (_autoScanTimer) clearTimeout(_autoScanTimer);

  _autoScanTimer = setTimeout(async () => {
    try {
      const onJobPage = isOnJobPage();
      console.log('[AC][autoScan] isOnJobPage:', onJobPage, 'url:', window.location.href);
      if (!onJobPage) return;

      const currentUrl = window.location.href;
      if (_lastAutoScanUrl === currentUrl) return;

      // Check if feature is enabled
      const settings = await chrome.storage.local.get('acAutoScanEnabled');
      if (settings.acAutoScanEnabled === false) { console.log('[AC][autoScan] Disabled in settings'); return; }

      // Ensure profile keywords are loaded
      if (!_cachedProfileKeywords) await refreshProfileKeywords();
      if (!_cachedProfileKeywords) { console.log('[AC][autoScan] No profile keywords — profile empty or missing'); return; }
      console.log('[AC][autoScan] Profile keywords cached:', _cachedProfileKeywords.size);

      // Extract JD (no "Show more" click — use visible text)
      let jd = extractJDForAutoScan();
      if (!jd || jd.length < 50) {
        console.log('[AC][autoScan] JD not ready, retrying in 1.5s...');
        await new Promise(r => setTimeout(r, 1500));
        jd = extractJDForAutoScan();
      }
      if (!jd || jd.length < 50) { console.log('[AC][autoScan] No JD found (len:', jd?.length || 0, ')'); return; }

      // Compute match
      const jdKeywords = extractKeywords(jd);
      const result = computeMatchScore(_cachedProfileKeywords, jdKeywords);
      console.log('[AC][autoScan] Score:', result.score, '| matched:', result.matchedKeywords.length, '| missing:', result.missingKeywords.length);

      // Extract metadata for panel display
      const title = extractJobTitle();
      const company = extractCompany();
      const location = extractLocation();
      const salary = extractSalary();

      _lastAutoScanUrl = currentUrl;

      // Render in the existing panel UI (not a separate floating widget)
      renderQuickMatch(result, title, company, location, salary);
    } catch (e) {
      console.warn('[AC][autoScan] Error:', e);
    }
  }, 1200);
}

/**
 * Resets the last auto-scan URL so the next triggerAutoScan() will re-run
 * even if the URL hasn't changed. Used when profile keywords are refreshed.
 */
export function resetLastAutoScanUrl() {
  _lastAutoScanUrl = null;
}

/**
 * Initializes the auto-scan system: loads profile keywords, sets up
 * storage change listeners, and starts periodic refresh.
 * @param {boolean} isOnJobSite - Whether the current page is a job site.
 */
export function initAutoScan(isOnJobSite) {
  console.log('[AC][autoScan] initAutoScan called, isOnJobSite:', isOnJobSite);
  _isJobSiteFlag = isOnJobSite;
  if (!isOnJobSite) return;

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

  // LinkedIn-specific: watch for job detail pane loading asynchronously.
  // On /jobs/search/ pages, the detail pane loads AFTER the URL change,
  // so our initial triggerAutoScan may miss it. A scoped MutationObserver
  // on the detail container catches it when it appears.
  if (/linkedin\.com/i.test(window.location.hostname)) {
    const detailContainer = document.querySelector('.jobs-search-two-pane__details, .jobs-search__right-rail, #job-details');
    const observeTarget = detailContainer || document.querySelector('main') || document.body;
    let _linkedInObsDebounce = null;
    const linkedInObserver = new MutationObserver(() => {
      if (_linkedInObsDebounce) clearTimeout(_linkedInObsDebounce);
      _linkedInObsDebounce = setTimeout(() => {
        // Only re-scan if the URL changed or we haven't scanned yet
        if (_lastAutoScanUrl !== window.location.href) {
          triggerAutoScan();
        }
      }, 600);
    });
    linkedInObserver.observe(observeTarget, { childList: true, subtree: true });
  }
}

