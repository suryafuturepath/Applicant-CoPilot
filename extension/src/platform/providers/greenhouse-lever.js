// providers/greenhouse-lever.js — Greenhouse + Lever JD extraction

import { detectProvider } from '../detector.js';

const GREENHOUSE_SELECTORS = {
  jd: ['#content .job-post-content', '#content #gh_jid', '.job__description'],
  title: ['h1.app-title', 'h1'],
  location: ['.location', '.job-post-location'],
};

const LEVER_SELECTORS = {
  jd: ['.posting-page .content', '.section-wrapper.page-full-width'],
  title: ['.posting-headline h2', 'h1'],
  company: ['.posting-categories .location'],
  location: [
    '.posting-categories .sort-by-team.posting-category:nth-child(2)',
    '.posting-categories .location',
  ],
};

function isLever() {
  return detectProvider() === 'lever';
}

export async function expandContent() {
  // Greenhouse and Lever typically don't truncate JDs
}

export async function extractJD() {
  const selectors = isLever() ? LEVER_SELECTORS.jd : GREENHOUSE_SELECTORS.jd;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 100) {
      console.log(`[AC][${isLever() ? 'lever' : 'greenhouse'}] JD from:`, sel, '→', el.innerText.trim().length, 'chars');
      return el.innerText.trim();
    }
  }
  return '';
}

export function extractTitle() {
  const selectors = isLever() ? LEVER_SELECTORS.title : GREENHOUSE_SELECTORS.title;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 2 && el.innerText.trim().length < 200) return el.innerText.trim();
  }
  return document.title.split('|')[0].split('-')[0].trim();
}

export function extractCompany() {
  if (isLever()) {
    for (const sel of LEVER_SELECTORS.company || []) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 1 && el.innerText.trim().length < 100) return el.innerText.trim();
    }
  }
  return '';
}

export function extractLocation() {
  const selectors = isLever() ? LEVER_SELECTORS.location : GREENHOUSE_SELECTORS.location;
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) { const t = el.innerText.trim(); if (t.length > 1 && t.length < 150) return t; }
    } catch (_) {}
  }
  return '';
}

export function extractSalary() { return ''; }

export function isOnJobPage() {
  return !!document.querySelector(
    '#content .job-post-content, .posting-page .content, .job__description'
  );
}
