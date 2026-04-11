import { getShadowRoot } from '../state.js';
import { sendMessage } from '../messaging.js';
import { escapeHTML } from '../utils.js';
import { scrollPanelTo } from '../panel/status.js';
import { activateInterviewPrep } from './interview-prep.js';

// ─── Status helpers ──────────────────────────────────────────

const STATUS_LABELS = {
  saved: 'Saved',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

function getStatusBadgeHTML(job) {
  const status = job.status || 'saved';
  const label = STATUS_LABELS[status] || status;
  let html = `<span class="jm-status-badge jm-status-${status}">${label}</span>`;
  if (job.source === 'auto-detected') {
    html += ` <span class="jm-status-auto">Auto-detected</span>`;
  }
  return html;
}

// ─── Saved Jobs tab ────────────────────────────────────────────

export function activateSavedTab() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  shadowRoot.querySelectorAll('.jm-bottom-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === 'saved');
  });
  const savedTab = shadowRoot.getElementById('jmSavedTab');
  const mainTab = shadowRoot.getElementById('jmMainTab');
  const askAiTab = shadowRoot.getElementById('jmAskAiTab');
  if (savedTab) savedTab.classList.add('active');
  if (mainTab) mainTab.classList.remove('active');
  if (askAiTab) askAiTab.classList.remove('active');
  loadSavedJobs();
}

export function deactivateSavedTab() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const savedTab = shadowRoot.getElementById('jmSavedTab');
  const mainTab = shadowRoot.getElementById('jmMainTab');
  const interviewTab = shadowRoot.getElementById('jmInterviewPrepTab');
  if (savedTab) savedTab.classList.remove('active');
  if (mainTab) mainTab.classList.add('active');
  if (interviewTab) interviewTab.classList.remove('active');
}

export async function loadSavedJobs() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const list = shadowRoot.getElementById('jmSavedList');
  const emptyMsg = shadowRoot.getElementById('jmSavedEmpty');
  if (!list) return;

  try {
    const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
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

      // Meta row (score + status + date)
      const meta = document.createElement('div');
      meta.className = 'jm-saved-meta';

      // Score badge
      if (job.score != null && job.score !== 0) {
        const score = document.createElement('span');
        score.className = 'jm-saved-score';
        score.textContent = job.score + '%';
        if (job.score >= 70) score.style.background = '#4f614d';
        else if (job.score >= 45) score.style.background = '#d97706';
        else score.style.background = '#dc2626';
        meta.appendChild(score);
      }

      // Status badge
      const statusEl = document.createElement('span');
      statusEl.innerHTML = getStatusBadgeHTML(job);
      meta.appendChild(statusEl);

      // Date
      if (job.date) {
        const date = document.createElement('span');
        date.textContent = job.statusDate ? (STATUS_LABELS[job.status] || 'Saved') + ' ' + job.statusDate : 'Saved ' + job.date;
        date.style.cssText = 'font-size:11px;color:var(--ac-text-muted);';
        meta.appendChild(date);
      }

      // Prep button (lightning icon)
      const prep = document.createElement('button');
      prep.className = 'jm-saved-prep';
      prep.innerHTML = '&#9889; Prep';
      prep.title = 'Interview Prep';
      prep.addEventListener('click', (e) => {
        e.stopPropagation();
        activateInterviewPrep(job.id, job.title, job.company, job.url);
      });

      // Delete button
      const del = document.createElement('button');
      del.className = 'jm-saved-delete';
      del.innerHTML = '&#10005;';
      del.title = 'Remove job';
      del.addEventListener('click', () => deleteSavedJob(job.id, card));

      card.appendChild(title);
      card.appendChild(company);
      card.appendChild(meta);
      card.appendChild(prep);
      card.appendChild(del);
      list.appendChild(card);
    });
  } catch (e) {
    // Silently fail
  }
}

async function deleteSavedJob(jobId, cardEl) {
  const shadowRoot = getShadowRoot();
  cardEl.remove();
  if (shadowRoot) {
    const list = shadowRoot.getElementById('jmSavedList');
    const emptyMsg = shadowRoot.getElementById('jmSavedEmpty');
    if (list && list.querySelectorAll('.jm-saved-card').length === 0 && emptyMsg) {
      emptyMsg.style.display = 'block';
    }
  }
  try {
    await sendMessage({ type: 'DELETE_JOB', jobId });
  } catch (e) {
    loadSavedJobs();
  }
}
