// providers/indeed.js — Indeed-specific JD extraction

const SELECTORS = {
  jd: ['#jobDescriptionText', '.jobsearch-jobDescriptionText'],
  expand: ['#jobDescriptionText .viewMoreButton', '.jobsearch-ViewJobButtons-showMoreButton'],
  title: ['h1.jobsearch-JobInfoHeader-title', 'h1[class*="title"]', 'h1'],
  location: [
    '[data-testid="job-location"]',
    '.jobsearch-JobInfoHeader-subtitle > div:last-child',
  ],
  salary: [
    '#salaryInfoAndJobType',
    '.jobsearch-JobMetadataHeader-item',
    '[data-testid="attribute_snippet_testid"]',
  ],
};

export async function expandContent() {
  for (const sel of SELECTORS.expand) {
    try {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        console.log('[AC][indeed] Clicked expand:', sel);
        return;
      }
    } catch (_) {}
  }
}

export async function extractJD() {
  await expandContent();
  for (const sel of SELECTORS.jd) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 100) {
      console.log('[AC][indeed] JD from:', sel, '→', el.innerText.trim().length, 'chars');
      return el.innerText.trim();
    }
  }
  return '';
}

export function extractTitle() {
  for (const sel of SELECTORS.title) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 2 && el.innerText.trim().length < 200) return el.innerText.trim();
  }
  return document.title.split('|')[0].split('-')[0].trim();
}

export function extractCompany() { return ''; }

export function extractLocation() {
  for (const sel of SELECTORS.location) {
    try {
      const el = document.querySelector(sel);
      if (el) { const t = el.innerText.trim(); if (t.length > 1 && t.length < 150) return t; }
    } catch (_) {}
  }
  return '';
}

export function extractSalary() {
  for (const sel of SELECTORS.salary) {
    try {
      const el = document.querySelector(sel);
      if (el) { const t = el.innerText.trim(); if (t.length > 1 && t.length < 200 && /\d/.test(t)) return t; }
    } catch (_) {}
  }
  return '';
}

export function isOnJobPage() {
  return !!document.querySelector('#jobDescriptionText, .jobsearch-jobDescriptionText');
}
