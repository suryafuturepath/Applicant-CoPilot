// autofill/field-detection.js — Form field detection
// Scans the live DOM for all fillable form fields and builds two data structures:
//   questions[] — serialisable descriptors sent to the AI (label, type, options)
//   _fieldMap   — maps each question_id to the actual DOM element(s) for filling
//
// Supported field types: text/email/tel/number inputs, textareas, native <select>,
// custom dropdown triggers (aria-combobox, aria-haspopup), radio groups, checkboxes.

import { getFieldMap, setFieldMap } from '../state.js';

/**
 * Detects all fillable form fields on the current page.
 * Populates the module-level _fieldMap and returns a serialisable questions array.
 * @returns {Array<Object>} Array of field descriptors to send to the AI.
 */
export function detectFormFields() {
  const _fieldMap = getFieldMap();
  const questions = [];
  let qIndex = 0;
  const seen = new Set(); // track qids to avoid duplicates

  // ── Helper: build select option data ──
  function buildSelectOptions(selectEl) {
    const optMap = {};
    const optTexts = [];
    Array.from(selectEl.options).forEach(o => {
      const v = o.value.trim();
      const t = o.textContent.trim();
      if (!v || v === '' || v === '-1') return;
      if (!t || /^(select|choose|--|pick)/i.test(t)) return;
      optTexts.push(t);
      optMap[t.toLowerCase()] = o.value;
    });
    return { optMap, optTexts };
  }

  // ── Helper: detect if an input is a custom dropdown trigger ──
  function isCustomDropdown(el) {
    if (el.getAttribute('role') === 'combobox') return true;
    if (el.getAttribute('aria-haspopup') === 'listbox' || el.getAttribute('aria-haspopup') === 'true') return true;
    if (el.getAttribute('aria-autocomplete')) return true;
    if (el.getAttribute('data-testid')?.includes('select')) return true;
    // Check if parent/grandparent looks like a select wrapper
    const wrapper = el.closest('[class*="select"], [class*="dropdown"], [class*="combobox"], [class*="listbox"]');
    if (wrapper && wrapper.querySelector('[role="listbox"], [role="option"], [class*="option"]')) return true;
    return false;
  }

  // ── Helper: read options from custom dropdown's associated listbox ──
  function readCustomOptions(el) {
    const optTexts = [];
    // 1. Check aria-controls / aria-owns
    const listboxId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (listboxId) {
      const lb = document.getElementById(listboxId);
      if (lb) {
        lb.querySelectorAll('[role="option"]').forEach(o => {
          const t = o.textContent.trim();
          if (t) optTexts.push(t);
        });
        if (optTexts.length > 0) return optTexts;
      }
    }
    // 2. Search nearby in DOM
    const container = el.closest('[class*="select"], [class*="dropdown"], [class*="field"], [data-testid]') || el.parentElement;
    if (container) {
      container.querySelectorAll('[role="option"], [class*="option"]:not([class*="options"])').forEach(o => {
        const t = o.textContent.trim();
        if (t && !optTexts.includes(t)) optTexts.push(t);
      });
    }
    return optTexts;
  }

  // ── 1. ALL <select> elements (visible AND hidden) ──
  document.querySelectorAll('select').forEach(sel => {
    const qid = sel.id || sel.name;
    if (!qid || seen.has(qid)) return;
    const label = getFieldLabel(sel);
    if (!label && !sel.id && !sel.name) return;

    const { optMap, optTexts } = buildSelectOptions(sel);
    if (optTexts.length === 0) return;

    seen.add(qid);
    questions.push({
      question_id: qid,
      question_text: label || sel.name || '',
      field_type: 'dropdown',
      required: sel.required,
      available_options: optTexts
    });
    _fieldMap[qid] = { el: sel, type: 'dropdown', optionMap: optMap, optionTexts: optTexts, questionText: label || sel.name || '' };
    qIndex++;
  });

  // ── 2. Text inputs, textareas (detect custom dropdowns among them) ──
  document.querySelectorAll(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), textarea'
  ).forEach(input => {
    if (input.offsetParent === null) return;
    const label = getFieldLabel(input);
    const qid = input.id || input.name || ('q_' + qIndex);
    if ((!label && !input.id && !input.name) || seen.has(qid)) return;

    const tag = input.tagName.toLowerCase();

    // Check if this text input is actually a custom dropdown
    if (tag !== 'textarea' && isCustomDropdown(input)) {
      const optTexts = readCustomOptions(input);
      seen.add(qid);
      questions.push({
        question_id: qid,
        question_text: label || input.placeholder || input.name || '',
        field_type: 'dropdown',
        required: input.required,
        available_options: optTexts // may be empty — will be read during fill
      });
      _fieldMap[qid] = { el: input, type: 'custom_dropdown', optionTexts: optTexts, questionText: label || input.placeholder || input.name || '' };
      qIndex++;
      return;
    }

    // Check if a hidden <select> shares this field's container (custom select wrappers)
    const container = input.closest('.field, .form-field, .form-group, [class*="field"], [class*="select"]');
    if (container) {
      const hiddenSelect = container.querySelector('select');
      if (hiddenSelect && !seen.has(hiddenSelect.id || hiddenSelect.name)) {
        const selQid = hiddenSelect.id || hiddenSelect.name || qid;
        if (!seen.has(selQid)) {
          const { optMap, optTexts } = buildSelectOptions(hiddenSelect);
          if (optTexts.length > 0) {
            seen.add(selQid);
            seen.add(qid);
            questions.push({
              question_id: selQid,
              question_text: label || input.placeholder || '',
              field_type: 'dropdown',
              required: input.required || hiddenSelect.required,
              available_options: optTexts
            });
            // Store BOTH the hidden select and the visible input
            _fieldMap[selQid] = {
              el: hiddenSelect, visibleEl: input,
              type: 'dropdown', optionMap: optMap, optionTexts: optTexts,
              questionText: label || input.placeholder || ''
            };
            qIndex++;
            return;
          }
        }
      }
    }

    // Regular text / textarea
    seen.add(qid);
    const fieldType = tag === 'textarea' ? 'textarea' : 'text';
    questions.push({
      question_id: qid,
      question_text: label || input.placeholder || input.name || '',
      field_type: fieldType,
      required: input.required
    });
    _fieldMap[qid] = { el: input, type: fieldType };
    qIndex++;
  });

  // ── 3. Radio button groups ──
  const radioGroups = {};
  document.querySelectorAll('input[type="radio"]').forEach(radio => {
    if (radio.offsetParent === null) return;
    const groupName = radio.name;
    if (!groupName) return;
    if (!radioGroups[groupName]) {
      radioGroups[groupName] = {
        question_id: groupName,
        question_text: getFieldLabel(radio) || groupName.replace(/[_-]/g, ' '),
        field_type: 'radio',
        required: radio.required,
        available_options: [],
        _radios: []
      };
      _fieldMap[groupName] = { type: 'radio', radios: [] };
    }
    const optText = getRadioLabel(radio);
    if (optText && !radioGroups[groupName].available_options.includes(optText)) {
      radioGroups[groupName].available_options.push(optText);
    }
    radioGroups[groupName]._radios.push(radio);
    _fieldMap[groupName].radios.push({ el: radio, text: optText });
  });
  for (const group of Object.values(radioGroups)) {
    if (group.available_options.length > 0) {
      const clean = { ...group };
      delete clean._radios;
      questions.push(clean);
    }
  }

  // ── 4. Standalone checkboxes ──
  document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    if (cb.offsetParent === null) return;
    const label = getFieldLabel(cb) || getRadioLabel(cb);
    if (!label) return;
    const qid = cb.id || cb.name || ('cb_' + qIndex);
    if (seen.has(qid)) return;
    seen.add(qid);
    questions.push({
      question_id: qid,
      question_text: label,
      field_type: 'checkbox',
      required: cb.required,
      available_options: ['Yes', 'No']
    });
    _fieldMap[qid] = { el: cb, type: 'checkbox' };
    qIndex++;
  });

  setFieldMap(_fieldMap);
  return questions;
}

