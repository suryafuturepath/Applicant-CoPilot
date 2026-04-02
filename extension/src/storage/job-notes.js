// storage/job-notes.js — Per-URL free-text notes stored in chrome.storage.local

import { getShadowRoot } from '../state.js';

const NOTES_STORAGE_KEY = 'ac_jobNotes';

/**
 * Loads saved notes for the current page URL and populates the notes textarea.
 * @async
 */
export async function loadJobNotes() {
  try {
    const url = window.location.href;
    const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
    const notes = result[NOTES_STORAGE_KEY] || {};
    const shadowRoot = getShadowRoot();
    const textarea = shadowRoot && shadowRoot.getElementById('jmNotesInput');
    if (textarea) textarea.value = notes[url] || '';
  } catch (e) { /* ignore */ }
}

/**
 * Saves the current notes textarea value for the current page URL.
 * Called on textarea blur and input events (auto-save).
 * Caps the notes map at 200 entries by evicting the oldest.
 * @async
 */
export async function saveJobNotes() {
  try {
    const url = window.location.href;
    const shadowRoot = getShadowRoot();
    const textarea = shadowRoot && shadowRoot.getElementById('jmNotesInput');
    if (!textarea) return;
    const result = await chrome.storage.local.get(NOTES_STORAGE_KEY);
    const notes = result[NOTES_STORAGE_KEY] || {};
    const val = textarea.value.trim();
    if (val) {
      notes[url] = val;
    } else {
      delete notes[url];
    }
    const keys = Object.keys(notes);
    if (keys.length > 200) keys.slice(0, keys.length - 200).forEach(k => delete notes[k]);
    await chrome.storage.local.set({ [NOTES_STORAGE_KEY]: notes });
  } catch (e) { /* ignore */ }
}
