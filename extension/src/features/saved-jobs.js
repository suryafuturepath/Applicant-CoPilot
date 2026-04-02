import { getShadowRoot } from '../state.js';
import { sendMessage } from '../messaging.js';
import { escapeHTML } from '../utils.js';
import { scrollPanelTo } from '../panel/status.js';
import { activateInterviewPrep } from './interview-prep.js';

// ─── Saved Jobs tab ────────────────────────────────────────────

/**
 * Activates the Saved tab: highlights the nav button, shows the saved
 * tab content, hides the main tab content, and fetches saved jobs.
 */
export function activateSavedTab() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  // Highlight the Saved nav button
  shadowRoot.querySelectorAll('.jm-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === 'saved');
  });
  // Show saved tab, hide main tab
  const savedTab = shadowRoot.getElementById('jmSavedTab');
  const mainTab = shadowRoot.getElementById('jmMainTab');
  if (savedTab) savedTab.classList.add('active');
  if (mainTab) mainTab.classList.remove('active');
  // Fetch and render saved jobs each time the tab is activated
  loadSavedJobs();
}

/**
 * Deactivates the Saved tab: removes nav highlight, hides saved tab,
 * and restores the main tab content.
 */
export function deactivateSavedTab() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const savedTab = shadowRoot.getElementById('jmSavedTab');
  const mainTab = shadowRoot.getElementById('jmMainTab');
  if (savedTab) savedTab.classList.remove('active');
  if (mainTab) mainTab.classList.add('active');
}

/**
 * Fetches saved jobs from background.js and renders them in the Saved tab.
 * @async
 */
export async function loadSavedJobs() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const list = shadowRoot.getElementById('jmSavedList');
  const emptyMsg = shadowRoot.getElementById('jmSavedEmpty');
  if (!list) return;

  try {
    const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
    // Clear previous cards (keep the empty message element)
    list.querySelectorAll('.jm-saved-card').forEach(c => c.remove());

    if (!jobs || jobs.length === 0) {
      if (emptyMsg) emptyMsg.style.display = 'block';
      return;
    }

    if (emptyMsg) emptyMsg.style.display = 'none';

    jobs.forEach(job => {
      const card = document.createElement('div');
      card.className = 'jm-saved-card';
      card.dataset.jobId = job.id;

      // Title link
      const title = document.createElement('a');
      title.className = 'jm-saved-title';
      title.textContent = job.title || 'Unknown Position';
      title.href = job.url || '#';
      title.target = '_blank';
      title.rel = 'noopener';

      // Company
      const company = document.createElement('div');
      company.className = 'jm-saved-company';
      company.textContent = job.company || 'Unknown Company';

      // Meta row (score + date)
      const meta = document.createElement('div');
      meta.className = 'jm-saved-meta';

      if (job.score != null && job.score !== 0) {
        const score = document.createElement('span');
        score.className = 'jm-saved-score';
        score.textContent = job.score + '%';
        if (job.score >= 70) score.style.background = '#059669';
        else if (job.score >= 45) score.style.background = '#d97706';
        else score.style.background = '#dc2626';
        meta.appendChild(score);
      }

      if (job.date) {
        const date = document.createElement('span');
        date.textContent = 'Saved ' + job.date;
        meta.appendChild(date);
      }

      // Applied toggle
      const appliedBtn = document.createElement('button');
      appliedBtn.className = 'jm-saved-applied-btn' + (job.applied ? ' applied' : '');
      appliedBtn.textContent = job.applied ? 'Applied' : 'Mark Applied';
      appliedBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const result = await sendMessage({ type: 'TOGGLE_JOB_APPLIED', jobId: job.id });
          appliedBtn.classList.toggle('applied', result.applied);
          appliedBtn.textContent = result.applied ? 'Applied' : 'Mark Applied';
          card.classList.toggle('is-applied', result.applied);
        } catch (_) {}
      });
      meta.appendChild(appliedBtn);

      if (job.applied) card.classList.add('is-applied');

      // Prep button
      const prep = document.createElement('button');
      prep.className = 'jm-saved-prep';
      prep.textContent = 'Prep';
      prep.title = 'Interview Prep';
      prep.addEventListener('click', (e) => {
        e.stopPropagation();
        activateInterviewPrep(job.id, job.title, job.company, job.url);
      });

      // Delete button
      const del = document.createElement('button');
      del.className = 'jm-saved-delete';
      del.innerHTML = '&#10005;';
      del.title = 'Remove saved job';
      del.addEventListener('click', () => deleteSavedJob(job.id, card));

      card.appendChild(title);
      card.appendChild(company);
      card.appendChild(meta);
      card.appendChild(prep);
      card.appendChild(del);
      list.appendChild(card);
    });
  } catch (e) {
    // Silently fail — user can retry by switching tabs
  }
}

/**
 * Deletes a saved job by ID (optimistic UI removal).
 * @async
 * @param {string} jobId - The saved job's ID.
 * @param {HTMLElement} cardEl - The card DOM element to remove.
 */
async function deleteSavedJob(jobId, cardEl) {
  const shadowRoot = getShadowRoot();
  // Optimistic removal from DOM
  cardEl.remove();

  // Show empty state if no cards remain
  if (shadowRoot) {
    const list = shadowRoot.getElementById('jmSavedList');
    const emptyMsg = shadowRoot.getElementById('jmSavedEmpty');
    if (list && list.querySelectorAll('.jm-saved-card').length === 0 && emptyMsg) {
      emptyMsg.style.display = 'block';
    }
  }

  try {
    await sendMessage({ type: 'DELETE_JOB', jobId: jobId });
  } catch (e) {
    // If delete fails, reload the list to restore correct state
    loadSavedJobs();
  }
}
