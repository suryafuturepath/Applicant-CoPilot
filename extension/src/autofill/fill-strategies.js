// autofill/fill-strategies.js — Form filling strategies
// Uses _fieldMap from detection to route each answer to the correct fill function.

import { getFieldMap } from '../state.js';
import { sendMessage } from '../messaging.js';
import { clearAutofillBadges, showAutofillBadge } from './badges.js';

// ─── Form filling (uses _fieldMap from detection) ────────────

/**
 * Fills form fields using AI-generated answers and the _fieldMap built by detectFormFields.
 * Routes each answer to the correct fill strategy based on the field type:
 *   - 'dropdown'        → fillSelectByText (native <select>)
 *   - 'custom_dropdown' → fillCustomDropdown (ARIA combobox, opens a listbox)
 *   - 'radio'           → fillRadioFromRef
 *   - 'checkbox'        → fillCheckboxFromRef
 *   - default           → fillInput (text/textarea/email/etc.)
 *
 * Falls back to fillFormLegacy() if answers is a plain object (old AI response format).
 * @async
 * @param {Array<Object>|Object} answers - AI answer array or legacy flat object.
 * @returns {Promise<{filled: number, skipped: string[]}>}
 */
export async function fillFormFromAnswers(answers) {
  const _fieldMap = getFieldMap();

  // Handle array format (new) or flat object (legacy)
  if (!Array.isArray(answers)) {
    return await fillFormLegacy(answers);
  }

  let filled = 0;
  const skipped = [];

  for (const ans of answers) {
    const val = ans.selected_option || ans.generated_text || '';
    if (!val || val === 'NEEDS_USER_INPUT') {
      skipped.push(ans.question_id);
      continue;
    }
    const qid = ans.question_id;

    try {
      const ref = _fieldMap[qid];
      if (!ref) {
        skipped.push(qid);
        continue;
      }


      // Route by ACTUAL element type
      if (ref.type === 'dropdown') {
        // For native selects: use deterministic matcher via background for better accuracy
        const questionText = ref.questionText || ans.question_text || '';
        if (questionText && ref.optionTexts && ref.optionTexts.length > 0) {
          try {
            const bestOption = await sendMessage({
              type: 'MATCH_DROPDOWN',
              questionText: questionText,
              options: ref.optionTexts
            });
            if (bestOption && bestOption !== 'SKIP' && bestOption !== 'NEEDS_USER_INPUT') {
              fillSelectByText(ref.el, bestOption, ref.optionMap, ref.optionTexts);
              showAutofillBadge(ref.el);
              filled++;
              continue;
            }
          } catch (e) {
          }
        }
        // Fallback: use the bulk AI answer directly
        fillSelectByText(ref.el, val, ref.optionMap, ref.optionTexts);
        showAutofillBadge(ref.el);
        filled++;
      } else if (ref.type === 'custom_dropdown') {
        if (await fillCustomDropdown(ref.el, ref.questionText || val)) {
          showAutofillBadge(ref.el);
          filled++;
        } else {
          skipped.push(qid);
        }
      } else if (ref.type === 'radio') {
        if (fillRadioFromRef(ref.radios, val)) {
          // Badge goes below the last radio in the group
          const lastRadio = ref.radios[ref.radios.length - 1]?.el || ref.radios[0]?.el;
          showAutofillBadge(lastRadio);
          filled++;
        } else {
          skipped.push(qid);
        }
      } else if (ref.type === 'checkbox') {
        fillCheckboxFromRef(ref.el, val);
        showAutofillBadge(ref.el);
        filled++;
      } else {
        fillInput(ref.el, val);
        showAutofillBadge(ref.el);
        filled++;
      }
    } catch (e) {
      skipped.push(qid);
    }
  }
  return { filled, skipped };
}

/**
 * Legacy fill path for old-format AI responses (flat key→value object).
 * Used as a fallback when the AI returns a map instead of an array.
 * @async
 * @param {Object} mapping - Map of field identifiers to answer strings.
 * @returns {Promise<{filled: number, skipped: []}>}
 */
