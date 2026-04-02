// storage/analysis-cache.js — Persistent analysis cache (chrome.storage.local)

const CACHE_STORAGE_KEY = 'ac_analysisCache';
const MAX_CACHE_ENTRIES = 50;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24-hour TTL

/**
 * Retrieves a cached analysis result for the given page URL.
 * @async
 * @param {string} url - The full URL of the job posting page.
 * @returns {Promise<Object|null>} Cached result or null if not found/expired.
 */
export async function getCachedAnalysis(url) {
  const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
  const cache = result[CACHE_STORAGE_KEY] || {};
  const entry = cache[url];
  if (!entry) return null;
  if (entry.timestamp && Date.now() - entry.timestamp > CACHE_TTL_MS) {
    delete cache[url];
    await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
    return null;
  }
  return entry;
}

/**
 * Stores an analysis result for the given URL, evicting the oldest entries
 * when the cache exceeds MAX_CACHE_ENTRIES.
 * @async
 * @param {string} url  - The full URL of the job posting page.
 * @param {Object} data - The analysis payload to cache.
 */
export async function setCachedAnalysis(url, data) {
  const result = await chrome.storage.local.get(CACHE_STORAGE_KEY);
  const cache = result[CACHE_STORAGE_KEY] || {};
  cache[url] = { ...data, timestamp: Date.now() };
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE_ENTRIES) {
    keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach(k => delete cache[k]);
  }
  await chrome.storage.local.set({ [CACHE_STORAGE_KEY]: cache });
}
