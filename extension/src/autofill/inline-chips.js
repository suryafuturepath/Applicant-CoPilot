// autofill/inline-chips.js — Inline autofill chips
// Chips are injected directly into document.body (not Shadow DOM) so they
// can be positioned right next to the actual form fields on the page.
// Each chip shows the AI's proposed answer with Accept, Dismiss, and
// inline editing. A sticky bar at the bottom provides Apply All / Dismiss All.

import { getFieldMap, getShadowRoot } from '../state.js';
import { fillSingleField } from './fill-strategies.js';
import { injectChipStyles } from './badges.js';
import { setStatus, clearStatus } from '../panel/status.js';

// Module-local state
let _chips = new Map();       // questionId → { chipEl, fieldEl, ans, ansEl }
let _chipBar = null;          // sticky bottom bar element
let _chipScrollHandler = null; // scroll listener reference (for cleanup)
let _chipResizeObs = null;    // ResizeObserver reference (for cleanup)

/**
 * Main entry point: creates a chip for every AI answer that has a value,
 * positions each chip near its form field, and shows the sticky bottom bar.
 * @param {Array<Object>} answers - AI answer objects from GENERATE_AUTOFILL.
 */
export function showInlineChips(answers) {
  clearAllChips();
  injectChipStyles();

  const _fieldMap = getFieldMap();

  if (!Array.isArray(answers)) answers = answers ? [answers] : [];

  let count = 0;

  answers.forEach(ans => {
    const val   = (ans.answer_value || ans.answer || '').trim();
    const qid   = ans.question_id;
    const ref   = _fieldMap[qid];
    if (!ref) return;

    // Resolve the DOM element to anchor the chip to
    const fieldEl = ref.type === 'radio'
      ? ref.options?.[0]?.el     // first radio button in the group
      : ref.el;
    if (!fieldEl) return;

    const needsInput = !val || val === 'NEEDS_USER_INPUT' || val === 'SKIP';

    // Highlight the field so the user can see it's detected
    fieldEl.classList.add('jmai-field-ring');

    // ── Build the chip ──────────────────────────────────────────
    const chip = document.createElement('div');
    chip.className = 'jmai-chip' + (needsInput ? ' jmai-needs-input' : '');
    chip.dataset.qid = qid;

    // Icon
    const icon = document.createElement('span');
    icon.className = 'jmai-chip-icon';
    icon.textContent = needsInput ? '?' : '\u2605';

    // Editable answer text
    const ansEl = document.createElement('span');
    ansEl.className = 'jmai-chip-answer';
    ansEl.contentEditable = 'true';
    ansEl.spellcheck = false;
    if (needsInput) {
      ansEl.setAttribute('data-empty', '');
      ansEl.setAttribute('data-placeholder', 'Enter your answer\u2026');
      ansEl.title = `${ans.question_text || 'Field'} \u2014 enter your answer`;
    } else {
      ansEl.textContent = val;
      ansEl.title = `${ans.question_text || 'Field'}: ${val} \u2014 click to edit`;
    }
    // Remove empty-placeholder attribute once user starts typing
    ansEl.addEventListener('input', () => {
      if (ansEl.textContent.trim()) ansEl.removeAttribute('data-empty');
      else ansEl.setAttribute('data-empty', '');
    });

    // Accept button
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'jmai-chip-accept';
    acceptBtn.textContent = '\u2713';
    acceptBtn.title = 'Apply this answer';

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'jmai-chip-dismiss';
    dismissBtn.textContent = '\u2715';
    dismissBtn.title = 'Skip this field';

    chip.appendChild(icon);
    chip.appendChild(ansEl);
    chip.appendChild(acceptBtn);
    chip.appendChild(dismissBtn);
    document.body.appendChild(chip);

    const chipData = { chipEl: chip, fieldEl, ans, ansEl };
    _chips.set(qid, chipData);
    positionChip(chip, fieldEl);
    count++;

    // ── Accept handler ──────────────────────────────────────────
    acceptBtn.addEventListener('click', async () => {
      const currentVal = ansEl.textContent.trim();
      if (!currentVal) { ansEl.focus(); return; } // force user to type something for empty fields
      ans.answer_value = currentVal;
      ans.answer       = currentVal;
      await fillSingleField(ans);
      removeChip(qid);
    });

    // ── Dismiss handler ─────────────────────────────────────────
    dismissBtn.addEventListener('click', () => removeChip(qid));
  });

  if (count === 0) {
    setStatus('No fillable fields detected on this page.', 'info');
    setTimeout(clearStatus, 2500);
    return;
  }

  createChipBar(count);

  // Reposition chips on scroll (page scrolls, field rects change)
  _chipScrollHandler = repositionAllChips;
  window.addEventListener('scroll', _chipScrollHandler, { passive: true });

  // Reposition chips if the page layout changes (e.g. accordions opening)
  _chipResizeObs = new ResizeObserver(repositionAllChips);
  _chipResizeObs.observe(document.documentElement);
}