async function fillFormLegacy(mapping) {
  const _fieldMap = getFieldMap();
  let filled = 0;
  for (const [key, value] of Object.entries(mapping)) {
    if (!value || value === 'NEEDS_USER_INPUT') continue;
    const ref = _fieldMap[key];
    if (!ref) continue;
    if (ref.type === 'dropdown') {
      fillSelectByText(ref.el, value, ref.optionMap, ref.optionTexts);
      showAutofillBadge(ref.el);
    } else if (ref.type === 'custom_dropdown') {
      await fillCustomDropdown(ref.el, ref.questionText || value);
      showAutofillBadge(ref.el);
    } else {
      fillInput(ref.el, value);
      showAutofillBadge(ref.el);
    }
    filled++;
  }
  return { filled, skipped: [] };
}

// ── Custom dropdown: open → read options → ask AI → click chosen option ──
// Custom dropdowns (used by Workday, Greenhouse, Lever, etc.) are not native
// <select> elements — they are ARIA comboboxes that render a listbox on click.
// Strategy: programmatically open them, read the live option elements, ask AI
// to pick one, then click the matching element and wait for it to register.

/**
 * Fills a custom ARIA dropdown by: opening it, reading its options,
 * sending them to the AI, and clicking the AI's chosen option.
 * @async
 * @param {HTMLElement} input        - The combobox trigger element.
 * @param {string}      questionText - The field's label, sent to the AI for context.
 * @returns {Promise<boolean>} true if successfully filled, false otherwise.
 */
async function fillCustomDropdown(input, questionText) {

  // Step 1: Click to open the dropdown
  input.focus();
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  input.click();
  await sleep(600);

  // Step 2: Read all visible option elements from the live DOM
  const optionEls = findVisibleOptions(input);
  if (optionEls.length === 0) {
    // Close the dropdown
    document.body.click();
    return false;
  }

  const optionTexts = optionEls.map(o => o.text);

  // Step 3: Ask AI to pick the best option
  let aiChoice;
  try {
    aiChoice = await sendMessage({
      type: 'MATCH_DROPDOWN',
      questionText: questionText,
      options: optionTexts
    });
  } catch (e) {
    document.body.click();
    return false;
  }


  if (!aiChoice || aiChoice === 'SKIP' || aiChoice === 'NEEDS_USER_INPUT') {
    document.body.click();
    return false;
  }

  // Step 4: Find the option element that matches AI's choice and click it
  const choiceLower = aiChoice.toLowerCase().trim();
  const choiceNorm = choiceLower.replace(/[^a-z0-9]/g, '');

  // Exact text match
  for (const opt of optionEls) {
    if (opt.text.toLowerCase().trim() === choiceLower) {
      clickElement(opt.el);
      await sleep(200);
      return true;
    }
  }

  // Normalized match
  for (const opt of optionEls) {
    if (opt.text.toLowerCase().replace(/[^a-z0-9]/g, '') === choiceNorm) {
      clickElement(opt.el);
      await sleep(200);
      return true;
    }
  }

  // Partial/contains match
  for (const opt of optionEls) {
    const optLower = opt.text.toLowerCase().trim();
    if (optLower.includes(choiceLower) || choiceLower.includes(optLower)) {
      clickElement(opt.el);
      await sleep(200);
      return true;
    }
  }

  document.body.click();
  return false;
}

/**
 * Finds all visible option elements for an open custom dropdown.
 * Checks the aria-controls listbox, nearby parent containers, and
 * any floating listbox/option elements currently in the DOM.
 * @param {HTMLElement} triggerEl - The combobox trigger that was clicked to open the dropdown.
 * @returns {Array<{text: string, el: HTMLElement}>} List of option text+element pairs.
 */
function findVisibleOptions(triggerEl) {
  const results = [];
  const seen = new Set();

  // Strategy 1: ARIA — find listbox via aria-controls/aria-owns
  const lbId = triggerEl.getAttribute('aria-controls') || triggerEl.getAttribute('aria-owns');
  if (lbId) {
    const lb = document.getElementById(lbId);
    if (lb) collectOptions(lb.querySelectorAll('[role="option"]'), results, seen);
  }

  // Strategy 2: Search nearby container
  const container = triggerEl.closest(
    '[class*="select"], [class*="dropdown"], [class*="field"], [class*="combobox"], [data-testid]'
  ) || triggerEl.parentElement?.parentElement;
  if (container) {
    collectOptions(container.querySelectorAll('[role="option"], [class*="option"]:not([class*="options"])'), results, seen);
  }

  // Strategy 3: Search entire document for visible options (dropdown might be portaled)
  if (results.length === 0) {
    const allOptions = document.querySelectorAll(
      '[role="option"], [role="listbox"] > *, .dropdown-option, [class*="menu-item"], [class*="listbox-option"]'
    );
    collectOptions(allOptions, results, seen);
  }

  return results;
}

