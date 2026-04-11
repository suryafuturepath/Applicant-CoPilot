import { getShadowRoot, getCurrentAnalysis } from '../state.js';
import { sendMessage } from '../messaging.js';
import { setStatus, clearStatus } from '../panel/status.js';
import { extractJobDescription, extractJobTitle, extractCompany, extractLocation, extractSalary } from '../platform/jd-extractor.js';
import { detectProvider } from '../platform/detector.js';

// ─── Save job ─────────────────────────────────────────────────

/**
 * Saves the current job to the user's jobs list via background.js.
 * Stores the JD text for later reference.
 * @async
 */
export async function saveJob() {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  if (!currentAnalysis) return;
  try {
    // Extract JD text for storage (so user can review later)
    let jdText = '';
    try { jdText = await extractJobDescription(); } catch (_) {}

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
        jdText: jdText.substring(0, 5000), // cap at 5KB to manage storage
        provider: detectProvider(),
      }
    });
    const saveBtn = shadowRoot.getElementById('jmSaveJob');
    if (saveBtn) {
      saveBtn.textContent = 'Saved';
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.7';
    }
    setStatus('Job saved!', 'success');
    setTimeout(clearStatus, 2000);
  } catch (err) {
    setStatus('Error saving: ' + err.message, 'error');
  }
}

// ─── Mark as Applied ─────────────────────────────────────────

/**
 * Records the current job as applied. Stores JD text with the record.
 * If the job was already saved, updates its status instead of creating a duplicate.
 * @async
 * @param {Object} [opts] - Optional overrides for auto-detection.
 * @param {string} [opts.source] - 'manual' or 'auto-detected'
 */
export async function markApplied(opts = {}) {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  const btn = shadowRoot?.getElementById('jmMarkApplied');

  // Get job data from analysis or extract from page
  const title = currentAnalysis?.title || extractJobTitle();
  const company = currentAnalysis?.company || extractCompany();
  const url = currentAnalysis?.url || window.location.href;

  if (btn) btn.disabled = true;
  try {
    let jdText = '';
    try { jdText = await extractJobDescription(); } catch (_) {}

    await sendMessage({
      type: 'MARK_APPLIED',
      jobData: {
        title,
        company,
        location: currentAnalysis?.location || extractLocation(),
        salary: currentAnalysis?.salary || extractSalary(),
        score: currentAnalysis?.matchScore || 0,
        url,
        jdText: jdText.substring(0, 5000),
        source: opts.source || 'manual',
        provider: detectProvider(),
      }
    });
    if (btn) {
      btn.textContent = 'Applied';
      btn.className = 'jm-btn jm-btn-applied-done';
    }
    setStatus('Marked as applied!', 'success');
    setTimeout(clearStatus, 2000);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
    if (btn) btn.disabled = false;
  }
}

/**
 * Checks if the current URL exists in the jobs list and shows the appropriate status.
 * Handles both saved and applied states.
 * @async
 */
export async function checkIfApplied() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  try {
    const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
    const currentUrl = window.location.href;
    const job = jobs && jobs.find(j => j.url === currentUrl);
    if (!job) return;

    const btn = shadowRoot.getElementById('jmMarkApplied');
    if (job.status === 'applied' || job.status === 'interview' || job.status === 'offer') {
      if (btn) {
        btn.textContent = job.status === 'applied' ? 'Applied' : job.status.charAt(0).toUpperCase() + job.status.slice(1);
        btn.className = 'jm-btn jm-btn-applied-done';
        btn.style.display = 'flex';
      }
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
  if (!shadowRoot) return;
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
