// platform/jd-extractor.js — Orchestrator: delegates to provider-specific extractors
// Maintains the same export API so no other files need to change.

import { detectProvider } from './detector.js';
import * as linkedin from './providers/linkedin.js';
import * as workday from './providers/workday.js';
import * as greenhouseLever from './providers/greenhouse-lever.js';
import * as indeed from './providers/indeed.js';
import * as generic from './providers/generic.js';

const PROVIDERS = { linkedin, workday, greenhouse: greenhouseLever, lever: greenhouseLever, indeed, generic };

/**
 * Returns the provider module for the current page.
 */
function getProvider() {
  const name = detectProvider();
  return { provider: PROVIDERS[name] || generic, name };
}

/**
 * Clicks platform-specific "Show more" / expand buttons.
 */
export async function expandTruncatedContent() {
  const { provider } = getProvider();
  await provider.expandContent();
}

/**
 * Extracts the full job description from the current page.
 * Delegates to the detected provider's extractor (with scroll-to-load for LinkedIn).
 * @returns {Promise<string>}
 */
export async function extractJobDescription() {
  const { provider, name } = getProvider();
  console.log('[AC][extractor] provider:', name);
  const jd = await provider.extractJD();
  if (jd && jd.length > 100) return jd;
  // If provider-specific extraction failed, try generic fallback
  if (name !== 'generic') {
    console.log(`[AC][extractor] ${name} returned ${jd?.length || 0} chars, trying generic`);
    return generic.extractJD();
  }
  return jd || '';
}

/** @returns {string} */
export function extractJobTitle() {
  const { provider } = getProvider();
  return provider.extractTitle() || generic.extractTitle();
}

/** @returns {string} */
export function extractCompany() {
  const { provider } = getProvider();
  return provider.extractCompany() || generic.extractCompany();
}

/** @returns {string} */
export function extractLocation() {
  const { provider } = getProvider();
  return provider.extractLocation() || generic.extractLocation();
}

/** @returns {string} */
export function extractSalary() {
  const { provider } = getProvider();
  return provider.extractSalary() || generic.extractSalary();
}

/**
 * Returns true if the current page has a job detail view open.
 */
export function isOnJobPage() {
  const { provider } = getProvider();
  return provider.isOnJobPage();
}
