// providers/linkedin.js — LinkedIn-specific JD extraction with scroll-to-load

const SELECTORS = {
  jd: [
    '.jobs-description__content',
    '.description__text',
    '.jobs-box__html-content',
  ],
  expand: [
    '.jobs-description__content .show-more-less-html__button--more',
    'button[aria-label="Click to see more description"]',
    '.show-more-less-html__button--more',
  ],
  title: [
    '.jobs-unified-top-card__job-title',
    'h1[class*="title"]',
    'h1',
  ],
  company: [
    '.jobs-unified-top-card__company-name',
    '[class*="company"]',
  ],
  location: [
    '.jobs-unified-top-card__bullet',
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
  ],
  salary: [
    '.salary-main-rail__data-body',
    '.jobs-unified-top-card__job-insight--highlight span',
  ],
  detailPane: [
    '.jobs-search__job-details--container',
    '.jobs-search-two-pane__details',
    '.jobs-details__main-content',
    '.scaffold-layout__detail',
  ],
  jobPage: [
    '.jobs-description__content',
    '.jobs-search__job-details',
    '.job-details-module',
    '.jobs-description',
    '.jobs-box__html-content',
  ],
};

// Noise phrases to strip when using the broader container fallback
const NOISE_PATTERNS = [
  /^Share$/m,
  /^Show more options$/m,
  /^Save$/m,
  /^Apply$/m,
  /^Easy Apply$/m,
  /^People you can reach out to$/m,
  /^People you may know$/m,
  /^Similar jobs$/m,
  /^Show all$/m,
  /^Reposted \d+.*ago$/m,
  /^Promoted by hirer.*$/m,
  /^Responses managed off LinkedIn$/m,
  /^\d+ people clicked apply$/m,
  /^Matches your job preferences.*$/m,
  /^PREMIUM$/m,
  /^Your AI-powered job assessment$/m,
  /^Show match details$/m,
  /^Tailor my resume$/m,
  /^Create cover letter$/m,
];

/**
 * Clicks LinkedIn's "Show more" button to expand truncated JD content.
 */
export async function expandContent() {
  for (const sel of SELECTORS.expand) {
    try {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await new Promise(r => setTimeout(r, 500));
        console.log('[AC][linkedin] Clicked "Show more":', sel);
        return;
      }
    } catch (_) {}
  }
}

/**
 * Scrolls the LinkedIn job detail pane to the bottom and back to force
 * lazy-loaded content (education, qualifications) to render in the DOM.
 * Uses incremental scrolling to trigger LinkedIn's IntersectionObserver-based lazy loading.
 */
async function scrollDetailPane() {
  try {
    // Find the scrollable detail pane
    let pane = null;
    for (const sel of SELECTORS.detailPane) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight + 50) { pane = el; break; }
    }

    // If no scrollable pane found, try the main element or skip
    if (!pane) {
      const main = document.querySelector('main');
      if (main && main.scrollHeight > main.clientHeight + 50) pane = main;
    }
    if (!pane) {
      console.log('[AC][linkedin] No scrollable pane found, skipping scroll');
      return;
    }

    const originalScroll = pane.scrollTop;
    const scrollHeight = pane.scrollHeight;
    const step = 400;
    const maxTime = 3000; // cap at 3 seconds total
    const startTime = Date.now();

    // Scroll down in steps to trigger lazy loaders
    for (let pos = 0; pos < scrollHeight; pos += step) {
      if (Date.now() - startTime > maxTime) break; // timeout safety
      pane.scrollTo({ top: pos, behavior: 'instant' });
      await new Promise(r => setTimeout(r, 25));
    }

    // Pause at bottom for content to render
    pane.scrollTo({ top: scrollHeight, behavior: 'instant' });
    await new Promise(r => setTimeout(r, 500));

    // Scroll back to original position
    pane.scrollTo({ top: originalScroll, behavior: 'instant' });
    console.log('[AC][linkedin] Scrolled detail pane (height:', scrollHeight, ')');
  } catch (e) {
    console.warn('[AC][linkedin] Scroll failed (non-blocking):', e.message);
  }
}

/**
 * Strips LinkedIn UI noise from extracted text.
 */
function cleanText(text) {
  let cleaned = text;
  for (const pattern of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  // Collapse multiple blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/**
 * Extracts the full job description from LinkedIn.
 * Strategy: expand → scroll to load lazy content → extract from JD container → fallback to broader pane.
 */
export async function extractJD() {
  // Step 1: Click "Show more" to expand truncated content
  await expandContent();

  // Step 2: Scroll detail pane to force lazy-loaded sections to render
  await scrollDetailPane();

  // Step 3: Try primary JD selectors
  for (const sel of SELECTORS.jd) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText.trim();
      if (text.length > 100) {
        console.log('[AC][linkedin] JD from selector:', sel, '→', text.length, 'chars');
        return text;
      }
    }
  }

  // Step 4: Fallback — grab the broader detail pane and clean noise
  for (const sel of SELECTORS.detailPane) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.innerText.trim();
      if (text.length > 200) {
        const cleaned = cleanText(text);
        console.log('[AC][linkedin] JD from broad container:', sel, '→', cleaned.length, 'chars (raw:', text.length, ')');
        return cleaned;
      }
    }
  }

  return '';
}

export function extractTitle() {
  for (const sel of SELECTORS.title) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 2 && el.innerText.trim().length < 200) {
      return el.innerText.trim();
    }
  }
  return document.title.split('|')[0].split('-')[0].trim();
}

export function extractCompany() {
  for (const sel of SELECTORS.company) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 1 && el.innerText.trim().length < 100) {
      return el.innerText.trim();
    }
  }
  return '';
}

export function extractLocation() {
  for (const sel of SELECTORS.location) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText.trim();
        if (text.length > 1 && text.length < 150) return text;
      }
    } catch (_) {}
  }
  return '';
}

export function extractSalary() {
  for (const sel of SELECTORS.salary) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText.trim();
        if (text.length > 1 && text.length < 200 && /\d/.test(text)) return text;
      }
    } catch (_) {}
  }
  return '';
}

/**
 * Returns true if the current LinkedIn page has a job detail pane visible.
 */
export function isOnJobPage() {
  const url = window.location.href;
  if (!url.includes('/jobs/')) return false;
  return /\/jobs\/view\/\d+/i.test(url) ||
    /currentJobId=\d+/i.test(url) ||
    SELECTORS.jobPage.some(sel => !!document.querySelector(sel));
}