/**
 * Positions a chip above the field if space allows, otherwise below.
 * Uses position:fixed with getBoundingClientRect() so it tracks the viewport.
 * @param {HTMLElement} chipEl  - The chip element.
 * @param {HTMLElement} fieldEl - The form field to anchor to.
 */
function positionChip(chipEl, fieldEl) {
  const rect = fieldEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    chipEl.style.display = 'none'; // field not visible — hide chip
    return;
  }
  chipEl.style.display = '';

  // Width: match field width, clamped between 160px and 360px
  const w = Math.min(360, Math.max(160, rect.width));
  chipEl.style.width = w + 'px';

  // Horizontal: align left edge with field, clamp to viewport
  const left = Math.min(Math.max(4, rect.left), window.innerWidth - w - 4);
  chipEl.style.left = left + 'px';

  // Vertical: prefer above (need ~42px clearance), fall back to below
  const CHIP_H = 42;
  if (rect.top >= CHIP_H + 6) {
    chipEl.style.top = (rect.top - CHIP_H - 4) + 'px';
  } else {
    chipEl.style.top = (rect.bottom + 4) + 'px';
  }
}

/** Repositions all visible chips — called on scroll/resize. */
function repositionAllChips() {
  _chips.forEach(({ chipEl, fieldEl }) => positionChip(chipEl, fieldEl));
}

/**
 * Removes a single chip with a fade animation, unhighlights its field,
 * and updates the bottom bar count. Clears everything when the last chip goes.
 * @param {string} qid - The question_id of the chip to remove.
 */
function removeChip(qid) {
  const data = _chips.get(qid);
  if (!data) return;
  const { chipEl, fieldEl } = data;
  fieldEl.classList.remove('jmai-field-ring');
  chipEl.classList.add('jmai-fade-out');
  setTimeout(() => { chipEl.remove(); }, 200);
  _chips.delete(qid);
  if (_chips.size === 0) {
    clearAllChips();
    // Reset the AutoFill button
    const shadowRoot = getShadowRoot();
    const btn = shadowRoot && shadowRoot.getElementById('jmAutofill');
    if (btn) { btn.innerHTML = 'AutoFill Application'; btn.onclick = null; }
  } else {
    updateChipBar();
  }
}

/**
 * Creates the sticky bottom bar with Apply All / Dismiss All controls.
 * @param {number} count - Initial suggestion count for the label.
 */
function createChipBar(count) {
  if (_chipBar) _chipBar.remove();
  const bar = document.createElement('div');
  bar.className = 'jmai-chip-bar';
  bar.innerHTML = `
    <span class="jmai-bar-logo">\u2605</span>
    <span class="jmai-bar-text">${count} suggestion${count === 1 ? '' : 's'} ready</span>
    <button class="jmai-bar-apply">Apply All</button>
    <button class="jmai-bar-dismiss">Dismiss All</button>
  `;
  document.body.appendChild(bar);
  _chipBar = bar;
  bar.querySelector('.jmai-bar-apply').addEventListener('click', applyAllChips);
  bar.querySelector('.jmai-bar-dismiss').addEventListener('click', clearAllChips);
}

/** Updates the suggestion count label in the bottom bar. */
function updateChipBar() {
  if (!_chipBar) return;
  const n = _chips.size;
  const label = _chipBar.querySelector('.jmai-bar-text');
  if (label) label.textContent = `${n} suggestion${n === 1 ? '' : 's'} remaining`;
}

/**
 * Applies all remaining chip answers to their respective form fields, then cleans up.
 * Skips any chip whose answer text is empty.
 * @async
 */
async function applyAllChips() {
  const entries = Array.from(_chips.values());
  let filled = 0;
  for (const { ans, ansEl, fieldEl } of entries) {
    const currentVal = ansEl.textContent.trim();
    if (!currentVal || currentVal === 'NEEDS_USER_INPUT') continue;
    ans.answer_value = currentVal;
    ans.answer       = currentVal;
    await fillSingleField(ans);
    fieldEl.classList.remove('jmai-field-ring');
    filled++;
  }
  // Show brief success message in the bar before clearing
  if (_chipBar) {
    const label = _chipBar.querySelector('.jmai-bar-text');
    if (label) label.textContent = `\u2713 ${filled} field${filled === 1 ? '' : 's'} filled!`;
  }
  setTimeout(() => {
    clearAllChips();
    const shadowRoot = getShadowRoot();
    const btn = shadowRoot && shadowRoot.getElementById('jmAutofill');
    if (btn) { btn.innerHTML = 'AutoFill Application'; btn.onclick = null; }
  }, 700);
}

/**
 * Removes all chips, the bottom bar, field highlights, and event listeners.
 * Safe to call even when no chips are active.
 */
export function clearAllChips() {
  _chips.forEach(({ chipEl, fieldEl }) => {
    fieldEl.classList.remove('jmai-field-ring');
    chipEl.remove();
  });
  _chips.clear();
  if (_chipBar)          { _chipBar.remove();                _chipBar = null; }
  if (_chipScrollHandler){ window.removeEventListener('scroll', _chipScrollHandler); _chipScrollHandler = null; }
  if (_chipResizeObs)    { _chipResizeObs.disconnect();      _chipResizeObs = null; }
}