/**
 * Collects visible, non-placeholder option elements from a node list.
 * Skips hidden elements (zero bounding rect) and placeholder text like "Select…".
 * @param {NodeList|Array} nodeList - DOM elements to scan.
 * @param {Array}          results  - Accumulator array of {text, el} objects.
 * @param {Set}            seen     - Set of already-collected text values (dedup).
 */
function collectOptions(nodeList, results, seen) {
  for (const el of nodeList) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    const text = el.textContent.trim();
    if (!text || seen.has(text)) continue;
    if (/^(select|choose|--|pick|search)/i.test(text)) continue;
    seen.add(text);
    results.push({ el, text });
  }
}

/**
 * Dispatches mousedown, mouseup, and click events on an element.
 * Required for custom dropdowns that listen to low-level mouse events
 * rather than just the 'click' event.
 * @param {HTMLElement} el - The element to click.
 */
function clickElement(el) {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  el.click();
}

/** Returns a Promise that resolves after `ms` milliseconds. Used for async waits during form fill. */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Select: match AI's option text → actual option value, then select it ──

/**
 * Selects the best matching option in a native <select> element.
 * Tries six strategies in order: exact map lookup, exact value match,
 * exact text match, normalised match (strip punctuation), partial/contains match,
 * and finally a word-overlap fuzzy score.
 * @param {HTMLSelectElement} select      - The native select element to fill.
 * @param {string}            aiText      - The option text chosen by the AI.
 * @param {Object}            optionMap   - Map of lowercase option text → option value.
 * @param {string[]}          optionTexts - Array of option text strings (for fallback).
 */
function fillSelectByText(select, aiText, optionMap, optionTexts) {
  const text = String(aiText).trim();
  const textLower = text.toLowerCase();

  // 1. Exact text match → get the real value from our map
  if (optionMap && optionMap[textLower] !== undefined) {
    select.value = optionMap[textLower];
    fireEvents(select);
    return;
  }

  // 2. Try matching against actual <option> elements directly
  const realOptions = Array.from(select.options).filter(o =>
    o.value.trim() && o.value.trim() !== '-1' && o.textContent.trim()
  );

  // Exact value match (AI returned the value attribute)
  for (const opt of realOptions) {
    if (opt.value === text || opt.value.toLowerCase() === textLower) {
      select.value = opt.value;
      fireEvents(select);
      return;
    }
  }

  // 3. Normalized match — strip all non-alphanumeric chars
  const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const textNorm = norm(text);
  for (const opt of realOptions) {
    if (norm(opt.textContent) === textNorm) {
      select.value = opt.value;
      fireEvents(select);
      return;
    }
  }

  // 4. Partial / contains match on text
  for (const opt of realOptions) {
    const optText = opt.textContent.trim().toLowerCase();
    if (optText.includes(textLower) || textLower.includes(optText)) {
      select.value = opt.value;
      fireEvents(select);
      return;
    }
  }

  // 4. Best fuzzy match — word overlap + prefix scoring
  let bestOpt = null;
  let bestScore = 0;
  const words = textLower.split(/[\s,\/\-_]+/).filter(Boolean);
  for (const opt of realOptions) {
    const optText = opt.textContent.trim().toLowerCase();
    const optWords = optText.split(/[\s,\/\-_]+/).filter(Boolean);
    let score = 0;
    for (const w of words) {
      for (const ow of optWords) {
        if (w === ow) { score += 10; continue; }
        let p = 0;
        while (p < w.length && p < ow.length && w[p] === ow[p]) p++;
        if (p >= 2) score += p;
      }
    }
    if (score > bestScore) { bestScore = score; bestOpt = opt; }
  }
  if (bestOpt && bestScore >= 3) {
    select.value = bestOpt.value;
    fireEvents(select);
    return;
  }

}

// ── Radio: use stored refs directly ──

