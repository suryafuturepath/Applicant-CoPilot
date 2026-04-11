// providers/generic.js — Fallback JD extraction using text-density algorithm
// Works on any ATS, career page, or job board without site-specific selectors.

const GENERIC_SELECTORS = [
  '.job-description', '[class*="job-description"]',
  '[class*="description"]', 'article',
];

export async function expandContent() {
  // No generic expand strategy
}

/**
 * Readability-inspired algorithm that finds the main content block by scoring
 * DOM nodes on text density, paragraph/list-item count, and link ratio.
 */
export async function extractJD() {
  // Try generic selectors first
  for (const sel of GENERIC_SELECTORS) {
    try {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 200) {
        console.log('[AC][generic] JD from selector:', sel, '→', el.innerText.trim().length, 'chars');
        return el.innerText.trim();
      }
    } catch (_) {}
  }

  // Fall back to text-density algorithm
  const candidates = document.querySelectorAll('article, section, main, [role="main"], div, td');
  let bestNode = null;
  let bestScore = 0;

  for (const node of candidates) {
    const text = node.innerText || '';
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const wordCount = words.length;
    if (wordCount < 80) continue;

    const paragraphCount = node.querySelectorAll('p, li').length;
    const links = node.querySelectorAll('a');
    let linkTextLen = 0;
    for (const a of links) linkTextLen += (a.innerText || '').length;
    const linkDensity = text.length > 0 ? linkTextLen / text.length : 0;
    if (linkDensity > 0.5) continue;

    const score = (wordCount * 1) + (paragraphCount * 10) - (linkDensity * 500);
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  if (bestNode) {
    console.log('[AC][generic] JD from text-density →', bestNode.innerText.trim().length, 'chars');
    return bestNode.innerText.trim();
  }

  console.log('[AC][generic] Fallback to body text');
  return document.body.innerText.substring(0, 10000);
}

export function extractTitle() {
  const selectors = [
    'h1.job-title', 'h1.posting-headline', '.job-title h1',
    'h1[class*="title"]', 'h1', 'h2.job-title',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 2 && el.innerText.trim().length < 200) return el.innerText.trim();
  }
  return document.title.split('|')[0].split('-')[0].trim();
}

export function extractCompany() {
  const selectors = ['.company-name', '[class*="company"]'];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 1 && el.innerText.trim().length < 100) return el.innerText.trim();
  }
  return '';
}

export function extractLocation() {
  const selectors = [
    '[class*="location"]', '[class*="job-location"]',
    '[data-field="location"]', '[itemprop="jobLocation"]',
  ];
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) { const t = el.innerText.trim(); if (t.length > 1 && t.length < 150) return t; }
    } catch (_) {}
  }
  return '';
}

export function extractSalary() {
  const selectors = [
    '[class*="salary"]', '[class*="compensation"]', '[class*="pay-range"]',
    '[data-field="salary"]',
  ];
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) { const t = el.innerText.trim(); if (t.length > 1 && t.length < 200 && /\d/.test(t)) return t; }
    } catch (_) {}
  }

  // Regex fallback on page text
  const jdText = document.body.innerText.substring(0, 20000);
  const patterns = [
    /\$[\d,]+(?:\.\d{2})?\s*[-–to]+\s*\$[\d,]+(?:\.\d{2})?(?:\s*\/?\s*(?:year|yr|annually|hour|hr|month|mo))?/i,
    /\$[\d,]+(?:\.\d{2})?\s*(?:\/?\s*(?:year|yr|annually|hour|hr|month|mo))/i,
    /\d{2,3}k\s*[-–to]+\s*\d{2,3}k/i,
  ];
  for (const pat of patterns) {
    const match = jdText.match(pat);
    if (match) return match[0].trim();
  }
  return '';
}

export function isOnJobPage() {
  return GENERIC_SELECTORS.some(sel => {
    try { return !!document.querySelector(sel); } catch (_) { return false; }
  });
}