/**
 * Extracts the visible label text for a radio button.
 * Clones the parent label and strips the input element to get only text.
 * @param {HTMLInputElement} input - A radio input element.
 * @returns {string} The label text, or '' if not determinable.
 */
function getRadioLabel(input) {
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input').forEach(el => el.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }
  const next = input.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim()) {
    return next.textContent.trim();
  }
  if (next && next.nodeType === Node.ELEMENT_NODE && next.tagName === 'LABEL') {
    return next.textContent.trim();
  }
  if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');
  if (input.value && input.value !== 'on') return input.value;
  return '';
}

/**
 * Resolves a human-readable label for a form input using multiple strategies:
 * 1. <label for="id"> association, 2. wrapping <label>, 3. aria-label/aria-labelledby,
 * 4. placeholder, 5. nearby sibling/parent text.
 * @param {HTMLElement} input - Any form element.
 * @returns {string} The best label text found, or ''.
 */
export function getFieldLabel(input) {
  // 1. <label for="id">
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return label.textContent.trim();
  }

  // 2. Wrapping <label>
  const parentLabel = input.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, textarea, select').forEach(el => el.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }

  // 3. aria-label
  if (input.getAttribute('aria-label')) return input.getAttribute('aria-label');

  // 4. aria-labelledby
  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy) {
    const el = document.getElementById(labelledBy);
    if (el) return el.textContent.trim();
  }

  // 5. placeholder
  if (input.placeholder) return input.placeholder;

  // 6. name attribute (humanized)
  if (input.name) return input.name.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

  return '';
}
