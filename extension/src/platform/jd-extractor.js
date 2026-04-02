// platform/jd-extractor.js — Job description & metadata extraction from page DOM
// Pure DOM readers with zero state dependencies.

/**
 * Clicks "Show more" / expand buttons on platforms that truncate the JD.
 * Must be called before extraction so the full text is in the DOM.
 */
export async function expandTruncatedContent() {
  const expandSelectors = [
    // LinkedIn "Show more" on JD
    '.jobs-description__content .show-more-less-html__button--more',
    'button[aria-label="Click to see more description"]',
    '.show-more-less-html__button--more',
    // Workday expand
    'button[data-automation-id="Show More"]',
    // Indeed
    '#jobDescriptionText .viewMoreButton',
    '.jobsearch-ViewJobButtons-showMoreButton',
  ];
  for (const sel of expandSelectors) {
    try {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (_) {}
  }
}

/**
 * Extracts the job description from the current page using a two-stage approach:
 *   Stage 1 — Platform-specific selectors for P0/P1 ATS platforms (fast, precise)
 *   Stage 2 — Readability-inspired text-density algorithm (works on any site)
 * @returns {Promise<string>} The extracted job description text.
 */
export async function extractJobDescription() {
  await expandTruncatedContent();

  const PLATFORM_SELECTORS = [
    // LinkedIn (P0)
    '.jobs-description__content, .description__text, .jobs-box__html-content',
    // Workday (P0)
    '[data-automation-id="jobPostingDescription"], .job-description',
    // Greenhouse (P1)
    '#content .job-post-content, #content #gh_jid, .job__description',
    // Lever (P1)
    '.posting-page .content, .section-wrapper.page-full-width',
    // Indeed (P2)
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

  return extractByTextDensity();
}

/**
 * Readability-inspired algorithm that finds the main content block on any page
 * by scoring DOM nodes on text density, paragraph/list-item count, and link ratio.
 * @returns {string} The extracted content text, or first 10000 chars of body as last resort.
 */
function extractByTextDensity() {
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

  if (bestNode) return bestNode.innerText.trim();
  return document.body.innerText.substring(0, 10000);
}

/** @returns {string} The job title extracted from the page, or ''. */
export function extractJobTitle() {
  const selectors = [
    'h1.job-title', 'h1.posting-headline', '.job-title h1',
    'h1[class*="title"]', '.jobs-unified-top-card__job-title',
    'h1', '.posting-headline h2',
    'h2.job-title', '[data-automation-id="jobTitle"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 2 && el.innerText.trim().length < 200) {
      return el.innerText.trim();
    }
  }
  return document.title.split('|')[0].split('-')[0].trim();
}

/** @returns {string} The company name extracted from the page, or ''. */
export function extractCompany() {
  const selectors = [
    '.company-name', '[class*="company"]', '.posting-categories .location',
    '.jobs-unified-top-card__company-name',
    '[data-automation-id="company"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.innerText.trim().length > 1 && el.innerText.trim().length < 100) {
      return el.innerText.trim();
    }
  }
  return '';
}

/** @returns {string} The job location extracted from the page, or ''. */
export function extractLocation() {
  const selectors = [
    '.jobs-unified-top-card__bullet',
    '.job-details-jobs-unified-top-card__primary-description-container .tvm__text',
    '[data-testid="job-location"], .jobsearch-JobInfoHeader-subtitle > div:last-child',
    '[data-test="emp-location"]',
    '.location', '.job-post-location',
    '.posting-categories .sort-by-team.posting-category:nth-child(2)',
    '.posting-categories .location',
    '[data-automation-id="locations"]',
    '[class*="location"]', '[class*="job-location"]',
    '[data-field="location"]', '[itemprop="jobLocation"]'
  ];
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText.trim();
        if (text.length > 1 && text.length < 150) return text;
      }
    } catch (e) { /* skip invalid selectors */ }
  }
  return '';
}

/** @returns {string} The salary/compensation text extracted from the page, or ''. */
export function extractSalary() {
  const selectors = [
    '.salary-main-rail__data-body',
    '.jobs-unified-top-card__job-insight--highlight span',
    '#salaryInfoAndJobType', '.jobsearch-JobMetadataHeader-item',
    '[data-testid="attribute_snippet_testid"]',
    '[data-test="detailSalary"]',
    '[data-automation-id="salary"]',
    '[class*="salary"]', '[class*="compensation"]', '[class*="pay-range"]',
    '[data-field="salary"]'
  ];
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        const text = el.innerText.trim();
        if (text.length > 1 && text.length < 200 && /\d/.test(text)) return text;
      }
    } catch (e) { /* skip */ }
  }
  // Regex fallback: search JD text for salary patterns
  const jdText = (document.querySelector('.jobs-description__content') ||
                  document.querySelector('#jobDescriptionText') ||
                  document.querySelector('[class*="job-description"]') ||
                  document.body).innerText || '';
  const patterns = [
    /\$[\d,]+(?:\.\d{2})?\s*[-–to]+\s*\$[\d,]+(?:\.\d{2})?(?:\s*\/?\s*(?:year|yr|annually|hour|hr|month|mo))?/i,
    /\$[\d,]+(?:\.\d{2})?\s*(?:\/?\s*(?:year|yr|annually|hour|hr|month|mo))/i,
    /\d{2,3}k\s*[-–to]+\s*\d{2,3}k(?:\s*(?:\/?\s*(?:year|yr|annually))?)/i,
    /(?:salary|compensation|pay)[:\s]*\$[\d,]+(?:\s*[-–to]+\s*\$[\d,]+)?/i
  ];
  for (const pat of patterns) {
    const match = jdText.match(pat);
    if (match) return match[0].trim();
  }
  return '';
}
