// autofill/autofill-pipeline.js — AutoFill pipeline
// The autofill pipeline:
//   1. Detect — detectFormFields() scans the page and builds _fieldMap.
//   2. AI     — GENERATE_AUTOFILL sends questions to background, gets answers.
//   3. Fill   — fillFormFromAnswers() immediately writes answers into the form.

import { getShadowRoot, setFieldMap, setPendingAnswers, setPendingQuestions, getPendingAnswers } from '../state.js';
import { sendMessage } from '../messaging.js';
import { detectFormFields } from './field-detection.js';
import { fillFormFromAnswers } from './fill-strategies.js';
import { showInlineChips } from './inline-chips.js';
import { setStatus, clearStatus, scrollPanelTo } from '../panel/status.js';
import { escapeHTML } from '../utils.js';

/**
 * Initiates the autofill pipeline: detects fields, asks AI for answers,
 * then immediately fills the form.
 * @async
 */
export async function autofillForm() {
  const shadowRoot = getShadowRoot();
  const btn = shadowRoot.getElementById('jmAutofill');
  btn.disabled = true;
  btn.innerHTML = '<span class="jm-spinner"></span> Scanning form...';

  try {
    // Step 1: detect fields and store DOM references
    setFieldMap({});
    const questions = detectFormFields();
    if (questions.length === 0) {
      setStatus('No form fields found on this page.', 'error');
      return;
    }

    setStatus(`Found ${questions.length} fields. Filling...`, 'info');

    // Step 2: send serializable questions to AI (no DOM refs)
    const questionsForAI = questions.map(q => {
      const clean = { ...q };
      delete clean._el;
      delete clean._radios;
      return clean;
    });

    const response = await sendMessage({
      type: 'GENERATE_AUTOFILL',
      formFields: questionsForAI
    });

    // Step 3: directly fill the form
    const answers = response.answers || response;
    const { filled, skipped } = await fillFormFromAnswers(answers);
    const msg = `Filled ${filled} field${filled === 1 ? '' : 's'}` +
      (skipped.length ? ` (${skipped.length} need your input)` : '');
    setStatus(msg, 'success');
    setTimeout(clearStatus, 3000);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = 'AutoFill Application';
  }
}

/**
 * Renders the autofill preview panel, showing each detected field alongside
 * the AI's proposed answer.  Fields flagged as NEEDS_USER_INPUT are highlighted.
 * Stores answers and questions in _pendingAnswers/_pendingQuestions for applyAutofill.
 * @param {Array<Object>} answers   - AI answer objects from GENERATE_AUTOFILL.
 * @param {Array<Object>} questions - Detected form field descriptors.
 */
function showAutofillPreview(answers, questions) {
  const shadowRoot = getShadowRoot();
  const previewSection = shadowRoot.getElementById('jmAutofillPreview');
  const list = shadowRoot.getElementById('jmPreviewList');
  const countEl = shadowRoot.getElementById('jmPreviewCount');

  list.innerHTML = '';

  const questionMap = {};
  questions.forEach(q => { questionMap[q.question_id] = q; });

  let fillableCount = 0;
  let needsInputCount = 0;

  (Array.isArray(answers) ? answers : []).forEach(ans => {
    const val = ans.selected_option || ans.generated_text || '';
    const isNeeded = !val || val === 'NEEDS_USER_INPUT';
    const qInfo = questionMap[ans.question_id];
    const label = qInfo?.question_text || ans.question_id || '';

    if (isNeeded) needsInputCount++;
    else fillableCount++;

    const row = document.createElement('div');
    row.className = 'jm-preview-row' + (isNeeded ? ' jm-needs-input' : '');
    row.dataset.qid = ans.question_id;

    if (isNeeded) {
      row.innerHTML = `
        <div style="flex:1">
          <div class="jm-preview-label">${escapeHTML(label)}</div>
          <div class="jm-preview-val">&#9888; Needs manual input</div>
        </div>`;
    } else {
      const displayVal = val.length > 70 ? val.substring(0, 70) + '\u2026' : val;
      row.innerHTML = `
        <input type="checkbox" checked data-qid="${escapeHTML(ans.question_id)}">
        <div style="flex:1;min-width:0">
          <div class="jm-preview-label">${escapeHTML(label)}</div>
          <div class="jm-preview-val" title="${escapeHTML(val)}">${escapeHTML(displayVal)}</div>
        </div>`;
    }
    list.appendChild(row);
  });

  countEl.textContent = `\u2014 ${fillableCount} fillable, ${needsInputCount} need manual input`;
  previewSection.style.display = 'block';
  scrollPanelTo(previewSection);
}

/**
 * Applies the pending autofill answers to the form (phase 3 of the pipeline).
 * Called when the user clicks "Apply Selected" in the preview panel.
 * Shows a summary toast indicating how many fields were filled vs skipped.
 * @async
 */
export async function applyAutofill() {
  const _pendingAnswers = getPendingAnswers();
  if (!_pendingAnswers) return;
  const shadowRoot = getShadowRoot();
  const applyBtn = shadowRoot.getElementById('jmApplyFill');
  applyBtn.disabled = true;
  applyBtn.innerHTML = '<span class="jm-spinner"></span> Filling...';
  try {
    const checkedIds = new Set(
      Array.from(shadowRoot.querySelectorAll('#jmPreviewList input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.qid)
    );

    const selectedAnswers = (Array.isArray(_pendingAnswers) ? _pendingAnswers : [])
      .filter(a => checkedIds.has(a.question_id));

    const { filled, skipped } = await fillFormFromAnswers(selectedAnswers);

    let msg = `Filled ${filled} of ${selectedAnswers.length} selected fields.`;
    if (skipped.length > 0) {
      msg += ` ${skipped.length} could not be filled \u2014 check manually.`;
    }
    msg += ' Review before submitting!';
    setStatus(msg, 'success');

    shadowRoot.getElementById('jmAutofillPreview').style.display = 'none';
    setPendingAnswers(null);
    setPendingQuestions([]);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  } finally {
    applyBtn.disabled = false;
    applyBtn.innerHTML = 'Apply Selected';
  }
}

/** Dismisses the autofill preview panel and clears pending state. */
export function cancelAutofill() {
  const shadowRoot = getShadowRoot();
  shadowRoot.getElementById('jmAutofillPreview').style.display = 'none';
  setPendingAnswers(null);
  setPendingQuestions([]);
  clearStatus();
}
