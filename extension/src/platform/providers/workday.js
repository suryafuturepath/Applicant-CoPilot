// providers/workday.js — Workday-specific JD extraction

const SELECTORS = {
  jd: [
    '[data-automation-id="jobPostingDescription"]',
    '.job-description',
  ],
  expand: [
    'button[data-automation-id="Show More"]',
  ],
  title: [
    '[data-automation-id="jobTitle"]',
    'h2[data-automation-id="jobPostingHeader"]',
  ],
  company: [
    '[data-automation-id="company"]',
  ],
  location: [
    '[data-automation-id="locations"]',
  ],
  salary: [
    '[data-automation-id="salary"]',
  ],
};

export async function expandContent() {
  for (const sel of SELECTORS.expand) {
    try {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        console.log('[AC][workday] Clicked expand:', sel);
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
      console.log('[AC][workday] JD from:', sel, '→', el.innerText.trim().length, 'chars');
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

export function extractCompany() {
  for (const sel of SELECTORS.company) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 1 && el.innerText.trim().length < 100) return el.innerText.trim();
  }
  return '';
}

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
  return !!document.querySelector('[data-automation-id="jobPostingDescription"]');
}
