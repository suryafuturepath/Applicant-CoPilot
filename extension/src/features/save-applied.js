import { getShadowRoot, getCurrentAnalysis } from '../state.js';
import { sendMessage } from '../messaging.js';
import { setStatus, clearStatus } from '../panel/status.js';
import { extractJobTitle, extractCompany, extractLocation, extractSalary } from '../platform/jd-extractor.js';

// ─── Save job ─────────────────────────────────────────────────

/**
 * Saves the current job to the user's saved-jobs list via background.js.
 * Requires a completed analysis (currentAnalysis must be non-null).
 * @async
 */
export async function saveJob() {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis) return;
  try {
    await sendMessage({
      type: 'SAVE_JOB',
      jobData: {
        title: currentAnalysis.title,
        company: currentAnalysis.company,
        location: currentAnalysis.location || '',
        salary: currentAnalysis.salary || '',
        score: currentAnalysis.matchScore,
        url: currentAnalysis.url,
        analysis: currentAnalysis,
      }
    });
    // Update button to "Saved" state
    const saveBtn = shadowRoot.getElementById('jmSaveJob');
    if (saveBtn) {
      saveBtn.textContent = 'Saved';
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.7';
    }
    setStatus('Job saved to tracker!', 'success');
    setTimeout(clearStatus, 2000);
  } catch (err) {
    setStatus('Error saving: ' + err.message, 'error');
  }
}

// ─── Mark as Applied ─────────────────────────────────────────

/**
 * Records the current job as applied in the user's applied-jobs list.
 * Deduplication is handled by background.js (URL-based).
 * Updates the button text to "Applied ✓" on success.
 * @async
 */
export async function markApplied() {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis) return;
  const btn = shadowRoot.getElementById('jmMarkApplied');
  btn.disabled = true;
  try {
    await sendMessage({
      type: 'MARK_APPLIED',
      jobData: {
        title: currentAnalysis.title,
        company: currentAnalysis.company,
        location: currentAnalysis.location || '',
        salary: currentAnalysis.salary || '',
        score: currentAnalysis.matchScore || 0,
        url: currentAnalysis.url
      }
    });
    btn.textContent = 'Applied';
    btn.className = 'jm-btn jm-btn-applied-done';
    setStatus('Marked as applied!', 'success');
    setTimeout(clearStatus, 2000);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    btn.disabled = false;
  }
}

export async function checkIfApplied() {
  const shadowRoot = getShadowRoot();
  try {
    const jobs = await sendMessage({ type: 'GET_APPLIED_JOBS' });
    if (jobs && jobs.some(j => j.url === window.location.href)) {
      const btn = shadowRoot.getElementById('jmMarkApplied');
      btn.textContent = 'Applied';
      btn.className = 'jm-btn jm-btn-applied-done';
      btn.style.display = 'flex';
    }
  } catch (e) { /* ignore */ }
}

/**
 * Checks if the current page URL is already saved and updates
 * the Save Job button to show "Saved" state if so.
 * @async
 */
export async function checkIfSaved() {
  const shadowRoot = getShadowRoot();
  try {
    const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
    const btn = shadowRoot.getElementById('jmSaveJob');
    if (!btn) return;
    if (jobs && jobs.some(j => j.url === window.location.href)) {
      btn.textContent = 'Saved';
      btn.disabled = true;
      btn.style.opacity = '0.7';
    } else {
      btn.textContent = 'Save Job';
      btn.disabled = false;
      btn.style.opacity = '1';
    }
  } catch (e) { /* ignore */ }
}
