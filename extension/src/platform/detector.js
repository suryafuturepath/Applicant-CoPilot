// platform/detector.js — Job site URL detection

export const JOB_SITE_PATTERNS = [
  /linkedin\.com/i, /indeed\.com/i, /glassdoor\.com/i,
  /greenhouse\.io/i, /lever\.co/i, /myworkdayjobs\.com/i,
  /myworkday\.com/i, /icims\.com/i, /workday\.com/i,
  /smartrecruiters\.com/i, /ashbyhq\.com/i, /jobs\./i, /careers\./i, /apply\./i,
];

// Computed once on load — does not change during the page lifetime
const _isJobSite = JOB_SITE_PATTERNS.some(p => p.test(window.location.hostname));

/**
 * Returns true if the current page is a supported job site.
 * @returns {boolean}
 */
export function isJobSite() {
  return _isJobSite;
}