/**
 * Selects a radio button from a group based on the AI's text answer.
 * Tries exact label match, then normalised match, then partial match.
 * @param {Array<{text: string, el: HTMLInputElement}>} radioRefs - Radio option refs.
 * @param {string} selectedText - The option text chosen by the AI.
 */
function fillRadioFromRef(radioRefs, selectedText) {
  const target = selectedText.toLowerCase().trim();

  // Exact label match
  for (const r of radioRefs) {
    if (r.text.toLowerCase().trim() === target || r.el.value.toLowerCase().trim() === target) {
      r.el.checked = true;
      fireEvents(r.el);
      return true;
    }
  }
  // Partial match
  for (const r of radioRefs) {
    const label = r.text.toLowerCase().trim();
    const val = r.el.value.toLowerCase().trim();
    if (label.includes(target) || target.includes(label) ||
        val.includes(target) || target.includes(val)) {
      r.el.checked = true;
      fireEvents(r.el);
      return true;
    }
  }
  return false;
}

// ── Checkbox: use stored ref directly ──

/**
 * Checks or unchecks a checkbox based on the AI's answer value.
 * Treats 'yes', 'true', '1', 'agree', 'accept' as truthy.
 * @param {HTMLInputElement} cb    - The checkbox element.
 * @param {string}           value - The AI's answer string.
 */
function fillCheckboxFromRef(cb, value) {
  const shouldCheck = /^(yes|true|1|checked|agree|accept)$/i.test(String(value).trim());
  if (cb.checked !== shouldCheck) {
    cb.checked = shouldCheck;
    fireEvents(cb);
  }
}

// ── Shared event dispatcher ──

/**
 * Fires input, change, and blur events on an element.
 * Required to notify React/Vue/Angular frameworks that the value was
 * changed programmatically — without these events, the framework's
 * internal state won't update and the value may be ignored on submit.
 * @param {HTMLElement} el - The form element that was just filled.
 */
export function fireEvents(el) {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Sets a text input or textarea value in a React-compatible way.
 * React overrides the native value setter — if you set input.value directly,
 * React won't detect the change and the field will appear unchanged on submit.
 * Using Object.getOwnPropertyDescriptor to access the native setter bypasses
 * React's override and triggers its synthetic event system correctly.
 * @param {HTMLInputElement|HTMLTextAreaElement} input - The input to fill.
 * @param {string} value - The value to set.
 */
export function fillInput(input, value) {
  // React-compatible value setter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype, 'value'
  )?.set;

  const setter = input.tagName.toLowerCase() === 'textarea'
    ? nativeTextAreaValueSetter
    : nativeInputValueSetter;

  if (setter) {
    setter.call(input, value);
  } else {
    input.value = value;
  }

  // Dispatch events for frameworks
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  input.dispatchEvent(new Event('blur', { bubbles: true }));
}

/**
 * Fills a single form field from one AI answer object.
 * Routes to the correct fill function based on the field type in _fieldMap.
 * @async
 * @param {Object} ans - Answer object with question_id and answer_value.
 */
export async function fillSingleField(ans) {
  const _fieldMap = getFieldMap();
  const ref = _fieldMap[ans.question_id];
  if (!ref) return;
  const val = (ans.answer_value || ans.answer || '').trim();
  if (!val) return;
  try {
    if (ref.type === 'dropdown') {
      const questionText = ref.questionText || ans.question_text || '';
      if (questionText && ref.optionTexts?.length) {
        const best = await sendMessage({ type: 'MATCH_DROPDOWN', questionText, options: ref.optionTexts });
        if (best && best !== 'SKIP' && best !== 'NEEDS_USER_INPUT') {
          fillSelectByText(ref.el, best, ref.optionMap, ref.optionTexts);
          return;
        }
      }
      fillSelectByText(ref.el, val, ref.optionMap, ref.optionTexts);
    } else if (ref.type === 'custom_dropdown') {
      await fillCustomDropdown(ref.el, ref.questionText || val);
    } else if (ref.type === 'radio') {
      fillRadioFromRef(ref.options, val);
    } else if (ref.type === 'checkbox') {
      fillCheckboxFromRef(ref.el, val);
    } else {
      fillInput(ref.el, val);
    }
  } catch (_) { /* ignore individual fill errors — don't block other fields */ }
}
