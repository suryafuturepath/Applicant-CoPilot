// platform/detector.js — Job site URL detection + provider identification

export const JOB_SITE_PATTERNS = [
  /linkedin\.com/i, /indeed\.com/i, /glassdoor\.com/i,
  /greenhouse\.io/i, /lever\.co/i, /myworkdayjobs\.com/i,
  /myworkday\.com/i, /icims\.com/i, /workday\.com/i,
  /smartrecruiters\.com/i, /ashbyhq\.com/i, /jobs\./i, /careers\./i, /apply\./i,
];

const _isJobSite = JOB_SITE_PATTERNS.some(p => p.test(window.location.hostname));

/**
 * Returns true if the current page is a supported job site.
 * @returns {boolean}
 */
export function isJobSite() {
  return _isJobSite;
}

/**
 * Detects which job platform the current page belongs to.
 * @returns {'linkedin'|'workday'|'greenhouse'|'lever'|'indeed'|'generic'}
 */
export function detectProvider() {
  const host = window.location.hostname.toLowerCase();
  if (/linkedin\.com/.test(host)) return 'linkedin';
  if (/myworkdayjobs\.com|myworkday\.com|workday\.com/.test(host)) return 'workday';
  if (/greenhouse\.io|boards\.greenhouse\.io/.test(host)) return 'greenhouse';
  if (/lever\.co|jobs\.lever\.co/.test(host)) return 'lever';
  if (/indeed\.com/.test(host)) return 'indeed';
  return 'generic';
}
