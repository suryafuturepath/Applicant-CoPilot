/**
 * @file profile.js
 * @description Manages the full-page Profile tab for the Applicant Copilot Chrome extension.
 *
 * Responsibilities:
 *   - Resume upload and text extraction (PDF via pdf.js, DOCX via mammoth)
 *   - AI-powered resume parsing via the background service worker (PARSE_RESUME)
 *   - Editable profile form: contact info, skills, certifications, experience,
 *     education, and projects — all kept in sync with the in-memory `profileData` object
 *   - Multi-slot resume management: up to 3 named resume profiles that can be
 *     switched, renamed, and persisted independently in chrome.storage.local
 *   - Q&A list: a set of pre-filled answers to common job-application questions,
 *     backed by DEFAULT_QA_QUESTIONS; supports category filtering and migration of
 *     stored entries to keep type/options in sync with the current defaults
 *   - AI provider settings: provider dropdown, model selection, API key, temperature
 *   - Applied jobs tracker: loads the saved application log and renders a sortable table
 *   - Stats dashboard: computes aggregate match-score stats and top missing skills
 *     directly from the ac_analysisCache entry in chrome.storage.local
 *   - Hash-based navigation so external pages can deep-link to a specific tab
 *     (e.g. profile.html#settings)
 */

// ─── State variables ─────────────────────────────────────────────────────────

/**
 * In-memory representation of the currently active resume profile.
 * Populated from chrome.storage via GET_PROFILE on init, updated by the form,
 * and flushed to the active slot on every save.
 * @type {{
 *   name: string, email: string, phone: string, location: string,
 *   linkedin: string, website: string, summary: string,
 *   skills: string[], experience: Object[], education: Object[],
 *   certifications: string[], projects: Object[],
 *   resumeFileName?: string
 * }}
 */
let profileData = {
  name: '', email: '', phone: '', location: '',
  linkedin: '', website: '', summary: '',
  skills: [], experience: [], education: [],
  certifications: [], projects: []
};

/**
 * Tracks whether the profile form has unsaved changes.
 * Set to true on any form edit; reset to false after a successful save.
 * @type {boolean}
 */
let profileDirty = false;

/**
 * Marks the profile as dirty and highlights the save button to indicate
 * unsaved changes.
 */
function markProfileDirty() {
  profileDirty = true;
  const btn = document.getElementById('saveProfileBtn');
  if (btn) btn.style.background = '#f59e0b';
}

/**
 * Marks the profile as clean and reverts the save button to its default style.
 */
function markProfileClean() {
  profileDirty = false;
  const btn = document.getElementById('saveProfileBtn');
  if (btn) btn.style.background = '';
}

// Warn the user when navigating away with unsaved profile changes
window.addEventListener('beforeunload', (e) => {
  if (profileDirty) { e.preventDefault(); }
});

/**
 * Legacy Q&A list — kept only for one-time migration to applicantContext.
 * @type {Array<{question: string, answer: string, category: string, type: string, options?: string[]}>}
 */
let qaList = [];

/**
 * Registry of available AI providers fetched from the background on init.
 * Keyed by provider ID (e.g. 'anthropic', 'openai').  Used to populate the
 * provider dropdown and drive per-provider model lists / key placeholders.
 * @type {Object.<string, {name: string, models: Object[], defaultModel: string, keyPlaceholder: string, hint: string, free?: boolean}>}
 */
let providerData = {};

// ─── Helper utilities ─────────────────────────────────────────────────────────

/**
 * Wraps chrome.runtime.sendMessage in a Promise so callers can use async/await.
 * Rejects on runtime errors, missing responses, or when the background signals
 * `success: false`.
 *
 * @param {Object} msg - Message object with at minimum a `type` string field.
 * @returns {Promise<*>} Resolves with `resp.data` from the background handler.
 */
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      // chrome.runtime.lastError is set when the message could not be delivered
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      // A null/undefined response means the background script did not reply at all
      if (!resp) return reject(new Error('No response from background'));
      // The background signals logical failure via resp.success === false
      if (!resp.success) return reject(new Error(resp.error));
      resolve(resp.data);
    });
  });
}

/**
 * Briefly displays a toast notification at the bottom of the page.
 * The 'show' class triggers a CSS transition; it is removed after 2.5 s.
 *
 * @param {string} msg - Human-readable message to display.
 */
function showToast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type ? ' toast-' + type : '');
  setTimeout(() => el.classList.remove('show'), 2500);
}

/**
 * Updates the status text below the upload zone with a semantic type class
 * ('loading' | 'success' | 'error') so CSS can colour it appropriately.
 *
 * @param {string} text - Status message.
 * @param {string} type - One of 'loading', 'success', or 'error'.
 */
function setUploadStatus(text, type) {
  const el = document.getElementById('uploadStatus');
  el.textContent = text;
  // Replace all existing type classes with the new one
  el.className = 'upload-status ' + type;
}

/**
 * Resets the upload zone back to its default "Upload New" state.
 * Called after renderResumeCards to ensure the zone never gets stuck
 * showing a "loaded" confirmation.
 */
function resetUploadZone() {
  const zone = document.getElementById('uploadZone');
  if (!zone) return;
  zone.innerHTML = `
    <span class="upload-zone-icon material-symbols-outlined">upload</span>
    <span class="upload-zone-text">Upload New</span>
    <span class="upload-zone-hint">PDF or DOCX</span>
  `;
}

/**
 * Opens a modal to preview the raw text of a stored resume.
 * @param {number} idx - Index into the resumes array in storage.
 */
async function previewResume(idx) {
  const result = await chrome.storage.local.get('resumes');
  const resumes = result.resumes || [];
  const resume = resumes[idx];
  if (!resume || !resume.text) {
    showToast('No preview available for this resume.', 'error');
    return;
  }

  // Create or reuse the preview modal
  let modal = document.getElementById('resumePreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'resumePreviewModal';
    modal.className = 'resume-preview-modal';
    modal.innerHTML = `
      <div class="resume-preview-backdrop"></div>
      <div class="resume-preview-content">
        <div class="resume-preview-header">
          <h3 class="resume-preview-title"></h3>
          <button class="resume-preview-close" title="Close">&times;</button>
        </div>
        <pre class="resume-preview-text"></pre>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('.resume-preview-backdrop').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.querySelector('.resume-preview-close').addEventListener('click', () => { modal.style.display = 'none'; });
  }

  modal.querySelector('.resume-preview-title').textContent = resume.fileName || 'Resume Preview';
  modal.querySelector('.resume-preview-text').textContent = resume.text;
  modal.style.display = 'flex';
}

// ─── Tab switching ────────────────────────────────────────────────────────────

/**
 * Attach click listeners to every `.tab` button.
 * Activating a tab deactivates all others and shows the matching `.tab-content`
 * panel.  Lazy-loads data for the 'applied' and 'stats' tabs on first reveal.
 */
const _headerTitle = document.querySelector('.top-header-title');
const _floatingSaveBar = document.getElementById('floatingSaveBar');

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'applied') loadAppliedJobs();
    // Show Save Profile bar only on User Context tab
    if (_floatingSaveBar) {
      _floatingSaveBar.style.display = tab.dataset.tab === 'profile' ? '' : 'none';
    }
    // Update the top header to reflect the active section.
    // Extract the text node after the icon span (tab has: <span.icon> + text node).
    if (_headerTitle) {
      const textNode = Array.from(tab.childNodes).find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
      _headerTitle.textContent = textNode ? textNode.textContent.trim() : tab.textContent.trim();
    }
  });
});

// ─── Resume upload ────────────────────────────────────────────────────────────

/** DOM references kept at module scope so multiple listeners can share them. */
const fileInput = document.getElementById('fileInput');

// Delegate drag/drop/click to the stable container element so that events
// survive renderResumeCards() replacing the inner uploadZone HTML.
const resumeCardsCont = document.getElementById('resumeCardsContainer');

resumeCardsCont.addEventListener('click', (e) => {
  if (e.target.closest('#uploadZone')) fileInput.click();
});

resumeCardsCont.addEventListener('dragover', (e) => {
  const zone = e.target.closest('#uploadZone');
  if (!zone) return;
  e.preventDefault();
  zone.classList.add('drag-over');
});

resumeCardsCont.addEventListener('dragleave', (e) => {
  const zone = e.target.closest('#uploadZone');
  if (zone) zone.classList.remove('drag-over');
});

resumeCardsCont.addEventListener('drop', (e) => {
  const zone = e.target.closest('#uploadZone');
  if (!zone) return;
  e.preventDefault();
  zone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});

// Standard <input type="file"> change event — also feeds into handleFile
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

/**
 * Validates, extracts text from, and AI-parses an uploaded resume file.
 * Supports PDF (via pdf.js) and DOCX (via mammoth).
 * On success: merges parsed fields into `profileData`, repopulates the form,
 * and updates the upload zone to reflect the loaded file.
 *
 * @param {File} file - The File object supplied by the input or drop event.
 */
async function handleFile(file) {
  // Derive the file extension to decide which extractor to use
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf', 'docx'].includes(ext)) {
    setUploadStatus('Please upload a PDF or DOCX file.', 'error');
    return;
  }

  setUploadStatus('Extracting text from ' + file.name + '...', 'loading');

  try {
    let rawText;
    if (ext === 'pdf') {
      rawText = await extractPDF(file);
    } else {
      rawText = await extractDOCX(file);
    }

    // A very short extraction usually means a scanned image PDF with no text layer
    if (!rawText || rawText.trim().length < 20) {
      setUploadStatus('Could not extract enough text from file.', 'error');
      return;
    }

    // Check if we already parsed this exact file (same name + similar length)
    const stored = await chrome.storage.local.get('resumes');
    const existingResumes = stored.resumes || [];
    const alreadyParsed = existingResumes.find(
      r => r.fileName === file.name && r.text && Math.abs(r.text.length - rawText.substring(0, 50000).length) < 100
    );

    let parsed;
    if (alreadyParsed && alreadyParsed.parsedData) {
      // Reuse cached parse result — no AI call needed
      parsed = alreadyParsed.parsedData;
      setUploadStatus('Resume loaded from cache (already parsed).', 'success');
    } else {
      setUploadStatus('Parsing resume with AI... This may take a moment.', 'loading');
      // Hand off raw text to the background script which calls the configured AI provider
      parsed = await sendMessage({ type: 'PARSE_RESUME', rawText });
    }

    // Merge parsed fields into existing profileData while preserving any extra keys
    // (e.g. resumeFileName from a previous save) and stamp the new file name
    profileData = { ...profileData, ...parsed, resumeFileName: file.name };
    populateProfileForm();
    if (!alreadyParsed || !alreadyParsed.parsedData) {
      setUploadStatus('Resume parsed successfully! Review and edit below.', 'success');
    }

    // Add to resumes array (new card system, max 10)
    const resumes = existingResumes;
    const isFirst = resumes.length === 0;
    // Only add if this file isn't already in the list
    const alreadyInList = resumes.findIndex(r => r.fileName === file.name && Math.abs((r.text || '').length - rawText.substring(0, 50000).length) < 100);
    if (alreadyInList >= 0) {
      // Update the existing entry with parsed data cache
      resumes[alreadyInList].parsedData = parsed;
    } else {
      if (resumes.length >= 10) {
        const removeIdx = resumes.findIndex(r => !r.isPrimary);
        if (removeIdx >= 0) resumes.splice(removeIdx, 1);
      }
      resumes.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        fileName: file.name,
        text: rawText.substring(0, 50000),
        uploadDate: new Date().toISOString(),
        isPrimary: isFirst,
        parsedData: parsed
      });
    }
    await chrome.storage.local.set({ resumes });
    renderResumeCards();

    // Auto-save profile so parsed data persists without manual Save click
    try {
      await sendMessage({ type: 'SAVE_PROFILE', profile: profileData });
      markProfileClean();
      showToast('Profile saved automatically after parsing.', 'success');
    } catch (_) {
      // Manual save still available via button
    }

    // Also prefill intake context from the newly parsed resume
    prefillFromProfile(profileData);
    renderIntakeFlow();
  } catch (err) {
    setUploadStatus('Error: ' + err.message, 'error');
  }
}

/**
 * Extracts plain text from a PDF file using pdf.js.
 * Iterates through every page and concatenates the text items, separated by
 * newlines between pages.
 *
 * @param {File} file - A File object whose content is a valid PDF.
 * @returns {Promise<string>} Concatenated text from all pages.
 */
async function extractPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Point pdf.js at the bundled worker script shipped with the extension
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  // pdf.js pages are 1-indexed
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Each item in the content stream has a `str` property; join with spaces
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

/**
 * Extracts plain text from a DOCX file using the mammoth library.
 *
 * @param {File} file - A File object whose content is a valid DOCX.
 * @returns {Promise<string>} Extracted raw text.
 */
async function extractDOCX(file) {
  const arrayBuffer = await file.arrayBuffer();
  // mammoth.extractRawText strips all formatting and returns plain text
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

// ─── Profile form population ──────────────────────────────────────────────────

/**
 * Writes all fields from the in-memory `profileData` object into the HTML form.
 * Also triggers re-renders of all list sections (skills, certs, experience,
 * education, projects).
 */
function populateProfileForm() {
  document.getElementById('pName').value     = profileData.name     || '';
  document.getElementById('pEmail').value    = profileData.email    || '';
  document.getElementById('pPhone').value    = profileData.phone    || '';
  document.getElementById('pLocation').value = profileData.location || '';
  document.getElementById('pLinkedin').value = profileData.linkedin || '';
  document.getElementById('pWebsite').value  = profileData.website  || '';
  document.getElementById('pSummary').value  = profileData.summary  || '';

  renderSkills();
  renderCerts();
  renderExperience();
  renderEducation();
  renderProjects();
}

// ─── Dirty tracking for personal info fields ─────────────────────────────────
['pName', 'pEmail', 'pPhone', 'pLocation', 'pLinkedin', 'pWebsite', 'pSummary'].forEach(id => {
  document.getElementById(id).addEventListener('input', markProfileDirty);
});

// ─── Skills ───────────────────────────────────────────────────────────────────

/**
 * Clears and re-renders the skills tag list from `profileData.skills`.
 * Each tag contains an inline remove button whose click handler splices the
 * corresponding index from the array and triggers a re-render.
 */
function renderSkills() {
  const container = document.getElementById('skillsContainer');
  container.innerHTML = '';
  (profileData.skills || []).forEach((skill, i) => {
    const tag = document.createElement('span');
    tag.className = 'skill-tag';
    // Embed the array index in a data attribute so the remove handler knows what to splice
    tag.innerHTML = `${escapeHTML(skill)} <span class="remove" data-idx="${i}">&times;</span>`;
    container.appendChild(tag);
  });
  // Wire remove buttons after all tags exist in the DOM
  container.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      profileData.skills.splice(parseInt(btn.dataset.idx), 1);
      renderSkills();
      markProfileDirty();
    });
  });
}

/**
 * Reads the skill input field, deduplicates against the existing list,
 * pushes a new entry, and re-renders the tag list.
 */
function addSkill() {
  const input = document.getElementById('skillInput');
  const val   = input.value.trim();
  if (!val) return;
  // Guard against undefined array in case profileData was freshly created
  if (!profileData.skills) profileData.skills = [];
  if (!profileData.skills.includes(val)) {
    profileData.skills.push(val);
    renderSkills();
    markProfileDirty();
  }
  input.value = '';
}

document.getElementById('addSkillBtn').addEventListener('click', addSkill);
// Allow Enter key in the skill input to trigger the same add action
document.getElementById('skillInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
});

// ─── Certifications ───────────────────────────────────────────────────────────

/**
 * Clears and re-renders the certifications tag list from `profileData.certifications`.
 * Follows the same pattern as renderSkills: tags with inline remove buttons.
 */
function renderCerts() {
  const container = document.getElementById('certsContainer');
  container.innerHTML = '';
  (profileData.certifications || []).forEach((cert, i) => {
    const tag = document.createElement('span');
    tag.className = 'skill-tag';
    tag.innerHTML = `${escapeHTML(cert)} <span class="remove" data-idx="${i}">&times;</span>`;
    container.appendChild(tag);
  });
  container.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      profileData.certifications.splice(parseInt(btn.dataset.idx), 1);
      renderCerts();
      markProfileDirty();
    });
  });
}

/**
 * Reads the certification input, deduplicates, and appends to the list.
 */
function addCert() {
  const input = document.getElementById('certInput');
  const val   = input.value.trim();
  if (!val) return;
  if (!profileData.certifications) profileData.certifications = [];
  if (!profileData.certifications.includes(val)) {
    profileData.certifications.push(val);
    renderCerts();
    markProfileDirty();
  }
  input.value = '';
}

document.getElementById('addCertBtn').addEventListener('click', addCert);
document.getElementById('certInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addCert(); }
});

// ─── Experience ───────────────────────────────────────────────────────────────

/**
 * Clears and re-renders all experience entries from `profileData.experience`.
 */
function renderExperience() {
  const list = document.getElementById('experienceList');
  list.innerHTML = '';
  (profileData.experience || []).forEach((exp, i) => {
    list.appendChild(createExperienceEntry(exp, i));
  });
}

/**
 * Creates a single editable experience card as a DOM element.
 * Input/textarea changes are immediately mirrored back to `profileData.experience[idx]`
 * via the `data-field` attribute, so no additional "collect form" step is needed on save.
 *
 * @param {Object} exp - Experience object: { title, company, dates, description }.
 * @param {number} idx - Array index within profileData.experience (used for removal and live sync).
 * @returns {HTMLDivElement} The fully wired card element.
 */
function createExperienceEntry(exp, idx) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = `
    <div class="entry-header">
      <h4>Experience #${idx + 1}</h4>
      <button class="btn btn-danger btn-sm remove-entry" data-idx="${idx}">Remove</button>
    </div>
    <div class="form-row">
      <div><label>Job Title</label><input type="text" data-field="title" value="${escapeAttr(exp.title || '')}"></div>
      <div><label>Company</label><input type="text" data-field="company" value="${escapeAttr(exp.company || '')}"></div>
    </div>
    <label>Dates</label><input type="text" data-field="dates" value="${escapeAttr(exp.dates || '')}">
    <label>Description</label><textarea data-field="description" rows="3">${escapeHTML(exp.description || '')}</textarea>
  `;
  // Remove button: splice this entry and re-render the entire list (indices shift)
  div.querySelector('.remove-entry').addEventListener('click', () => {
    profileData.experience.splice(idx, 1);
    renderExperience();
    markProfileDirty();
  });
  // Sync edits back to state — each field uses data-field to identify which key to update
  div.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', () => {
      profileData.experience[idx][input.dataset.field] = input.value;
      markProfileDirty();
    });
  });
  return div;
}

// Add a blank experience entry when the user clicks the button
document.getElementById('addExpBtn').addEventListener('click', () => {
  if (!profileData.experience) profileData.experience = [];
  profileData.experience.push({ title: '', company: '', dates: '', description: '' });
  renderExperience();
  markProfileDirty();
});

// ─── Education ────────────────────────────────────────────────────────────────

/**
 * Clears and re-renders all education entries from `profileData.education`.
 */
function renderEducation() {
  const list = document.getElementById('educationList');
  list.innerHTML = '';
  (profileData.education || []).forEach((edu, i) => {
    list.appendChild(createEducationEntry(edu, i));
  });
}

/**
 * Creates a single editable education card.
 * Live-syncs changes back to `profileData.education[idx]` via data-field attributes.
 *
 * @param {Object} edu - Education object: { degree, school, dates, details }.
 * @param {number} idx - Array index within profileData.education.
 * @returns {HTMLDivElement} Fully wired card element.
 */
function createEducationEntry(edu, idx) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = `
    <div class="entry-header">
      <h4>Education #${idx + 1}</h4>
      <button class="btn btn-danger btn-sm remove-entry" data-idx="${idx}">Remove</button>
    </div>
    <div class="form-row">
      <div><label>Degree</label><input type="text" data-field="degree" value="${escapeAttr(edu.degree || '')}"></div>
      <div><label>School</label><input type="text" data-field="school" value="${escapeAttr(edu.school || '')}"></div>
    </div>
    <label>Dates</label><input type="text" data-field="dates" value="${escapeAttr(edu.dates || '')}">
    <label>Details</label><textarea data-field="details" rows="2">${escapeHTML(edu.details || '')}</textarea>
  `;
  div.querySelector('.remove-entry').addEventListener('click', () => {
    profileData.education.splice(idx, 1);
    renderEducation();
    markProfileDirty();
  });
  div.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', () => {
      profileData.education[idx][input.dataset.field] = input.value;
      markProfileDirty();
    });
  });
  return div;
}

document.getElementById('addEduBtn').addEventListener('click', () => {
  if (!profileData.education) profileData.education = [];
  profileData.education.push({ degree: '', school: '', dates: '', details: '' });
  renderEducation();
  markProfileDirty();
});

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Clears and re-renders all project entries from `profileData.projects`.
 */
function renderProjects() {
  const list = document.getElementById('projectsList');
  list.innerHTML = '';
  (profileData.projects || []).forEach((proj, i) => {
    list.appendChild(createProjectEntry(proj, i));
  });
}

/**
 * Creates a single editable project card.
 * The 'technologies' field is stored as an array but displayed as a
 * comma-separated string; the input handler splits it back on save.
 *
 * @param {Object} proj - Project object: { name, description, technologies: string[] }.
 * @param {number} idx  - Array index within profileData.projects.
 * @returns {HTMLDivElement} Fully wired card element.
 */
function createProjectEntry(proj, idx) {
  const div = document.createElement('div');
  div.className = 'entry';
  div.innerHTML = `
    <div class="entry-header">
      <h4>Project #${idx + 1}</h4>
      <button class="btn btn-danger btn-sm remove-entry" data-idx="${idx}">Remove</button>
    </div>
    <label>Project Name</label>
    <input type="text" data-field="name" value="${escapeAttr(proj.name || '')}">
    <label>Description</label>
    <textarea data-field="description" rows="2">${escapeHTML(proj.description || '')}</textarea>
    <label>Technologies (comma-separated)</label>
    <input type="text" data-field="technologies" value="${escapeAttr((proj.technologies || []).join(', '))}">
  `;
  div.querySelector('.remove-entry').addEventListener('click', () => {
    profileData.projects.splice(idx, 1);
    renderProjects();
    markProfileDirty();
  });
  div.querySelectorAll('input, textarea').forEach(input => {
    input.addEventListener('input', () => {
      const field = input.dataset.field;
      if (field === 'technologies') {
        // Convert the comma-separated display string back to an array, stripping blanks
        profileData.projects[idx][field] = input.value.split(',').map(s => s.trim()).filter(Boolean);
      } else {
        profileData.projects[idx][field] = input.value;
      }
      markProfileDirty();
    });
  });
  return div;
}

document.getElementById('addProjBtn').addEventListener('click', () => {
  if (!profileData.projects) profileData.projects = [];
  profileData.projects.push({ name: '', description: '', technologies: [] });
  renderProjects();
  markProfileDirty();
});

// ─── Save profile ─────────────────────────────────────────────────────────────

/**
 * Save-profile button handler.
 * 1. Reads the plain-text fields from the form into `profileData` (list fields
 *    are already kept in sync by their individual input listeners).
 * 2. Persists via the background (SAVE_PROFILE message).
 * 3. Deep-copies the updated profile into the active slot and writes
 *    profileSlots back to chrome.storage.local so slot state stays consistent.
 */
document.getElementById('saveProfileBtn').addEventListener('click', async () => {
  // Sync the plain text fields that are not live-updated by sub-component listeners
  profileData.name     = document.getElementById('pName').value.trim();
  profileData.email    = document.getElementById('pEmail').value.trim();
  profileData.phone    = document.getElementById('pPhone').value.trim();
  profileData.location = document.getElementById('pLocation').value.trim();
  profileData.linkedin = document.getElementById('pLinkedin').value.trim();
  profileData.website  = document.getElementById('pWebsite').value.trim();
  profileData.summary  = document.getElementById('pSummary').value.trim();

  // ── Basic validation (only if fields are filled in) ──
  if (profileData.email && (!/[@]/.test(profileData.email) || !/[.]/.test(profileData.email))) {
    showToast('Please enter a valid email address', 'error');
    return;
  }
  if (profileData.phone && (profileData.phone.replace(/\D/g, '').length < 10)) {
    showToast('Please enter a valid phone number', 'error');
    return;
  }

  try {
    await sendMessage({ type: 'SAVE_PROFILE', profile: profileData });
    // Deep-copy into the active slot so the slot array always reflects the latest save
    profileSlots[activeSlot] = JSON.parse(JSON.stringify(profileData));
    await chrome.storage.local.set({ profileSlots });
    updateSlotButtons();
    markProfileClean();
    showToast('Profile saved!', 'success');
  } catch (err) {
    showToast('Error saving: ' + err.message, 'error');
  }
});

// ─── Intake Flow Engine ─────────────────────────────────────────────────────
// Replaces the old static Q&A with a guided conversational intake flow.
// Produces a rich applicantContext that powers all downstream AI features.

const MAX_TEXT_DUMPS = 5;
const MAX_TEXT_DUMP_CHARS = 20000;

/**
 * All intake sections with their questions.
 * Each question: { id, text, type, hint?, options?, required? }
 */
const INTAKE_SECTIONS = [
  {
    id: 'career-goals',
    title: 'Career Goals',
    description: 'Help us understand what you\'re looking for so we can tailor your applications.',
    icon: '<span class="material-symbols-outlined">star</span>',
    required: true,
    questions: [
      { id: 'target_roles', text: 'What kind of roles are you targeting?', type: 'textarea', hint: 'e.g., Product Manager, Software Engineer, Data Scientist', required: true },
      { id: 'ideal_role', text: 'What\'s your ideal next role?', type: 'textarea', hint: 'Describe the role, team size, and impact you want to make' },
      { id: 'target_industries', text: 'What industries interest you?', type: 'text', hint: 'e.g., fintech, healthcare, AI/ML, e-commerce' },
      { id: 'search_stage', text: 'Where are you in your job search?', type: 'select', options: ['', 'Just exploring', 'Just started applying', 'Actively applying', 'Being selective / have offers'] },
      { id: 'career_motivations', text: 'What motivates you in your career?', type: 'textarea', hint: 'What drives you? Impact, growth, compensation, mission, etc.' },
    ]
  },
  {
    id: 'professional-summary',
    title: 'Professional Summary',
    description: 'A quick snapshot of who you are professionally.',
    icon: '<span class="material-symbols-outlined">work</span>',
    required: true,
    questions: [
      { id: 'elevator_pitch', text: 'Give me a 2-3 sentence elevator pitch about yourself.', type: 'textarea', hint: 'How would you introduce yourself at a networking event?', required: true },
      { id: 'top_skills', text: 'What are your top 3-5 skills?', type: 'text', hint: 'e.g., Python, product strategy, stakeholder management' },
      { id: 'years_experience', text: 'How many years of professional experience do you have?', type: 'text', hint: 'e.g., 5 years, 10+ years' },
      { id: 'unique_value', text: 'What makes you stand out from other candidates?', type: 'textarea', hint: 'Your unique combination of skills, experiences, or perspective' },
    ]
  },
  {
    id: 'experience-highlights',
    title: 'Experience Highlights',
    description: 'Tell us about your most impactful work.',
    icon: '<span class="material-symbols-outlined">rocket_launch</span>',
    required: true,
    questions: [
      { id: 'recent_role', text: 'Tell me about your most recent role — what did you do, and what was the impact?', type: 'textarea', required: true },
      { id: 'proudest_achievement', text: 'What\'s your proudest professional achievement?', type: 'textarea', hint: 'Include specific metrics or outcomes if possible' },
      { id: 'daily_tools', text: 'What technical tools, frameworks, or methodologies do you use daily?', type: 'textarea', hint: 'e.g., React, Python, Agile/Scrum, Figma, SQL' },
      { id: 'leadership_example', text: 'Describe a time you led a project or mentored someone.', type: 'textarea', hint: 'Optional — skip if not applicable' },
    ]
  },
  {
    id: 'education',
    title: 'Education',
    description: 'Your academic background and certifications.',
    icon: '<span class="material-symbols-outlined">school</span>',
    required: true,
    questions: [
      { id: 'highest_education', text: 'What\'s your highest level of education?', type: 'select', options: ['', 'High School Diploma / GED', 'Some College (no degree)', "Associate's Degree", "Bachelor's Degree (BA/BS)", "Master's Degree (MA/MS/MBA)", 'Doctorate (PhD/EdD)', 'Professional Degree (JD/MD/DDS)'], required: true },
      { id: 'field_of_study', text: 'What did you study?', type: 'text', hint: 'e.g., Computer Science, Business Administration, Economics' },
      { id: 'school_name', text: 'Where did you study?', type: 'text', hint: 'University or institution name' },
      { id: 'certifications', text: 'Any relevant certifications or licenses?', type: 'textarea', hint: 'e.g., PMP, AWS Solutions Architect, CPA' },
    ]
  },
  {
    id: 'work-preferences',
    title: 'Work Preferences',
    description: 'Salary, location, authorization — the practical details applications ask about.',
    icon: '<span class="material-symbols-outlined">settings</span>',
    required: false,
    questions: [
      { id: 'desired_salary', text: 'Desired annual salary (USD)', type: 'text', hint: 'e.g., $120,000 or $100k-130k' },
      { id: 'hourly_rate', text: 'Desired hourly rate (if applicable)', type: 'text' },
      { id: 'work_arrangement', text: 'Preferred work arrangement', type: 'select', options: ['', 'On-site', 'Hybrid', 'Remote', 'Flexible / Any'] },
      { id: 'location_preference', text: 'Location preferences', type: 'text', hint: 'e.g., San Francisco Bay Area, open to anywhere remote' },
      { id: 'work_auth', text: 'Are you legally authorized to work in the United States?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'sponsorship', text: 'Will you require visa sponsorship (e.g., H-1B)?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'auth_status', text: 'Work authorization status', type: 'select', options: ['', 'U.S. Citizen', 'Green Card Holder', 'H-1B Visa', 'EAD / OPT', 'TN Visa', 'L-1 Visa', 'Other'] },
      { id: 'start_date', text: 'Earliest available start date', type: 'text', hint: 'e.g., Immediately, 2 weeks, March 2026' },
      { id: 'notice_period', text: 'Notice period for current employer', type: 'select', options: ['', 'Immediately available', '1 week', '2 weeks', '3 weeks', '1 month', 'More than 1 month'] },
      { id: 'employment_type', text: 'Desired employment type', type: 'select', options: ['', 'Full-time', 'Part-time', 'Contract', 'Internship', 'Any'] },
      { id: 'willing_relocate', text: 'Willing to relocate?', type: 'select', options: ['', 'Yes', 'No', 'Open to discussion'] },
      { id: 'travel_willingness', text: 'Willingness to travel', type: 'select', options: ['', 'No travel', 'Up to 25%', 'Up to 50%', 'Up to 75%', '100% / Full-time travel'] },
      { id: 'background_check', text: 'Willing to undergo a background check?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'drug_test', text: 'Willing to undergo a drug test?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'drivers_license', text: 'Do you have a valid driver\'s license?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'security_clearance', text: 'Security clearance', type: 'select', options: ['', 'None', 'Confidential', 'Secret', 'Top Secret', 'TS/SCI', 'Eligible but do not currently hold'] },
    ]
  },
  {
    id: 'personal-details',
    title: 'Personal Details',
    description: 'Basic contact info and optional demographics that applications commonly ask for.',
    icon: '<span class="material-symbols-outlined">person</span>',
    required: false,
    questions: [
      { id: 'first_name', text: 'First Name', type: 'text' },
      { id: 'last_name', text: 'Last Name', type: 'text' },
      { id: 'email', text: 'Email Address', type: 'text' },
      { id: 'phone', text: 'Phone Number', type: 'text' },
      { id: 'street_address', text: 'Street Address', type: 'text' },
      { id: 'address_line_2', text: 'Address Line 2 (Apt, Suite, Unit)', type: 'text' },
      { id: 'city', text: 'City', type: 'text' },
      { id: 'state', text: 'State / Province', type: 'text', hint: 'e.g., CA, NY, TX' },
      { id: 'zip_code', text: 'ZIP / Postal Code', type: 'text' },
      { id: 'country', text: 'Country', type: 'select', options: ['', 'United States', 'Canada', 'United Kingdom', 'India', 'Australia', 'Germany', 'France', 'Mexico', 'Brazil', 'Other'] },
      { id: 'linkedin_url', text: 'LinkedIn Profile URL', type: 'text' },
      { id: 'portfolio_url', text: 'Portfolio / Website URL', type: 'text' },
      { id: 'github_url', text: 'GitHub Profile URL', type: 'text' },
      { id: 'current_title', text: 'Current Job Title', type: 'text' },
      { id: 'current_employer', text: 'Current Employer / Company', type: 'text' },
      { id: 'gender', text: 'Gender', type: 'select', options: ['', 'Male', 'Female', 'Non-binary', 'Other', 'Prefer not to say'] },
      { id: 'gender_identity', text: 'Gender identity', type: 'select', options: ['', 'Man', 'Woman', 'Non-binary', 'Genderqueer / Genderfluid', 'Agender', 'Two-Spirit', 'Other', 'Prefer not to say'] },
      { id: 'sexual_orientation', text: 'Sexual orientation', type: 'select', options: ['', 'Straight / Heterosexual', 'Gay or Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer', 'Other', 'Prefer not to say'] },
      { id: 'pronouns', text: 'Pronouns', type: 'select', options: ['', 'He/Him', 'She/Her', 'They/Them', 'He/They', 'She/They', 'Other', 'Prefer not to say'] },
      { id: 'race_ethnicity', text: 'Race / Ethnicity', type: 'select', options: ['', 'American Indian or Alaska Native', 'Asian', 'Black or African American', 'Hispanic or Latino', 'Native Hawaiian or Pacific Islander', 'White', 'Two or more races', 'Other', 'Prefer not to say'] },
      { id: 'hispanic_latino', text: 'Are you Hispanic or Latino?', type: 'select', options: ['', 'Yes', 'No', 'Decline to self-identify'] },
      { id: 'veteran_status', text: 'Veteran status', type: 'select', options: ['', 'I am not a protected veteran', 'I identify as one or more of the classifications of a protected veteran', 'I am a disabled veteran', 'Decline to self-identify'] },
      { id: 'disability_status', text: 'Disability status', type: 'select', options: ['', 'Yes, I have a disability (or previously had a disability)', 'No, I do not have a disability', 'I do not want to answer'] },
      { id: 'age_18', text: 'Are you at least 18 years of age?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'accommodation', text: 'Able to perform essential functions of the job with or without accommodation?', type: 'select', options: ['', 'Yes', 'No'] },
      { id: 'how_heard', text: 'How did you hear about this position? (default answer)', type: 'select', options: ['', 'Company Website', 'LinkedIn', 'Indeed', 'Glassdoor', 'Employee Referral', 'Recruiter / Staffing Agency', 'University / Career Fair', 'Google Search', 'Social Media', 'Job Board (other)', 'Other'] },
      { id: 'anything_else', text: 'Is there anything else you would like employers to know?', type: 'textarea' },
    ]
  },
  {
    id: 'text-dumps',
    title: 'Text Dumps',
    description: 'Paste your resume, LinkedIn About, cover letter, or any text that describes your experience.',
    icon: '<span class="material-symbols-outlined">assignment</span>',
    required: false,
    questions: [] // Special section — rendered separately
  }
];

/**
 * In-memory applicant context. Loaded from chrome.storage on init.
 * @type {{ sections: Object<string, Object<string, string>>, textDumps: Array, version: number, completedAt?: string }}
 */
let applicantContext = { sections: {}, textDumps: [], version: 1 };

/** Currently active section index and question index within that section. */
let currentSectionIdx = 0;
let currentQuestionIdx = 0;

/** Current view mode: 'flow' (one question at a time) or 'review' */
let intakeViewMode = 'flow';

/** Debounce timer for auto-saving context */
let _intakeSaveTimer = null;

/**
 * Debounced save of applicantContext to chrome.storage via background.
 */
function scheduleIntakeSave() {
  if (_intakeSaveTimer) clearTimeout(_intakeSaveTimer);
  _intakeSaveTimer = setTimeout(async () => {
    try {
      await sendMessage({ type: 'SAVE_APPLICANT_CONTEXT', applicantContext });
    } catch (err) {
      // Silently fail — auto-save is best-effort
    }
  }, 800);
}

/**
 * Gets the answer for a given section and question from applicantContext.
 */
function getAnswer(sectionId, questionId) {
  return applicantContext.sections?.[sectionId]?.[questionId] || '';
}

/**
 * Sets an answer and schedules a save.
 */
function setAnswer(sectionId, questionId, value) {
  if (!applicantContext.sections[sectionId]) applicantContext.sections[sectionId] = {};
  applicantContext.sections[sectionId][questionId] = value;
  scheduleIntakeSave();
}

/**
 * Calculates how many questions have been answered across all sections.
 */
function getCompletionStats() {
  let total = 0;
  let answered = 0;
  for (const section of INTAKE_SECTIONS) {
    if (section.id === 'text-dumps') continue;
    for (const q of section.questions) {
      total++;
      if (getAnswer(section.id, q.id).trim()) answered++;
    }
  }
  // Count text dumps as answered if any exist
  if (applicantContext.textDumps?.length > 0) answered++;
  total++; // text dumps count as one "question"
  return { total, answered, percent: total > 0 ? Math.round((answered / total) * 100) : 0 };
}

/**
 * Determines if a section has been "completed" (all required questions answered).
 */
function isSectionComplete(sectionId) {
  const section = INTAKE_SECTIONS.find(s => s.id === sectionId);
  if (!section) return false;
  if (section.id === 'text-dumps') return (applicantContext.textDumps?.length || 0) > 0;
  const requiredQs = section.questions.filter(q => q.required);
  if (requiredQs.length === 0) {
    // For optional sections, "complete" means at least one answer filled in
    return section.questions.some(q => getAnswer(sectionId, q.id).trim());
  }
  return requiredQs.every(q => getAnswer(sectionId, q.id).trim());
}

/**
 * Renders the sidebar with section list and progress indicators.
 */
function renderIntakeSidebar() {
  const sidebar = document.getElementById('intakeSidebar');
  if (!sidebar) return;
  sidebar.innerHTML = '';

  INTAKE_SECTIONS.forEach((section, idx) => {
    const complete = isSectionComplete(section.id);
    const active = idx === currentSectionIdx && intakeViewMode === 'flow';
    const div = document.createElement('div');
    div.className = 'intake-sidebar-item' + (active ? ' active' : '') + (complete ? ' complete' : '');
    div.innerHTML = `
      <div class="intake-sidebar-icon">${complete ? '<span class="material-symbols-outlined">check</span>' : section.icon}</div>
      <div>
        <div style="font-size:13px;">${escapeHTML(section.title)}</div>
        ${section.required ? '<div style="font-size:10px;color:var(--ac-text-muted);">Required</div>' : ''}
      </div>
    `;
    div.addEventListener('click', () => {
      currentSectionIdx = idx;
      currentQuestionIdx = 0;
      intakeViewMode = 'flow';
      renderIntakeFlow();
    });
    sidebar.appendChild(div);
  });

  // Review & Finish button at the bottom
  const reviewBtn = document.createElement('div');
  reviewBtn.className = 'intake-sidebar-item' + (intakeViewMode === 'review' ? ' active' : '');
  reviewBtn.innerHTML = `<div class="intake-sidebar-icon"><span class="material-symbols-outlined">rate_review</span></div><div style="font-size:13px;">Review & Finish</div>`;
  reviewBtn.addEventListener('click', () => {
    intakeViewMode = 'review';
    renderIntakeFlow();
  });
  sidebar.appendChild(reviewBtn);

  // Update progress bar
  const stats = getCompletionStats();
  const fill = document.getElementById('intakeProgressFill');
  if (fill) fill.style.width = stats.percent + '%';
}

/**
 * Main render dispatcher — calls the appropriate renderer based on view mode.
 */
function renderIntakeFlow() {
  // Guard: skip rendering if intake containers are hidden or absent (Stitch redesign)
  const sidebar = document.getElementById('intakeSidebar');
  const main = document.getElementById('intakeMain');
  if (!sidebar || !main || sidebar.offsetParent === null) return;

  renderIntakeSidebar();
  if (intakeViewMode === 'review') {
    renderIntakeReview();
  } else {
    const section = INTAKE_SECTIONS[currentSectionIdx];
    if (section.id === 'text-dumps') {
      renderTextDumpSection();
    } else {
      renderIntakeSection();
    }
  }
}

/**
 * Renders the current section as a form with all questions visible at once.
 */
function renderIntakeSection() {
  const main = document.getElementById('intakeMain');
  if (!main) return;
  const section = INTAKE_SECTIONS[currentSectionIdx];

  let html = `
    <div class="intake-section-title">${escapeHTML(section.title)}</div>
    <div class="intake-section-desc">${escapeHTML(section.description)}</div>
  `;

  section.questions.forEach(q => {
    const answer = getAnswer(section.id, q.id);
    const requiredMark = q.required ? ' <span style="color:#dc2626;">*</span>' : '';
    html += `<div class="intake-question-label">${escapeHTML(q.text)}${requiredMark}</div>`;
    if (q.hint) html += `<div class="intake-question-hint">${escapeHTML(q.hint)}</div>`;

    if (q.type === 'select') {
      const optionsHTML = (q.options || []).map(opt =>
        `<option value="${escapeAttr(opt)}"${answer === opt ? ' selected' : ''}>${escapeHTML(opt || '-- Select --')}</option>`
      ).join('');
      html += `<select class="intake-answer-input" data-section="${section.id}" data-question="${q.id}">${optionsHTML}</select>`;
    } else if (q.type === 'textarea') {
      html += `<textarea class="intake-answer-input" data-section="${section.id}" data-question="${q.id}" rows="3" placeholder="${escapeAttr(q.hint || 'Your answer...')}">${escapeHTML(answer)}</textarea>`;
    } else {
      html += `<input type="text" class="intake-answer-input" data-section="${section.id}" data-question="${q.id}" value="${escapeAttr(answer)}" placeholder="${escapeAttr(q.hint || 'Your answer...')}">`;
    }
  });

  // Navigation
  html += `<div class="intake-nav">`;
  if (currentSectionIdx > 0) {
    html += `<button class="btn btn-secondary" id="intakePrevSection">Back</button>`;
  }
  html += `<div class="spacer"></div>`;
  if (currentSectionIdx < INTAKE_SECTIONS.length - 1) {
    html += `<button class="btn btn-primary" id="intakeNextSection">Next Section</button>`;
  } else {
    html += `<button class="btn btn-primary" id="intakeGoReview">Review & Finish</button>`;
  }
  html += `</div>`;

  main.innerHTML = html;

  // Wire up live-sync for all inputs
  main.querySelectorAll('.intake-answer-input').forEach(el => {
    const evt = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evt, () => {
      setAnswer(el.dataset.section, el.dataset.question, el.value);
      renderIntakeSidebar(); // Update completion indicators
    });
  });

  // Navigation buttons
  const prevBtn = main.querySelector('#intakePrevSection');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    currentSectionIdx--;
    currentQuestionIdx = 0;
    renderIntakeFlow();
  });

  const nextBtn = main.querySelector('#intakeNextSection');
  if (nextBtn) nextBtn.addEventListener('click', () => {
    currentSectionIdx++;
    currentQuestionIdx = 0;
    renderIntakeFlow();
  });

  const reviewBtn = main.querySelector('#intakeGoReview');
  if (reviewBtn) reviewBtn.addEventListener('click', () => {
    intakeViewMode = 'review';
    renderIntakeFlow();
  });
}

/**
 * Renders the Text Dump section with add/remove/edit capabilities.
 */
function renderTextDumpSection() {
  const main = document.getElementById('intakeMain');
  if (!main) return;
  const section = INTAKE_SECTIONS.find(s => s.id === 'text-dumps');

  let html = `
    <div class="intake-section-title">${escapeHTML(section.title)}</div>
    <div class="intake-section-desc">${escapeHTML(section.description)}</div>
    <p style="font-size:12px;color:var(--ac-primary);margin-bottom:16px;">We'll use this text to give better, more personalized answers on your applications.</p>
  `;

  const dumps = applicantContext.textDumps || [];
  dumps.forEach((dump, i) => {
    html += `
      <div class="text-dump-entry" data-dump-idx="${i}">
        <div class="text-dump-header">
          <select class="dump-label-select" data-dump-idx="${i}">
            ${['Resume', 'LinkedIn About', 'Cover Letter', 'Notes', 'Other'].map(opt =>
              `<option value="${escapeAttr(opt)}"${dump.label === opt ? ' selected' : ''}>${escapeHTML(opt)}</option>`
            ).join('')}
          </select>
          <button class="btn btn-danger btn-sm remove-dump" data-dump-idx="${i}">&times;</button>
        </div>
        <textarea class="intake-answer-input dump-content" data-dump-idx="${i}" rows="6" placeholder="Paste your text here...">${escapeHTML(dump.content || '')}</textarea>
        <div class="text-dump-char-count">${(dump.content || '').length.toLocaleString()} / ${MAX_TEXT_DUMP_CHARS.toLocaleString()} characters</div>
      </div>
    `;
  });

  if (dumps.length < MAX_TEXT_DUMPS) {
    html += `<button class="btn btn-secondary btn-sm" id="addTextDumpBtn">+ Add Text Block</button>`;
  } else {
    html += `<p style="font-size:12px;color:var(--ac-text-muted);">Maximum ${MAX_TEXT_DUMPS} text blocks reached.</p>`;
  }

  // Navigation
  html += `<div class="intake-nav">`;
  if (currentSectionIdx > 0) {
    html += `<button class="btn btn-secondary" id="intakePrevSection">Back</button>`;
  }
  html += `<div class="spacer"></div>`;
  html += `<button class="btn btn-primary" id="intakeGoReview">Review & Finish</button>`;
  html += `</div>`;

  main.innerHTML = html;

  // Wire up label selects
  main.querySelectorAll('.dump-label-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const idx = parseInt(sel.dataset.dumpIdx);
      applicantContext.textDumps[idx].label = sel.value;
      scheduleIntakeSave();
    });
  });

  // Wire up content textareas
  main.querySelectorAll('.dump-content').forEach(ta => {
    ta.addEventListener('input', () => {
      const idx = parseInt(ta.dataset.dumpIdx);
      const value = ta.value.substring(0, MAX_TEXT_DUMP_CHARS);
      applicantContext.textDumps[idx].content = value;
      ta.closest('.text-dump-entry').querySelector('.text-dump-char-count').textContent =
        `${value.length.toLocaleString()} / ${MAX_TEXT_DUMP_CHARS.toLocaleString()} characters`;
      scheduleIntakeSave();
    });
  });

  // Wire up remove buttons
  main.querySelectorAll('.remove-dump').forEach(btn => {
    btn.addEventListener('click', () => {
      applicantContext.textDumps.splice(parseInt(btn.dataset.dumpIdx), 1);
      scheduleIntakeSave();
      renderTextDumpSection();
      renderIntakeSidebar();
    });
  });

  // Add button
  const addBtn = main.querySelector('#addTextDumpBtn');
  if (addBtn) addBtn.addEventListener('click', () => {
    if (!applicantContext.textDumps) applicantContext.textDumps = [];
    applicantContext.textDumps.push({ label: 'Resume', content: '', createdAt: new Date().toISOString() });
    scheduleIntakeSave();
    renderTextDumpSection();
    renderIntakeSidebar();
  });

  // Navigation
  const prevBtn = main.querySelector('#intakePrevSection');
  if (prevBtn) prevBtn.addEventListener('click', () => {
    currentSectionIdx--;
    renderIntakeFlow();
  });

  const reviewBtn = main.querySelector('#intakeGoReview');
  if (reviewBtn) reviewBtn.addEventListener('click', () => {
    intakeViewMode = 'review';
    renderIntakeFlow();
  });
}

/**
 * Renders the Review & Finish screen showing all answers grouped by section.
 */
function renderIntakeReview() {
  const main = document.getElementById('intakeMain');
  if (!main) return;

  const stats = getCompletionStats();
  let html = `
    <div class="intake-section-title">Review Your Context</div>
    <div class="intake-section-desc">${stats.answered} of ${stats.total} questions answered (${stats.percent}% complete)</div>
  `;

  INTAKE_SECTIONS.forEach((section, sIdx) => {
    if (section.id === 'text-dumps') {
      // Text dumps review
      const dumps = applicantContext.textDumps || [];
      if (dumps.length > 0) {
        html += `<div class="intake-review-section">`;
        html += `<h3 data-section-idx="${sIdx}">${escapeHTML(section.icon + ' ' + section.title)} (${dumps.length} block${dumps.length === 1 ? '' : 's'})</h3>`;
        dumps.forEach(dump => {
          const preview = (dump.content || '').substring(0, 100).replace(/\n/g, ' ');
          html += `<div class="intake-review-item">
            <div class="intake-review-q">${escapeHTML(dump.label)}</div>
            <div class="intake-review-a">${preview ? escapeHTML(preview) + (dump.content.length > 100 ? '...' : '') : '<span class="empty">Empty</span>'}</div>
          </div>`;
        });
        html += `</div>`;
      }
      return;
    }

    const answeredCount = section.questions.filter(q => getAnswer(section.id, q.id).trim()).length;
    html += `<div class="intake-review-section">`;
    html += `<h3 data-section-idx="${sIdx}">${escapeHTML(section.icon + ' ' + section.title)} (${answeredCount}/${section.questions.length})</h3>`;
    section.questions.forEach(q => {
      const answer = getAnswer(section.id, q.id);
      html += `<div class="intake-review-item">
        <div class="intake-review-q">${escapeHTML(q.text)}</div>
        <div class="intake-review-a${answer.trim() ? '' : ' empty'}">${answer.trim() ? escapeHTML(answer) : 'Not answered'}</div>
      </div>`;
    });
    html += `</div>`;
  });

  html += `<div style="text-align:center;margin-top:20px;">
    <button class="btn btn-primary" id="intakeSaveAndFinish">Save Context</button>
  </div>`;

  main.innerHTML = html;

  // Click on section title to jump back and edit
  main.querySelectorAll('[data-section-idx]').forEach(h3 => {
    h3.addEventListener('click', () => {
      currentSectionIdx = parseInt(h3.dataset.sectionIdx);
      currentQuestionIdx = 0;
      intakeViewMode = 'flow';
      renderIntakeFlow();
    });
  });

  // Save button
  main.querySelector('#intakeSaveAndFinish').addEventListener('click', async () => {
    try {
      applicantContext.completedAt = new Date().toISOString();
      await sendMessage({ type: 'SAVE_APPLICANT_CONTEXT', applicantContext });
      showToast('Applicant context saved!', 'success');
    } catch (err) {
      showToast('Error saving: ' + err.message, 'error');
    }
  });
}

// ─── Q&A migration (old qaList → new applicantContext) ──────────────────────

/**
 * Maps from old Q&A question text to new intake section/question IDs.
 * Used for one-time migration of existing qaList data.
 */
const QA_MIGRATION_MAP = {
  'First Name': ['personal-details', 'first_name'],
  'Last Name': ['personal-details', 'last_name'],
  'Email Address': ['personal-details', 'email'],
  'Phone Number': ['personal-details', 'phone'],
  'Street Address': ['personal-details', 'street_address'],
  'Street Address Line 2 (Apt, Suite, Unit)': ['personal-details', 'address_line_2'],
  'City': ['personal-details', 'city'],
  'State / Province': ['personal-details', 'state'],
  'ZIP / Postal Code': ['personal-details', 'zip_code'],
  'Country': ['personal-details', 'country'],
  'Current Job Title': ['personal-details', 'current_title'],
  'Current Employer / Company': ['personal-details', 'current_employer'],
  'Are you legally authorized to work in the United States?': ['work-preferences', 'work_auth'],
  'Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?': ['work-preferences', 'sponsorship'],
  'Are you at least 18 years of age?': ['personal-details', 'age_18'],
  'Work authorization status': ['work-preferences', 'auth_status'],
  'Earliest available start date': ['work-preferences', 'start_date'],
  'Notice period for current employer': ['work-preferences', 'notice_period'],
  'Desired employment type': ['work-preferences', 'employment_type'],
  'Desired annual salary (USD)': ['work-preferences', 'desired_salary'],
  'Desired hourly rate (if applicable)': ['work-preferences', 'hourly_rate'],
  'Willing to undergo a background check?': ['work-preferences', 'background_check'],
  'Willing to undergo a drug test?': ['work-preferences', 'drug_test'],
  "Do you have a valid driver's license?": ['work-preferences', 'drivers_license'],
  'Willing to relocate?': ['work-preferences', 'willing_relocate'],
  'Preferred work arrangement': ['work-preferences', 'work_arrangement'],
  'Willingness to travel': ['work-preferences', 'travel_willingness'],
  'Security clearance': ['work-preferences', 'security_clearance'],
  'How did you hear about this position?': ['personal-details', 'how_heard'],
  'LinkedIn Profile URL': ['personal-details', 'linkedin_url'],
  'Portfolio / Personal Website URL': ['personal-details', 'portfolio_url'],
  'GitHub Profile URL': ['personal-details', 'github_url'],
  'Gender': ['personal-details', 'gender'],
  'Gender identity': ['personal-details', 'gender_identity'],
  'Sexual orientation': ['personal-details', 'sexual_orientation'],
  'Pronouns': ['personal-details', 'pronouns'],
  'Race / Ethnicity': ['personal-details', 'race_ethnicity'],
  'Are you Hispanic or Latino?': ['personal-details', 'hispanic_latino'],
  'Veteran status': ['personal-details', 'veteran_status'],
  'Disability status': ['personal-details', 'disability_status'],
  'Highest level of education completed': ['education', 'highest_education'],
  'Relevant certifications or professional licenses': ['education', 'certifications'],
  'Able to perform essential functions of the job with or without accommodation?': ['personal-details', 'accommodation'],
  'Is there anything else you would like us to know?': ['personal-details', 'anything_else'],
};

/**
 * Migrates old qaList data into the new applicantContext format.
 * Only runs once — when applicantContext is empty but qaList has data.
 */
function migrateFromQAList(oldQAList) {
  if (!oldQAList || !oldQAList.length) return false;

  let migrated = 0;
  for (const qa of oldQAList) {
    if (!qa.answer || !qa.answer.trim()) continue;
    const mapping = QA_MIGRATION_MAP[qa.question];
    if (mapping) {
      const [sectionId, questionId] = mapping;
      if (!applicantContext.sections[sectionId]) applicantContext.sections[sectionId] = {};
      applicantContext.sections[sectionId][questionId] = qa.answer;
      migrated++;
    }
  }

  return migrated > 0;
}

// ─── AI settings ──────────────────────────────────────────────────────────────

/** Temperature slider — updates the adjacent numeric label in real time. */
const sTemp      = document.getElementById('sTemp');
const tempValue  = document.getElementById('tempValue');
sTemp.addEventListener('input', () => {
  tempValue.textContent = sTemp.value;
});

/** Updates the display text for a token budget slider (tokens + approx words). */
function updateBudgetDisplay(sliderId) {
  const slider = document.getElementById(sliderId);
  const valMap = {
    sBudgetResume: 'sBudgetResumeVal',
    sBudgetAnalysis: 'sBudgetAnalysisVal',
    sBudgetCoverLetter: 'sBudgetCoverLetterVal',
    sBudgetChat: 'sBudgetChatVal',
  };
  const display = document.getElementById(valMap[sliderId]);
  if (slider && display) {
    const tokens = parseInt(slider.value, 10);
    const words = Math.round(tokens * 0.75);
    display.textContent = `${tokens} tokens (~${words} words)`;
  }
}

// Token budget sliders — update display on drag
['sBudgetResume', 'sBudgetAnalysis', 'sBudgetCoverLetter', 'sBudgetChat'].forEach(id => {
  const slider = document.getElementById(id);
  if (slider) {
    slider.addEventListener('input', () => updateBudgetDisplay(id));
  }
});

// ─── System Prompt Editor ─────────────────────────────────────────────────────

/** State: current prompts, defaults, and metadata loaded from background.js */
let _promptData = null;

/**
 * Renders all prompt section editors into #promptSections.
 * Each section is collapsible with a textarea, modified badge, and reset button.
 */
function renderPromptSections(data) {
  _promptData = data;
  const container = document.getElementById('promptSections');
  if (!container) return;
  container.innerHTML = '';

  const order = ['resume', 'coverLetter', 'chat', 'analysis', 'autofill', 'resumeParse', 'jdDigest', 'edgeSystem'];

  for (const key of order) {
    const label = data.labels[key] || key;
    const desc = data.descriptions[key] || '';
    const current = data.prompts[key] || '';
    const isDefault = current === data.defaults[key];

    const section = document.createElement('div');
    section.className = 'prompt-section';
    section.dataset.key = key;
    section.innerHTML = `
      <div class="prompt-section-header">
        <span class="prompt-section-arrow"><span class="material-symbols-outlined" style="font-size:16px;">chevron_right</span></span>
        <span class="prompt-section-name">${label}</span>
        <span class="prompt-section-badge ${isDefault ? '' : 'visible'}">Modified</span>
      </div>
      <div class="prompt-section-body">
        <div class="prompt-section-desc">${desc}</div>
        <textarea class="prompt-textarea" data-prompt-key="${key}">${escapeHTML(current)}</textarea>
        <div class="prompt-section-footer">
          <button class="prompt-reset-btn" data-reset-key="${key}">Reset to default</button>
        </div>
      </div>`;

    // Toggle collapse on header click
    section.querySelector('.prompt-section-header').addEventListener('click', () => {
      section.classList.toggle('open');
    });

    // Reset button
    section.querySelector('.prompt-reset-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const textarea = section.querySelector('.prompt-textarea');
      const result = await sendMessage({ type: 'RESET_PROMPT', key });
      if (result?.defaultValue) {
        textarea.value = result.defaultValue;
        data.prompts[key] = result.defaultValue;
        section.querySelector('.prompt-section-badge').classList.remove('visible');
        showToast('Prompt reset to default', 'info');
      }
    });

    // Track modifications on input
    section.querySelector('.prompt-textarea').addEventListener('input', (e) => {
      const badge = section.querySelector('.prompt-section-badge');
      const modified = e.target.value !== data.defaults[key];
      badge.classList.toggle('visible', modified);
    });

    container.appendChild(section);
  }
}

/** Collects all prompt textarea values and saves them. */
async function saveCustomPrompts() {
  const prompts = {};
  document.querySelectorAll('.prompt-textarea').forEach(textarea => {
    const key = textarea.dataset.promptKey;
    if (key) prompts[key] = textarea.value;
  });
  await sendMessage({ type: 'SAVE_CUSTOM_PROMPTS', prompts });
}

/** Simple HTML escaper for populating textareas safely. */
// escapeHTML defined once below (line ~1851) — removed duplicate here

// Reset All Prompts button
document.getElementById('resetAllPromptsBtn')?.addEventListener('click', async () => {
  if (!confirm('Reset all system prompts to defaults?')) return;
  await chrome.storage.local.remove('customPrompts');
  // Reload prompt sections from defaults
  const data = await sendMessage({ type: 'GET_CUSTOM_PROMPTS' });
  renderPromptSections(data);
  showToast('All prompts reset to defaults', 'info');
});

// ─── Provider UI ──────────────────────────────────────────────────────────────

/**
 * Populates the provider <select> from the registry object returned by
 * GET_PROVIDERS.  Free-tier providers get a visual label appended to their name.
 *
 * @param {Object.<string, {name: string, free?: boolean}>} providers - Provider registry.
 */
function populateProviderDropdown(providers) {
  const select = document.getElementById('sProvider');
  select.innerHTML = '';
  for (const [id, config] of Object.entries(providers)) {
    const option = document.createElement('option');
    option.value = id;
    // U+2014 em-dash used as separator before "Free tier" label
    option.textContent = config.name + (config.free ? ' \u2014 Free tier' : '');
    select.appendChild(option);
  }
}

/**
 * Updates the model dropdown, API key placeholder, and provider hint text
 * whenever the selected provider changes.
 * Attempts to preserve the previously selected model ID if it exists in the new
 * provider's model list; falls back to the provider's default or first model.
 *
 * @param {string} providerId - The provider ID key from the registry.
 */
function updateProviderUI(providerId) {
  const config = providerData[providerId];
  if (!config) return;

  // Rebuild the model dropdown for the new provider
  const modelSelect  = document.getElementById('sModel');
  const currentModel = modelSelect.value; // save before clearing
  modelSelect.innerHTML = '';
  (config.models || []).forEach(m => {
    const opt = document.createElement('option');
    opt.value       = m.id;
    opt.textContent = m.name;
    modelSelect.appendChild(opt);
  });
  // Preserve current selection if valid for new provider, else use default
  if (config.models.some(m => m.id === currentModel)) {
    modelSelect.value = currentModel;
  } else {
    // Optional chaining handles providers with an empty models array gracefully
    modelSelect.value = config.defaultModel || config.models[0]?.id || '';
  }

  // Update the API key input placeholder to show the expected key format
  document.getElementById('sApiKey').placeholder = config.keyPlaceholder || 'Enter API key...';

  // Update the informational hint below the key input (e.g. sign-up URL)
  const hintEl = document.getElementById('providerHint');
  if (hintEl) {
    hintEl.textContent = config.hint || '';
  }
}

/** Refresh the model list and UI hints whenever the provider selection changes. */
document.getElementById('sProvider').addEventListener('change', (e) => {
  updateProviderUI(e.target.value);
});

/**
 * Toggle API key field visibility between password-masked and plain text.
 * Button label changes between 'Show' and 'Hide' accordingly.
 */
document.getElementById('toggleKeyBtn').addEventListener('click', () => {
  const input = document.getElementById('sApiKey');
  const btn   = document.getElementById('toggleKeyBtn');
  if (input.type === 'password') {
    input.type    = 'text';
    btn.textContent = 'Hide';
  } else {
    input.type    = 'password';
    btn.textContent = 'Show';
  }
});

/**
 * "Test Connection" button handler.
 * Runs a 4-layer diagnostic: settings → auth → Edge Function → local AI.
 * Displays structured results so the user can immediately see what's broken.
 */
document.getElementById('testConnBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('testResult');
  resultEl.className    = 'test-result';
  resultEl.style.display = 'none';

  await saveSettings();

  try {
    resultEl.innerHTML     = 'Running 4-layer diagnostic...';
    resultEl.className     = 'test-result loading';
    resultEl.style.display = 'block';

    const diag = await sendMessage({ type: 'TEST_CONNECTION' });
    const layers = diag?.layers || {};

    const icon = (status) => status === 'ok' ? '✅' : status === 'warn' ? '⚠️' : status === 'skipped' ? '⏭️' : '❌';

    let html = `<div style="font-family:monospace;font-size:12px;line-height:1.6">`;
    html += `<strong>Diagnostic Results</strong> <span style="color:#888">${diag.timestamp || ''}</span><br>`;

    // Settings
    const s = layers.settings || {};
    html += `${icon(s.status)} <strong>Settings:</strong> useBackend=${s.useBackend}, apiKey=${s.hasApiKey ? 'set' : 'NOT SET'}, provider=${s.provider}<br>`;

    // Auth
    const a = layers.auth || {};
    if (a.signedIn) {
      html += `${icon(a.status)} <strong>Auth:</strong> signed in as ${a.userEmail}, token ${a.isExpired ? '<span style="color:red">EXPIRED</span>' : 'valid'} (expires ${a.expiresAt})<br>`;
    } else {
      html += `${icon(a.status)} <strong>Auth:</strong> ${a.detail || 'not signed in'}<br>`;
    }

    // Edge Function
    const e = layers.edgeFunction || {};
    if (e.status === 'ok') {
      html += `${icon(e.status)} <strong>Edge Function:</strong> ${e.latencyMs}ms, model=${e.model}, cached=${e.cached}<br>`;
    } else if (e.status === 'error') {
      html += `${icon(e.status)} <strong>Edge Function:</strong> <span style="color:red">${e.error}</span><br>`;
    } else {
      html += `${icon(e.status)} <strong>Edge Function:</strong> ${e.reason}<br>`;
    }

    // Local AI
    const l = layers.localAI || {};
    if (l.status === 'ok') {
      html += `${icon(l.status)} <strong>Local AI:</strong> working<br>`;
    } else if (l.status === 'error') {
      html += `${icon(l.status)} <strong>Local AI:</strong> <span style="color:red">${l.error}</span><br>`;
    } else {
      html += `${icon(l.status)} <strong>Local AI:</strong> ${l.reason}<br>`;
    }

    html += `</div>`;

    // Overall status
    const hasError = Object.values(layers).some(l => l.status === 'error');
    resultEl.innerHTML = html;
    resultEl.className = hasError ? 'test-result error' : 'test-result success';
  } catch (err) {
    resultEl.textContent = 'Diagnostic failed: ' + err.message;
    resultEl.className   = 'test-result error';
  }
});

/** "Save Settings" button — delegates to saveSettings() then shows a toast. */
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  await saveSettings();
  await saveCustomPrompts();
  showToast('Settings & prompts saved!', 'success');
});

/**
 * Collects the current values from the settings form and persists them via the
 * background service worker (SAVE_SETTINGS message).
 * Called both from the save button and pre-emptively before a connection test.
 */
async function saveSettings() {
  const settings = {
    provider:    document.getElementById('sProvider').value,
    apiKey:      document.getElementById('sApiKey').value.trim(),
    model:       document.getElementById('sModel').value,
    temperature: parseFloat(document.getElementById('sTemp').value),
    useBackend:  document.getElementById('sUseBackend').checked,
    tokenBudgets: {
      resume:      parseInt(document.getElementById('sBudgetResume').value, 10),
      analysis:    parseInt(document.getElementById('sBudgetAnalysis').value, 10),
      coverLetter: parseInt(document.getElementById('sBudgetCoverLetter').value, 10),
      chat:        parseInt(document.getElementById('sBudgetChat').value, 10),
    }
  };
  await sendMessage({ type: 'SAVE_SETTINGS', settings });
  // Save data consent separately (its own storage key + Supabase sync)
  const dataConsent = document.getElementById('sDataConsent').checked;
  await sendMessage({ type: 'SET_DATA_CONSENT', consented: dataConsent });
  // Save auto-scan preference
  const autoScanEnabled = document.getElementById('sAutoScanEnabled').checked;
  await chrome.storage.local.set({ acAutoScanEnabled: autoScanEnabled });
}

// ─── Pre-fill intake from profile data ───────────────────────────────────────

/**
 * Seeds the intake flow's Personal Details and Education sections from parsed
 * resume profile data. Only fills in fields that are currently empty, so it
 * never overwrites user-entered answers.
 */
function prefillFromProfile(profile) {
  if (!profile) return;
  let changed = false;

  function fillIfEmpty(sectionId, questionId, value) {
    if (!value || !value.toString().trim()) return;
    if (getAnswer(sectionId, questionId).trim()) return; // Don't overwrite
    if (!applicantContext.sections[sectionId]) applicantContext.sections[sectionId] = {};
    applicantContext.sections[sectionId][questionId] = value.toString().trim();
    changed = true;
  }

  // Personal details from profile form
  const nameParts = (profile.name || '').trim().split(/\s+/);
  if (nameParts.length >= 2) {
    fillIfEmpty('personal-details', 'first_name', nameParts[0]);
    fillIfEmpty('personal-details', 'last_name', nameParts.slice(1).join(' '));
  } else if (nameParts.length === 1) {
    fillIfEmpty('personal-details', 'first_name', nameParts[0]);
  }
  fillIfEmpty('personal-details', 'email', profile.email);
  fillIfEmpty('personal-details', 'phone', profile.phone);
  fillIfEmpty('personal-details', 'city', profile.location);
  fillIfEmpty('personal-details', 'linkedin_url', profile.linkedin);
  fillIfEmpty('personal-details', 'portfolio_url', profile.website);

  // Professional summary
  fillIfEmpty('professional-summary', 'elevator_pitch', profile.summary);

  // Skills
  if (profile.skills?.length) {
    fillIfEmpty('professional-summary', 'top_skills', profile.skills.slice(0, 10).join(', '));
    fillIfEmpty('experience-highlights', 'daily_tools', profile.skills.join(', '));
  }

  // Experience highlights from most recent role
  if (profile.experience?.length) {
    const recent = profile.experience[0];
    const roleDesc = [recent.title, recent.company].filter(Boolean).join(' at ');
    const fullDesc = roleDesc + (recent.description ? '\n' + recent.description : '');
    fillIfEmpty('experience-highlights', 'recent_role', fullDesc);
    fillIfEmpty('personal-details', 'current_title', recent.title);
    fillIfEmpty('personal-details', 'current_employer', recent.company);
  }

  // Education
  if (profile.education?.length) {
    const edu = profile.education[0];
    fillIfEmpty('education', 'field_of_study', edu.degree);
    fillIfEmpty('education', 'school_name', edu.school);
  }

  // Certifications
  if (profile.certifications?.length) {
    fillIfEmpty('education', 'certifications', profile.certifications.join(', '));
  }

  if (changed) {
    scheduleIntakeSave();
  }
}

// ─── Build Q&A-compatible list from applicantContext ─────────────────────────
// This backward-compat layer converts the new intake context back to the old
// { question, answer } array format that deterministicMatcher.js and
// aiService.js prompt builders expect.

/**
 * Converts applicantContext into the old qaList format for backward compatibility.
 * @returns {Array<{question: string, answer: string}>}
 */
function buildQAListFromContext() {
  const qaList = [];

  // Reverse the migration map: [sectionId, questionId] → question text
  const reverseMap = {};
  for (const [questionText, [sectionId, questionId]] of Object.entries(QA_MIGRATION_MAP)) {
    reverseMap[`${sectionId}.${questionId}`] = questionText;
  }

  for (const section of INTAKE_SECTIONS) {
    if (section.id === 'text-dumps') continue;
    for (const q of section.questions) {
      const answer = getAnswer(section.id, q.id);
      if (!answer.trim()) continue;
      // Use the old Q&A question text if we have a mapping, otherwise use the intake question text
      const questionText = reverseMap[`${section.id}.${q.id}`] || q.text;
      qaList.push({ question: questionText, answer });
    }
  }
  return qaList;
}

/**
 * Builds a rich context string for AI prompts from applicantContext.
 * This is richer than the old Q&A format — includes career goals, experience
 * highlights, text dumps, and more structured context.
 */
function buildContextForPrompt() {
  let parts = [];

  for (const section of INTAKE_SECTIONS) {
    if (section.id === 'text-dumps') continue;
    const sectionAnswers = [];
    for (const q of section.questions) {
      const answer = getAnswer(section.id, q.id);
      if (answer.trim()) {
        sectionAnswers.push(`${q.text}: ${answer}`);
      }
    }
    if (sectionAnswers.length > 0) {
      parts.push(`=== ${section.title} ===\n${sectionAnswers.join('\n')}`);
    }
  }

  // Include text dumps (truncated to keep prompt manageable)
  const dumps = applicantContext.textDumps || [];
  if (dumps.length > 0) {
    const dumpTexts = dumps
      .filter(d => d.content?.trim())
      .map(d => `--- ${d.label} ---\n${d.content.substring(0, 5000)}`);
    if (dumpTexts.length > 0) {
      parts.push(`=== Additional Context ===\n${dumpTexts.join('\n\n')}`);
    }
  }

  return parts.join('\n\n');
}

// ─── Initialisation ───────────────────────────────────────────────────────────

/**
 * Bootstraps the profile page by fetching all persisted data in parallel, then
 * populating every section of the UI.
 *
 * Load order (all four fetches run concurrently via Promise.all):
 *   1. GET_PROFILE   → profileData + form population
 *   2. GET_QA_LIST   → qaList (migrated) + Q&A render
 *   3. GET_SETTINGS  → provider/model/key/temperature form
 *   4. GET_PROVIDERS → provider dropdown (must come before settings apply)
 *
 * After the parallel fetches, also fires loadAppliedJobs() and loadProfileSlots()
 * sequentially (they can start immediately but do not block the UI).
 */
async function init() {
  try {
    // Fan out all background requests simultaneously for fastest page load
    const [profile, contextData, qa, settings, providers, promptData] = await Promise.all([
      sendMessage({ type: 'GET_PROFILE'   }),
      sendMessage({ type: 'GET_APPLICANT_CONTEXT' }).catch(() => null),
      sendMessage({ type: 'GET_QA_LIST'   }).catch(() => []),
      sendMessage({ type: 'GET_SETTINGS'  }),
      sendMessage({ type: 'GET_PROVIDERS' }),
      sendMessage({ type: 'GET_CUSTOM_PROMPTS' }).catch(() => null)
    ]);

    // Populate provider dropdown from the registry (single source of truth for providers)
    if (providers) {
      providerData = providers;
      populateProviderDropdown(providers);
    }

    if (profile) {
      profileData = profile;
      populateProfileForm();
      // Resume cards handle showing which resume is loaded
    }

    // Load applicant context (new intake flow) or migrate from old qaList
    if (contextData && Object.keys(contextData.sections || {}).length > 0) {
      applicantContext = contextData;
    } else if (qa && qa.length) {
      // One-time migration from old Q&A format
      qaList = qa;
      if (migrateFromQAList(qa)) {
        sendMessage({ type: 'SAVE_APPLICANT_CONTEXT', applicantContext }).catch(() => {});
        showToast('Imported your existing Q&A answers into the new intake flow.', 'info');
      }
    }

    // Pre-fill intake personal details from profile data if intake is empty
    if (profile && !applicantContext.sections?.['personal-details']?.first_name) {
      prefillFromProfile(profile);
    }

    if (settings) {
      // Apply stored settings to the form; fall back to sensible defaults if missing
      document.getElementById('sProvider').value = settings.provider || 'anthropic';
      // updateProviderUI must run after the provider is set so the model list is correct
      updateProviderUI(settings.provider || 'anthropic');
      document.getElementById('sApiKey').value  = settings.apiKey || '';
      document.getElementById('sUseBackend').checked = settings.useBackend !== false;
      // Load data consent state
      try {
        const consent = await sendMessage({ type: 'GET_DATA_CONSENT' });
        document.getElementById('sDataConsent').checked = consent.consented === true;
      } catch (_) {}
      document.getElementById('sModel').value   = settings.model  || 'claude-sonnet-4-20250514';
      // Nullish coalescing: treat null/undefined as 0.3, but allow stored 0
      document.getElementById('sTemp').value    = settings.temperature ?? 0.3;
      tempValue.textContent                      = settings.temperature ?? 0.3;

      // Token budget sliders — populate from saved settings or defaults
      const budgets = settings.tokenBudgets || {};
      const budgetDefaults = { resume: 8192, analysis: 4096, coverLetter: 2048, chat: 1024 };
      for (const [key, defaultVal] of Object.entries(budgetDefaults)) {
        const idMap = { resume: 'sBudgetResume', analysis: 'sBudgetAnalysis', coverLetter: 'sBudgetCoverLetter', chat: 'sBudgetChat' };
        const slider = document.getElementById(idMap[key]);
        if (slider) {
          slider.value = budgets[key] || defaultVal;
          updateBudgetDisplay(idMap[key]);
        }
      }
    }

    // Auto-scan toggle
    try {
      const asData = await chrome.storage.local.get('acAutoScanEnabled');
      document.getElementById('sAutoScanEnabled').checked = asData.acAutoScanEnabled !== false;
    } catch (_) {}

    // Render system prompt editors
    if (promptData) {
      renderPromptSections(promptData);
    }

    // Pre-load applied jobs so the Applied tab is ready before the user clicks it
    loadAppliedJobs();
    // Load multi-slot state (activeSlot, profileSlots, slotNames) from local storage
    await loadProfileSlots();

    // Stitch redesign: inline editing, resume cards, text dump textareas
    initInlineEditing();
    loadInlineEditValues();
    renderResumeCards();
    wireTextDumpTextareas();
  } catch (err) {
    console.error('[init] Error during initialization:', err);
  }
  // Always render the intake flow, even if data loading failed
  renderIntakeFlow();
}

// ─── HTML escaping utilities ──────────────────────────────────────────────────

/**
 * Escapes a string for safe insertion as HTML text content.
 * Uses the browser's own serialiser to avoid hand-rolled regex escaping.
 *
 * @param {string} str - Raw string that may contain HTML special characters.
 * @returns {string} HTML-safe string.
 */
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Escapes a string for safe insertion into an HTML attribute value (double-quoted).
 * Handles the four characters that can break out of a quoted attribute context.
 *
 * @param {string} str - Raw attribute value string.
 * @returns {string} Attribute-safe string.
 */
function escapeAttr(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Applied jobs tracker ─────────────────────────────────────────────────────

/**
 * Fetches the applied-jobs list from the background and passes it to renderAppliedJobs.
 * Errors are silently swallowed — the section simply stays empty.
 */
let _allJobs = []; // Cached for filtering

async function loadAppliedJobs() {
  try {
    const jobs = await sendMessage({ type: 'GET_SAVED_JOBS' });
    _allJobs = jobs || [];
    renderAppliedJobs(_allJobs);
    wireJobFilters();
  } catch (err) {
    // Silently fail
  }
}

let _filtersWired = false;
function wireJobFilters() {
  if (_filtersWired) return;
  _filtersWired = true;
  const container = document.getElementById('myJobsFilters');
  if (!container) return;
  container.querySelectorAll('.myjobs-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.myjobs-filter').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.dataset.filter;
      if (filter === 'all') {
        renderAppliedJobs(_allJobs);
      } else {
        renderAppliedJobs(_allJobs.filter(j => j.status === filter));
      }
    });
  });
}

/**
 * Renders the unified My Jobs tracker as an HTML table.
 * Shows all jobs (saved + applied + interview + offer + rejected) with
 * status dropdowns, JD preview, and delete actions.
 * @param {Array<Object>} jobs
 */
/**
 * Builds a score ring element (HTML string) for a job card.
 * Uses a positioned overlay for the text so it's always centered.
 * @param {number} score - 0-100 match score
 * @returns {string} HTML markup
 */
function buildScoreRingHTML(score) {
  const size = 64;
  const strokeW = 5;
  const radius = (size - strokeW * 2) / 2;
  const circumference = 2 * Math.PI * radius;
  const cx = size / 2, cy = size / 2;

  // No score yet — show neutral dash ring
  if (score == null || score === 0) {
    return `
    <div class="myjobs-score-ring">
      <svg viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${cx}" cy="${cy}" r="${radius}" stroke="#e8ede7" stroke-width="${strokeW}"/>
      </svg>
      <div class="myjobs-score-inner">
        <span class="myjobs-score-pct" style="color:#9ca3af">—</span>
        <span class="myjobs-score-label" style="color:#9ca3af">Score</span>
      </div>
    </div>`;
  }

  const pct = Math.max(1, Math.min(100, score));
  const offset = circumference - (pct / 100) * circumference;
  const color = pct >= 70 ? '#22c55e' : pct >= 45 ? '#f59e0b' : '#ef4444';
  return `
    <div class="myjobs-score-ring">
      <svg viewBox="0 0 ${size} ${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${cx}" cy="${cy}" r="${radius}" stroke="#e8ede7" stroke-width="${strokeW}"/>
        <circle cx="${cx}" cy="${cy}" r="${radius}" stroke="${color}" stroke-width="${strokeW}"
          stroke-dasharray="${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"
          stroke-linecap="round" transform="rotate(-90 ${cx} ${cy})"/>
      </svg>
      <div class="myjobs-score-inner">
        <span class="myjobs-score-pct" style="color:${color}">${pct}%</span>
        <span class="myjobs-score-label" style="color:${color}">Match</span>
      </div>
    </div>`;
}

// Keep old name as alias for any legacy call sites
function buildScoreRingSVG(score) { return buildScoreRingHTML(score); }

/**
 * Renders the My Jobs tracker — single-row card layout matching the Stitch mockup.
 * Layout: score ring | title + meta | View JD | status pill | Prep | delete
 * @param {Array<Object>} jobs
 */
function renderAppliedJobs(jobs) {
  const container = document.getElementById('appliedJobsList');
  const countEl   = document.getElementById('appliedCount');

  // Update filter counts on every render
  updateFilterCounts(_allJobs);

  if (!jobs.length) {
    const isFiltered = _allJobs.length > 0;
    container.innerHTML = isFiltered
      ? `<div class="applied-empty">
           <div class="applied-empty-icon"><span class="material-symbols-outlined" style="font-size:48px;">search</span></div>
           <div class="applied-empty-title">No matches</div>
           <p>No jobs with this status. Try a different filter.</p>
         </div>`
      : `<div class="applied-empty">
           <div class="applied-empty-icon"><span class="material-symbols-outlined" style="font-size:48px;">work</span></div>
           <div class="applied-empty-title">No jobs tracked yet</div>
           <p>Open any job listing and click "Save Job" in the Copilot panel to start tracking your pipeline.</p>
         </div>`;
    if (countEl) countEl.textContent = '';
    return;
  }

  const notSaved = jobs.filter(j => j.status && j.status !== 'saved').length;
  if (countEl) countEl.textContent = jobs.length + ' Jobs' + (notSaved > 0 ? ` (${notSaved} applied)` : '');

  const statusOptions = ['saved', 'applied', 'interview', 'offer', 'rejected', 'withdrawn'];
  const statusLabels  = { saved: 'Saved', applied: 'Applied', interview: 'Interview', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn' };

  function statusPill(jobId, current) {
    let sel = `<div class="myjobs-status-wrap"><select class="myjobs-status-pill status-${current}" data-id="${escapeAttr(jobId)}">`;
    for (const s of statusOptions) {
      sel += `<option value="${s}"${s === current ? ' selected' : ''}>${statusLabels[s]}</option>`;
    }
    return sel + '</select></div>';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const diff = Math.floor((Date.now() - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return diff + ' days ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  let html = '<div class="myjobs-cards">';

  for (const job of jobs) {
    const id      = escapeAttr(job.id);
    const title   = escapeHTML(job.title || 'Unknown Role');
    const company = escapeHTML(job.company || 'Unknown Company');
    const dateStr = formatDate(job.statusDate || job.date || '');
    const url     = escapeAttr(job.url || '#');
    const hasURL  = job.url && job.url !== '#';
    const status  = job.status || 'saved';
    const hasJD   = !!(job.jdText && job.jdText.length > 50);

    html += `
    <div class="myjobs-card" data-job-id="${id}">
      <div class="myjobs-card-row">
        ${buildScoreRingHTML(job.score)}
        <div class="myjobs-card-info">
          ${hasURL
            ? `<a class="myjobs-card-title" href="${url}" target="_blank" rel="noopener">${title}<span class="myjobs-title-icon material-symbols-outlined" style="font-size:14px;">open_in_new</span></a>`
            : `<span class="myjobs-card-title">${title}</span>`
          }
          <div class="myjobs-card-meta">
            <span class="myjobs-meta-item"><span class="myjobs-meta-icon material-symbols-outlined" style="font-size:14px;">business</span>${company}</span>
            ${dateStr ? `<span class="myjobs-meta-item"><span class="myjobs-meta-icon material-symbols-outlined" style="font-size:14px;">schedule</span>${dateStr}</span>` : ''}
          </div>
        </div>
        <div class="myjobs-card-actions">
          ${hasJD ? `<button class="myjobs-jd-btn" data-id="${id}" aria-expanded="false" aria-controls="jd-preview-${id}">View JD <span class="material-symbols-outlined" style="font-size:14px;">expand_more</span></button>` : ''}
          ${statusPill(job.id, status)}
          <button class="myjobs-prep-btn" data-id="${id}" data-url="${url}" aria-label="Prep for ${title}"><span class="material-symbols-outlined" style="font-size:16px;">bolt</span> Prep</button>
          <button class="myjobs-delete-btn" data-id="${id}" data-title="${escapeHTML(title)}" aria-label="Remove ${title}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
        </div>
      </div>
      ${hasJD ? `<div class="myjobs-jd-preview" id="jd-preview-${id}" style="display:none;"><div class="myjobs-jd-content">${escapeHTML(job.jdText)}</div></div>` : ''}
    </div>`;
  }

  html += '</div>';
  container.innerHTML = html;

  // Wire status pill selects
  container.querySelectorAll('.myjobs-status-pill').forEach(select => {
    select.addEventListener('change', async () => {
      const jobId     = select.dataset.id;
      const newStatus = select.value;
      try {
        await sendMessage({ type: 'UPDATE_JOB_STATUS', jobId, status: newStatus });
        select.className = `myjobs-status-pill status-${newStatus}`;
        showToast('Status: ' + (statusLabels[newStatus] || newStatus), 'success');
        const job = _allJobs.find(j => j.id === jobId);
        if (job) { job.status = newStatus; job.statusDate = new Date().toISOString().split('T')[0]; }
        updateFilterCounts(_allJobs);
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      }
    });
  });

  // Wire JD toggles
  container.querySelectorAll('.myjobs-jd-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const preview = document.getElementById('jd-preview-' + btn.dataset.id);
      if (!preview) return;
      const open = preview.style.display !== 'none';
      preview.style.display = open ? 'none' : 'block';
      btn.innerHTML = open ? 'View JD <span class="material-symbols-outlined" style="font-size:14px;">expand_more</span>' : 'Hide JD <span class="material-symbols-outlined" style="font-size:14px;">expand_less</span>';
      btn.setAttribute('aria-expanded', String(!open));
    });
  });

  // Wire delete — two-step: first click shows confirm, second click deletes
  container.querySelectorAll('.myjobs-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.confirming === 'true') {
        // Second click: confirmed, do the delete
        btn.dataset.confirming = 'false';
        btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">delete</span>';
        btn.removeAttribute('aria-label');
        btn.setAttribute('aria-label', 'Remove ' + (btn.dataset.title || 'job'));
        try {
          await sendMessage({ type: 'DELETE_JOB', jobId: btn.dataset.id });
          _allJobs = _allJobs.filter(j => j.id !== btn.dataset.id);
          showToast('Job removed.', 'success');
          loadAppliedJobs();
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        }
      } else {
        // First click: ask for confirmation
        btn.dataset.confirming = 'true';
        btn.textContent = 'Delete?';
        btn.setAttribute('aria-label', 'Confirm delete');
        // Auto-cancel after 3s if user doesn't confirm
        setTimeout(() => {
          if (btn.dataset.confirming === 'true') {
            btn.dataset.confirming = 'false';
            btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">delete</span>';
            btn.setAttribute('aria-label', 'Remove ' + (btn.dataset.title || 'job'));
          }
        }, 3000);
      }
    });
  });

  // Wire prep — opens in-page interview prep view
  container.querySelectorAll('.myjobs-prep-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      openPrepView(btn.dataset.id);
    });
  });
}

/**
 * Updates filter pill counts from the full jobs array.
 */
function updateFilterCounts(allJobs) {
  const counts = { all: allJobs.length, saved: 0, applied: 0, interview: 0, offer: 0, rejected: 0, withdrawn: 0 };
  allJobs.forEach(j => { const s = j.status || 'saved'; if (counts[s] !== undefined) counts[s]++; });
  document.querySelectorAll('.myjobs-filter').forEach(btn => {
    const f = btn.dataset.filter;
    const countEl = btn.querySelector('.myjobs-filter-count');
    if (countEl && counts[f] !== undefined) {
      countEl.textContent = counts[f];
      countEl.style.display = counts[f] > 0 ? '' : 'none';
    }
  });
}

// ─── Interview Prep (full-page view) ─────────────────────────────────────────

/** Currently active prep job ID, or null if prep view is closed. */
let _prepJobId = null;
/** Current prep session (loaded from storage on open, updated on each action). */
let _prepSession = null;
/** Active countdown timer interval ID. */
let _prepTimerInterval = null;
/** Seconds remaining on current countdown. */
let _prepTimerSeconds = 0;
/** Index of question currently being answered. */
let _prepCurrentQIdx = -1;

const scoreColor = (s) => s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';
const qScoreColor = (s) => s >= 7 ? '#22c55e' : s >= 4 ? '#f59e0b' : '#ef4444';

/**
 * Opens the interview prep view for a given job.
 * Hides My Jobs, shows prep tab, loads job data and existing session.
 */
async function openPrepView(jobId) {
  const job = _allJobs.find(j => j.id === jobId);
  if (!job) { showToast('Job not found.', 'error'); return; }

  _prepJobId = jobId;

  // Switch tabs: hide applied, show prep
  document.getElementById('tab-applied').classList.remove('active');
  document.getElementById('tab-prep').classList.add('active');

  // Hide floating save bar
  const saveBar = document.getElementById('floatingSaveBar');
  if (saveBar) saveBar.style.display = 'none';

  // Update header title
  if (_headerTitle) _headerTitle.textContent = 'Interview Prep';

  // Populate job header
  const scorePct = job.score || 0;
  const scoreEl = document.getElementById('prepJobScore');
  scoreEl.textContent = scorePct + '%';
  scoreEl.style.background = scoreColor(scorePct);
  document.getElementById('prepJobTitle').textContent = job.title || 'Unknown Role';
  document.getElementById('prepJobCompany').textContent = job.company || 'Unknown Company';

  // Show notice if no JD
  const hasJD = !!(job.jdText && job.jdText.length > 50) || !!(job.jdDigest);
  document.getElementById('prepNoJd').style.display = hasJD ? 'none' : '';

  // Reset all sub-views to start state
  document.getElementById('prepStartView').style.display = '';
  document.getElementById('prepQuestionList').style.display = 'none';
  document.getElementById('prepAnswerView').style.display = 'none';
  document.getElementById('prepFeedbackView').style.display = 'none';
  document.getElementById('prepAnalyticsView').style.display = 'none';
  clearPrepTimer();

  // Check for existing session
  try {
    const session = await sendMessage({ type: 'GET_INTERVIEW_SESSION', jobId });
    if (session && session.questions && session.questions.length > 0) {
      _prepSession = session;
      renderPrepQuestionList();
    } else {
      _prepSession = null;
    }
  } catch {
    _prepSession = null;
  }
}

/** Closes the prep view and returns to My Jobs. */
function closePrepView() {
  clearPrepTimer();
  _prepJobId = null;
  _prepSession = null;
  _prepCurrentQIdx = -1;

  document.getElementById('tab-prep').classList.remove('active');
  document.getElementById('tab-applied').classList.add('active');

  if (_headerTitle) _headerTitle.textContent = 'My Jobs';
}

/** Clears the countdown timer if running. */
function clearPrepTimer() {
  if (_prepTimerInterval) {
    clearInterval(_prepTimerInterval);
    _prepTimerInterval = null;
  }
}

// ── Wire static prep UI buttons ──

document.getElementById('prepBackBtn').addEventListener('click', closePrepView);

document.getElementById('prepBackToList').addEventListener('click', () => {
  clearPrepTimer();
  document.getElementById('prepAnswerView').style.display = 'none';
  document.getElementById('prepFeedbackView').style.display = 'none';
  document.getElementById('prepQuestionList').style.display = '';
  renderPrepQuestionList();
});

document.getElementById('prepAnswerInput').addEventListener('input', (e) => {
  const words = e.target.value.trim().split(/\s+/).filter(Boolean).length;
  document.getElementById('prepWordCount').textContent = words + ' words';
});

// ── Prep view helpers ──

/** Shows one prep sub-view and hides all others. */
function showPrepSubView(view) {
  const views = ['prepStartView', 'prepQuestionList', 'prepAnswerView', 'prepFeedbackView', 'prepAnalyticsView'];
  views.forEach(id => { document.getElementById(id).style.display = 'none'; });
  const map = {
    start: 'prepStartView', questionList: 'prepQuestionList',
    answer: 'prepAnswerView', feedback: 'prepFeedbackView',
    analytics: 'prepAnalyticsView',
  };
  document.getElementById(map[view]).style.display = '';
}

/** Starts countdown timer for the answer view. */
function startPrepTimer(seconds, onExpire) {
  clearPrepTimer();
  _prepTimerSeconds = seconds;
  const timerEl = document.getElementById('prepTimer');
  const controlsEl = document.getElementById('prepTimerControls');
  timerEl.style.display = '';
  controlsEl.style.display = 'flex';
  updatePrepTimerDisplay();

  let paused = false;
  const pauseBtn = document.getElementById('prepTimerPause');
  pauseBtn.textContent = 'Pause';
  pauseBtn.onclick = () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  };

  _prepTimerInterval = setInterval(() => {
    if (paused) return;
    _prepTimerSeconds--;
    updatePrepTimerDisplay();
    if (_prepTimerSeconds <= 0) {
      clearPrepTimer();
      if (onExpire) onExpire();
    }
  }, 1000);
}

function updatePrepTimerDisplay() {
  const timerEl = document.getElementById('prepTimer');
  if (!timerEl) return;
  const mins = Math.floor(Math.max(0, _prepTimerSeconds) / 60);
  const secs = Math.max(0, _prepTimerSeconds) % 60;
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
  timerEl.className = 'prep-timer';
  const total = _prepSession?.questions[_prepCurrentQIdx]?.timeLimitSec || 120;
  const pct = _prepTimerSeconds / total;
  if (pct <= 0.25) timerEl.classList.add('danger');
  else if (pct <= 0.5) timerEl.classList.add('warning');
}

// ── Generate questions ──

document.getElementById('prepGenerateBtn').addEventListener('click', async () => {
  const categories = [];
  document.querySelectorAll('#prepCategories input:checked').forEach(cb => categories.push(cb.value));
  if (categories.length === 0) { showToast('Select at least one category.', 'error'); return; }

  const btn = document.getElementById('prepGenerateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">hourglass_top</span> Generating questions...';

  try {
    const job = _allJobs.find(j => j.id === _prepJobId);
    const session = await sendMessage({
      type: 'GENERATE_INTERVIEW_QUESTIONS',
      jobId: _prepJobId,
      jobUrl: job?.url || '',
      categories,
    });
    _prepSession = session;
    renderPrepQuestionList();
  } catch (err) {
    showToast('Failed to generate questions: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">auto_awesome</span> Generate Questions';
  }
});

// ── Render question list ──

function renderPrepQuestionList() {
  if (!_prepSession) return;
  const listEl = document.getElementById('prepQList');
  const progressEl = document.getElementById('prepProgress');
  const analyticsBtn = document.getElementById('prepAnalyticsBtn');
  listEl.innerHTML = '';

  const questions = _prepSession.questions || [];
  const answered = questions.filter(q => q.evaluation).length;
  progressEl.textContent = `${answered} of ${questions.length} answered`;
  analyticsBtn.disabled = answered < 3;

  questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'prep-qcard';
    card.style.cursor = 'pointer';

    let scoreHTML = '';
    if (q.evaluation) {
      const s = q.evaluation.score;
      scoreHTML = `<div class="prep-qcard-score" style="background:${qScoreColor(s)}">${s}</div>`;
    }

    card.innerHTML = `
      <div class="prep-qcard-body">
        <div class="prep-qcard-top">
          ${q.isFollowUp ? '<span style="font-size:12px;color:var(--ac-text-muted);">&#8627; Follow-up</span>' : ''}
          <span class="prep-qcard-pill ${q.category}">${escapeHTML(q.category)}</span>
          <span class="prep-qcard-diff">${escapeHTML(q.difficulty || '')}</span>
        </div>
        <div class="prep-qcard-text">${escapeHTML(q.question)}</div>
      </div>
      ${scoreHTML}
      <div class="prep-qcard-actions">
        <button class="btn btn-sm ${q.evaluation ? 'btn-secondary' : 'btn-primary'}">${q.evaluation ? 'Review' : 'Answer'}</button>
      </div>
    `;

    card.addEventListener('click', () => {
      _prepCurrentQIdx = idx;
      if (q.evaluation) {
        renderPrepFeedbackView(q);
      } else {
        renderPrepAnswerView(q);
      }
    });

    listEl.appendChild(card);
  });

  showPrepSubView('questionList');
}

// ── Answer view ──

function renderPrepAnswerView(question) {
  const headerEl = document.getElementById('prepAnsHeader');
  const questionEl = document.getElementById('prepAnsQuestion');
  const hintsListEl = document.getElementById('prepHintsList');
  const inputEl = document.getElementById('prepAnswerInput');
  const wordCountEl = document.getElementById('prepWordCount');

  headerEl.innerHTML = `
    <span class="prep-qcard-pill ${question.category}">${escapeHTML(question.category)}</span>
    <span class="prep-qcard-diff">${escapeHTML(question.difficulty || '')}</span>
  `;
  questionEl.textContent = question.question;

  hintsListEl.innerHTML = '';
  (question.keyPoints || []).forEach(kp => {
    const li = document.createElement('li');
    li.textContent = kp;
    hintsListEl.appendChild(li);
  });

  inputEl.value = question.userAnswer || '';
  wordCountEl.textContent = '0 words';

  // Timer
  const timerEnabled = document.getElementById('prepTimerEnabled')?.checked !== false;
  if (timerEnabled) {
    startPrepTimer(question.timeLimitSec || 120, () => submitPrepAnswer());
  } else {
    document.getElementById('prepTimer').style.display = 'none';
    document.getElementById('prepTimerControls').style.display = 'none';
  }

  showPrepSubView('answer');
  inputEl.focus();
}

// ── Submit answer ──

document.getElementById('prepSubmitAnswer').addEventListener('click', submitPrepAnswer);

async function submitPrepAnswer() {
  if (_prepCurrentQIdx < 0 || !_prepSession) return;
  const inputEl = document.getElementById('prepAnswerInput');
  const answer = inputEl.value.trim();
  if (!answer) { showToast('Please type an answer before submitting.', 'error'); return; }

  clearPrepTimer();
  const q = _prepSession.questions[_prepCurrentQIdx];
  const timerEnabled = document.getElementById('prepTimerEnabled')?.checked !== false;
  const totalTime = q.timeLimitSec || 120;
  const timeSpent = timerEnabled ? (totalTime - Math.max(0, _prepTimerSeconds)) : 0;

  const btn = document.getElementById('prepSubmitAnswer');
  btn.disabled = true;
  btn.textContent = 'Evaluating...';

  try {
    const result = await sendMessage({
      type: 'EVALUATE_INTERVIEW_ANSWER',
      jobId: _prepJobId,
      questionId: q.id,
      question: q.question,
      userAnswer: answer,
      category: q.category,
      keyPoints: q.keyPoints,
      timeSpentSec: timeSpent,
    });

    // Update local session
    q.userAnswer = answer;
    q.timeSpentSec = timeSpent;
    q.answeredAt = Date.now();
    q.evaluation = result.evaluation;
    _prepSession.analytics = result.analytics;

    renderPrepFeedbackView(q);
  } catch (err) {
    showToast('Evaluation failed: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Answer';
  }
}

// ── Feedback view ──

function renderPrepFeedbackView(question) {
  if (!question.evaluation) return;
  const eval_ = question.evaluation;
  const score = eval_.score;

  const circleEl = document.getElementById('prepScoreCircle');
  circleEl.textContent = score + '/10';
  circleEl.style.background = qScoreColor(score);

  const timeBadge = document.getElementById('prepTimeBadge');
  if (question.timeSpentSec != null) {
    const limit = question.timeLimitSec || 120;
    timeBadge.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;">timer</span> ${question.timeSpentSec}s (${Math.floor(limit / 60)}:${(limit % 60).toString().padStart(2, '0')} limit)`;
  } else {
    timeBadge.textContent = '';
  }

  document.getElementById('prepFeedbackQuestion').textContent = question.question;

  const strengthsList = document.getElementById('prepStrengthsList');
  strengthsList.innerHTML = '';
  (eval_.strengths || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    strengthsList.appendChild(li);
  });

  const improvementsList = document.getElementById('prepImprovementsList');
  improvementsList.innerHTML = '';
  (eval_.improvements || []).forEach(s => {
    const li = document.createElement('li');
    li.textContent = s;
    improvementsList.appendChild(li);
  });

  document.getElementById('prepSampleAnswer').textContent = eval_.sampleAnswer || '';

  // Follow-up banner: show if score < 5
  document.getElementById('prepFollowUpBanner').style.display = score < 5 ? 'flex' : 'none';

  showPrepSubView('feedback');
}

// ── Follow-up question ──

document.getElementById('prepFollowUpBtn').addEventListener('click', async () => {
  if (_prepCurrentQIdx < 0 || !_prepSession) return;
  const q = _prepSession.questions[_prepCurrentQIdx];
  const btn = document.getElementById('prepFollowUpBtn');
  btn.disabled = true;
  btn.textContent = 'Generating...';

  try {
    const result = await sendMessage({
      type: 'GENERATE_FOLLOWUP_QUESTION',
      jobId: _prepJobId,
      parentQuestionId: q.id,
      question: q.question,
      userAnswer: q.userAnswer,
      evaluation: q.evaluation,
      category: q.category,
    });
    _prepSession = result.session;
    renderPrepQuestionList();
  } catch (err) {
    showToast('Follow-up generation failed: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Practice Follow-Up';
  }
});

// ── Next question / Try again ──

document.getElementById('prepNextQuestion').addEventListener('click', () => {
  if (!_prepSession) return;
  const questions = _prepSession.questions;
  // Find next unanswered after current
  let nextIdx = -1;
  for (let i = _prepCurrentQIdx + 1; i < questions.length; i++) {
    if (!questions[i].evaluation) { nextIdx = i; break; }
  }
  // Wrap around
  if (nextIdx < 0) {
    for (let i = 0; i < _prepCurrentQIdx; i++) {
      if (!questions[i].evaluation) { nextIdx = i; break; }
    }
  }
  if (nextIdx >= 0) {
    _prepCurrentQIdx = nextIdx;
    renderPrepAnswerView(questions[nextIdx]);
  } else {
    // All answered — go to question list
    renderPrepQuestionList();
  }
});

document.getElementById('prepTryAgain').addEventListener('click', () => {
  if (!_prepSession || _prepCurrentQIdx < 0) return;
  const q = _prepSession.questions[_prepCurrentQIdx];
  renderPrepAnswerView(q);
});

// ── Analytics button (from question list header) ──

document.getElementById('prepAnalyticsBtn').addEventListener('click', () => {
  if (_prepSession) renderPrepAnalytics();
});

document.getElementById('prepAnalyticsBack').addEventListener('click', () => {
  renderPrepQuestionList();
});

// ── Analytics view ──

function renderPrepAnalytics() {
  if (!_prepSession) return;
  const analytics = _prepSession.analytics || {};

  // Readiness circle
  const readiness = analytics.overallReadiness || 0;
  const readinessEl = document.getElementById('prepReadinessCircle');
  readinessEl.textContent = readiness + '%';
  readinessEl.style.background = scoreColor(readiness);

  // Stats grid
  const statsGrid = document.getElementById('prepStatsGrid');
  statsGrid.innerHTML = `
    <div class="prep-stat-card">
      <div class="prep-stat-value">${analytics.questionsAnswered || 0}/${analytics.questionsTotal || 0}</div>
      <div class="prep-stat-label">Questions answered</div>
    </div>
    <div class="prep-stat-card">
      <div class="prep-stat-value">${analytics.avgTimePerAnswer ? Math.round(analytics.avgTimePerAnswer) + 's' : '--'}</div>
      <div class="prep-stat-label">Avg time per answer</div>
    </div>
    <div class="prep-stat-card">
      <div class="prep-stat-value">${analytics.followUpsGenerated || 0}</div>
      <div class="prep-stat-label">Follow-ups generated</div>
    </div>
  `;

  // Category bars
  const barsEl = document.getElementById('prepCategoryBars');
  barsEl.innerHTML = '';
  const cats = analytics.categoryScores || {};
  for (const [cat, pct] of Object.entries(cats)) {
    const label = cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    barsEl.innerHTML += `
      <div class="prep-bar-row">
        <div class="prep-bar-label">${escapeHTML(label)}</div>
        <div class="prep-bar-track"><div class="prep-bar-fill" style="width:${pct}%;background:${scoreColor(pct)}"></div></div>
        <div class="prep-bar-value">${pct}%</div>
      </div>
    `;
  }

  // Weak areas
  const weakCard = document.getElementById('prepWeakAreasCard');
  const weakList = document.getElementById('prepWeakAreasList');
  const weakAreas = analytics.weakAreas || [];
  if (weakAreas.length > 0) {
    weakCard.style.display = '';
    weakList.innerHTML = '';
    weakAreas.forEach(w => {
      const li = document.createElement('li');
      li.textContent = w;
      weakList.appendChild(li);
    });
  } else {
    weakCard.style.display = 'none';
  }

  // Positioning advice (if already generated)
  const posCard = document.getElementById('prepPositioningCard');
  const posContent = document.getElementById('prepPositioningContent');
  const reportBtn = document.getElementById('prepFullReportBtn');
  if (analytics.positioningAdvice) {
    posCard.style.display = '';
    posContent.textContent = analytics.positioningAdvice;
    reportBtn.style.display = '';
  } else {
    posCard.style.display = 'none';
    reportBtn.style.display = 'none';
  }

  // Enable/disable positioning button
  const posBtn = document.getElementById('prepPositioningBtn');
  posBtn.disabled = (analytics.questionsAnswered || 0) < 5;

  showPrepSubView('analytics');
}

// ── Positioning advice ──

document.getElementById('prepPositioningBtn').addEventListener('click', async () => {
  const btn = document.getElementById('prepPositioningBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">hourglass_top</span> Generating...';

  try {
    const result = await sendMessage({
      type: 'GENERATE_POSITIONING_ADVICE',
      jobId: _prepJobId,
    });

    // Update local session
    if (!_prepSession.analytics) _prepSession.analytics = {};
    _prepSession.analytics.positioningAdvice = result;

    // Re-render analytics to show the advice
    renderPrepAnalytics();
  } catch (err) {
    showToast('Positioning advice failed: ' + (err.message || err), 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:18px;">auto_awesome</span> Generate Positioning Advice';
  }
});

// ── Full report link ──

document.getElementById('prepFullReportBtn').addEventListener('click', () => {
  window.location.hash = 'interview-prep-report&jobId=' + _prepJobId;
  window.location.reload();
});

// ─── Profile slot management ──────────────────────────────────────────────────
// Three named resume slots allow the user to maintain separate profiles for
// different types of job (e.g. engineering, management, consulting).
// The active slot's data is kept in sync with `profileData`; switching slots
// saves the current profile via a deep-copy, then loads the target slot's data.

/**
 * Index of the currently active resume slot (0, 1, or 2).
 * @type {number}
 */
let activeSlot = 0;

/**
 * Array of up to three saved profile snapshots.  null means the slot is empty.
 * Persisted as 'profileSlots' in chrome.storage.local.
 * @type {(Object|null)[]}
 */
let profileSlots = [null, null, null];

/**
 * Display names for the three slots.  Persisted as 'slotNames' in
 * chrome.storage.local and editable via the slot name input.
 * @type {string[]}
 */
let slotNames = ['Resume 1', 'Resume 2', 'Resume 3'];

/**
 * Reads the plain-text header fields from the DOM form back into `profileData`.
 * Called before snapshot-copying the active slot, so the snapshot captures any
 * unsaved edits the user may have typed since the last explicit save.
 */
function syncCurrentProfileFromForm() {
  profileData.name     = document.getElementById('pName').value.trim();
  profileData.email    = document.getElementById('pEmail').value.trim();
  profileData.phone    = document.getElementById('pPhone').value.trim();
  profileData.location = document.getElementById('pLocation').value.trim();
  profileData.linkedin = document.getElementById('pLinkedin').value.trim();
  profileData.website  = document.getElementById('pWebsite').value.trim();
  profileData.summary  = document.getElementById('pSummary').value.trim();
}

/**
 * Legacy slot button updater — now delegates to renderResumeCards.
 */
function updateSlotButtons() {
  renderResumeCards();
}

/**
 * Renders resume cards into #resumeCardsContainer.
 * Reads from chrome.storage.local key `resumes` (array of
 * { id, fileName, text, uploadDate, isPrimary }).
 * Active/primary card gets sage border + "PRIMARY" badge.
 * Max 10 resumes. Upload zone card is always last.
 */
async function renderResumeCards() {
  const container = document.getElementById('resumeCardsContainer');
  if (!container) return;

  const result = await chrome.storage.local.get('resumes');
  const resumes = result.resumes || [];

  let html = '';
  resumes.forEach((r, i) => {
    const isPrimary = r.isPrimary === true;
    const activeClass = isPrimary ? ' active' : '';
    const badge = isPrimary ? '<span class="primary-badge">Primary</span>' : '';
    const date = r.uploadDate ? new Date(r.uploadDate).toLocaleDateString() : '';
    const fname = escapeHTML(r.fileName || 'Resume ' + (i + 1));
    const deleteBtn = !isPrimary ? `<button class="resume-card-delete" data-resume-idx="${i}" aria-label="Delete ${fname}"><span class="material-symbols-outlined" style="font-size:16px;">close</span></button>` : '';
    const hasText = !!(r.text && r.text.length > 20);
    html += `
    <div class="resume-card${activeClass}" data-resume-idx="${i}" role="button" tabindex="0"
         aria-label="${fname}${isPrimary ? ' (primary)' : ''} — click to set as primary">
      ${badge}
      ${deleteBtn}
      <div class="resume-card-icon material-symbols-outlined" aria-hidden="true">description</div>
      <div class="resume-card-name">${fname}</div>
      <div class="resume-card-date">${date}</div>
      ${hasText ? `<button class="resume-card-preview" data-resume-idx="${i}" aria-label="Preview ${fname}">Preview</button>` : ''}
    </div>`;
  });

  // Build a fresh upload zone (always clean "Upload New" state)
  html += `
    <div class="upload-zone" id="uploadZone">
      <span class="upload-zone-icon material-symbols-outlined">upload</span>
      <span class="upload-zone-text">Upload New</span>
      <span class="upload-zone-hint">PDF or DOCX</span>
    </div>`;

  container.innerHTML = html;

  // Upload zone events are handled by delegated listeners on resumeCardsCont (module scope).
  // No per-render re-attachment needed.

  // Click to set as primary
  container.querySelectorAll('.resume-card').forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('.resume-card-delete')) return; // Don't trigger on delete
      const idx = parseInt(card.dataset.resumeIdx);
      const stored = await chrome.storage.local.get('resumes');
      const arr = stored.resumes || [];
      arr.forEach((r, i) => { r.isPrimary = (i === idx); });
      await chrome.storage.local.set({ resumes: arr });
      // Update active profile's resumeFileName
      if (arr[idx]) {
        profileData.resumeFileName = arr[idx].fileName;
      }
      renderResumeCards();
      showToast('Primary resume updated.', 'success');
    });
  });

  // Delete buttons
  container.querySelectorAll('.resume-card-delete').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.resumeIdx);
      const stored = await chrome.storage.local.get('resumes');
      const arr = stored.resumes || [];
      arr.splice(idx, 1);
      // If we deleted the primary, make the first one primary
      if (arr.length > 0 && !arr.some(r => r.isPrimary)) {
        arr[0].isPrimary = true;
      }
      await chrome.storage.local.set({ resumes: arr });
      renderResumeCards();
      showToast('Resume deleted.', 'success');
    });
  });

  // Preview buttons
  container.querySelectorAll('.resume-card-preview').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      previewResume(parseInt(btn.dataset.resumeIdx));
    });
  });
}

/**
 * Loads the multi-slot state from chrome.storage.local and refreshes the UI.
 * Called during init.  Silently ignores storage errors (extension context loss,
 * incognito mode, etc.).
 */
async function loadProfileSlots() {
  try {
    const result = await chrome.storage.local.get(['profileSlots', 'activeProfileSlot', 'slotNames', 'resumes']);

    // Migration: old profileSlots → new resumes array
    if (!result.resumes && result.profileSlots) {
      const oldSlots = result.profileSlots;
      const oldActive = result.activeProfileSlot || 0;
      const migrated = [];
      oldSlots.forEach((slot, i) => {
        if (slot && slot.resumeFileName) {
          migrated.push({
            id: Date.now().toString(36) + i,
            fileName: slot.resumeFileName,
            text: slot.resumeText || '',
            uploadDate: new Date().toISOString(),
            isPrimary: i === oldActive
          });
        }
      });
      if (migrated.length > 0) {
        // Ensure at least one is primary
        if (!migrated.some(r => r.isPrimary)) migrated[0].isPrimary = true;
        await chrome.storage.local.set({ resumes: migrated });
      }
    }

    profileSlots = result.profileSlots || [null, null, null];
    activeSlot   = result.activeProfileSlot || 0;
    slotNames    = result.slotNames || ['Resume 1', 'Resume 2', 'Resume 3'];

    // If the active slot has resume info, show it in the upload zone
    const slotData = profileSlots[activeSlot];
    if (slotData && slotData.resumeFileName) {
      profileData.resumeFileName = slotData.resumeFileName;
      profileData.resumeText = slotData.resumeText || null;
    }

    updateSlotButtons();
  } catch (e) { /* ignore */ }
}

/**
 * Slot button click handler.
 * Switching slots involves three steps:
 *   1. Snapshot the current profile (with any unsaved form edits) into the old slot.
 *   2. Load the new slot's profile (or blank it if the slot is empty).
 *   3. Persist the updated slots + active index to chrome.storage.local so the
 *      background service worker also sees the newly active profile.
 */
document.querySelectorAll('.profile-slot-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    const newSlot = parseInt(btn.dataset.slot);
    if (newSlot === activeSlot) return;

    // Profile data (name, email, skills, experience, etc.) is GLOBAL — never changes on slot switch.
    // Only the resume document (uploaded file + parsed text) is per-slot.
    // Save current resume doc info to old slot before switching.
    const currentResumeInfo = {
      resumeFileName: profileData.resumeFileName || null,
      resumeText: profileData.resumeText || null,
    };
    profileSlots[activeSlot] = currentResumeInfo;

    activeSlot = newSlot;
    const slotData = profileSlots[activeSlot];

    if (slotData && slotData.resumeFileName) {
      // Slot has a resume — update only the resume fields on profileData
      profileData.resumeFileName = slotData.resumeFileName;
      profileData.resumeText = slotData.resumeText || null;
    } else {
      // Slot is empty — clear resume fields, keep profile intact
      profileData.resumeFileName = null;
      profileData.resumeText = null;
      document.getElementById('uploadZone').innerHTML = `
        <div class="icon"><span class="material-symbols-outlined">description</span></div>
        <div class="text">Drag & drop your resume or click to browse</div>
        <div class="hint">Supports PDF and DOCX</div>`;
    }

    // Persist: profile stays the same, only slot index + resume slots change
    await chrome.storage.local.set({
      profileSlots,
      activeProfileSlot: activeSlot,
      profile: profileData,  // always the same global profile
    });
    updateSlotButtons();
    showToast(`Switched to ${slotNames[activeSlot]}.`, 'info');
  });
});

/**
 * "Save Name" button handler for the slot rename input.
 * Updates the slotNames array, persists it, and refreshes the slot buttons.
 */
document.getElementById('saveSlotNameBtn').addEventListener('click', async () => {
  const name = document.getElementById('slotNameInput').value.trim();
  if (!name) return;
  slotNames[activeSlot] = name;
  await chrome.storage.local.set({ slotNames });
  updateSlotButtons();
  showToast('Profile renamed.', 'success');
});

// ─── Stats dashboard ──────────────────────────────────────────────────────────

/**
 * Computes and renders the stats dashboard by reading directly from
 * chrome.storage.local — specifically two keys:
 *
 *   ac_analysisCache  — Object keyed by URL, each value containing
 *                       { analysis: { matchScore, missingSkills, ... } }
 *   appliedJobs       — Array of applied-job records (used only for the count)
 *
 * Derived metrics:
 *   - Total jobs analyzed  (count of cache entries)
 *   - Total jobs applied   (length of appliedJobs array)
 *   - Average match score  (mean of all numeric matchScore values in cache)
 *   - Score distribution   (green >= 70, amber 45-69, red < 45)
 *   - Top missing skills   (aggregated across all cached analyses, top 8 by frequency)
 *
 * The skill frequency bars are rendered relative to the most-frequent missing
 * skill (which gets a 100% width bar; all others are proportional).
 */
/**
 * Stats dashboard — removed in Stitch redesign. No-op to avoid errors.
 */
async function renderStats() {
  // Stats tab removed in new design — no-op
}

// ─── Interview Prep Full-Page Report ──────────────────────────────────────────

async function renderInterviewPrepReport(jobId) {
  // Hide the normal profile UI and show report
  document.querySelector('.container').style.display = 'none';

  // Create report container if not exists
  let reportEl = document.getElementById('interviewPrepReport');
  if (!reportEl) {
    reportEl = document.createElement('div');
    reportEl.id = 'interviewPrepReport';
    document.body.appendChild(reportEl);
  }

  reportEl.innerHTML = '<p style="text-align:center;padding:40px;color:var(--ac-text-secondary);">Loading report...</p>';

  try {
    const result = await chrome.storage.local.get('interviewPrepSessions');
    const sessions = result.interviewPrepSessions || {};
    const session = sessions[jobId];
    if (!session) {
      reportEl.innerHTML = '<p style="text-align:center;padding:40px;color:#dc2626;">Session not found. Complete an interview prep session first.</p>';
      return;
    }

    const analytics = session.analytics || {};
    const answered = session.questions.filter(q => q.evaluation);

    // Score color helper
    const scoreColor = (s) => s >= 70 ? '#22c55e' : s >= 40 ? '#f59e0b' : '#ef4444';
    const qScoreColor = (s) => s >= 7 ? '#22c55e' : s >= 4 ? '#f59e0b' : '#ef4444';

    let html = `
      <style>
        #interviewPrepReport {
          max-width: 800px; margin: 0 auto; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          color: var(--ac-text); background: var(--ac-bg);
        }
        .ipr-action-bar {
          position: sticky; top: 0; z-index: 10; background: var(--ac-bg);
          padding: 12px 0; border-bottom: 1px solid var(--ac-border);
          display: flex; gap: 8px; justify-content: flex-end;
        }
        .ipr-action-btn {
          padding: 6px 16px; border-radius: 6px; border: 1px solid var(--ac-border);
          cursor: pointer; font-size: 13px; background: var(--ac-card-bg); color: var(--ac-text);
        }
        .ipr-action-btn.primary { background: var(--ac-primary); color: #fff; border: none; }
        .ipr-action-btn:hover { opacity: 0.85; }
        .ipr-header { text-align: center; margin: 24px 0; }
        .ipr-header h1 { font-size: 22px; margin-bottom: 4px; }
        .ipr-header p { color: var(--ac-text-secondary); font-size: 14px; }
        .ipr-readiness { text-align: center; margin: 20px 0; }
        .ipr-readiness-circle {
          width: 90px; height: 90px; border-radius: 50%; display: inline-flex;
          align-items: center; justify-content: center; font-size: 30px; font-weight: 700; color: #fff;
        }
        .ipr-section { margin: 24px 0; }
        .ipr-section h2 { font-size: 16px; border-bottom: 2px solid var(--ac-primary); padding-bottom: 6px; margin-bottom: 12px; }
        .ipr-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .ipr-bar-label { width: 100px; font-size: 13px; color: var(--ac-text-secondary); }
        .ipr-bar-track { flex: 1; height: 12px; background: var(--ac-border); border-radius: 6px; overflow: hidden; }
        .ipr-bar-fill { height: 100%; border-radius: 6px; }
        .ipr-bar-value { width: 40px; text-align: right; font-size: 13px; font-weight: 600; }
        .ipr-q-card {
          background: var(--ac-card-bg); border: 1px solid var(--ac-border);
          border-radius: 8px; padding: 16px; margin-bottom: 12px;
        }
        .ipr-q-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
        .ipr-q-pill { padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; text-transform: uppercase; }
        .ipr-q-score { margin-left: auto; font-size: 14px; font-weight: 700; color: #fff; padding: 2px 10px; border-radius: 4px; }
        .ipr-q-question { font-size: 14px; font-weight: 500; margin-bottom: 8px; }
        .ipr-q-answer-label { font-size: 11px; font-weight: 600; color: var(--ac-text-muted); text-transform: uppercase; margin-bottom: 4px; }
        .ipr-q-answer { font-size: 13px; color: var(--ac-text-secondary); line-height: 1.5; white-space: pre-wrap; margin-bottom: 8px; padding: 8px; background: var(--ac-bg); border-radius: 4px; }
        .ipr-advice { white-space: pre-wrap; font-size: 14px; line-height: 1.7; color: var(--ac-text-secondary); }
        .ipr-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
        .ipr-stat { text-align: center; padding: 12px; background: var(--ac-card-bg); border-radius: 8px; border: 1px solid var(--ac-border); }
        .ipr-stat-value { font-size: 20px; font-weight: 700; color: var(--ac-text); }
        .ipr-stat-label { font-size: 11px; color: var(--ac-text-muted); }
        @media print {
          .ipr-action-bar { display: none !important; }
          #interviewPrepReport { padding: 0; }
        }
      </style>

      <div class="ipr-action-bar">
        <button class="ipr-action-btn" id="iprCopySummary">Copy Summary</button>
        <button class="ipr-action-btn primary" id="iprPrint">Print Report</button>
      </div>

      <div class="ipr-header">
        <h1>${escapeHTML(session.jobTitle)}</h1>
        <p>${escapeHTML(session.company)} &middot; ${new Date(session.createdAt).toLocaleDateString()}</p>
      </div>

      <div class="ipr-readiness">
        <div class="ipr-readiness-circle" style="background:${scoreColor(analytics.overallReadiness || 0)}">
          ${analytics.overallReadiness || 0}%
        </div>
        <p style="margin-top:8px;color:var(--ac-text-secondary);font-size:13px;">Interview Readiness Score</p>
      </div>

      <div class="ipr-stats">
        <div class="ipr-stat"><div class="ipr-stat-value">${analytics.questionsAnswered || 0}/${analytics.questionsTotal || 0}</div><div class="ipr-stat-label">Questions Answered</div></div>
        <div class="ipr-stat"><div class="ipr-stat-value">${analytics.avgTimePerAnswer ? analytics.avgTimePerAnswer + 's' : '--'}</div><div class="ipr-stat-label">Avg. Time</div></div>
        <div class="ipr-stat"><div class="ipr-stat-value">${analytics.followUpsGenerated || 0}</div><div class="ipr-stat-label">Follow-ups</div></div>
      </div>
    `;

    // Category breakdown
    const cats = [
      { key: 'behavioral', label: 'Behavioral', color: '#3b82f6' },
      { key: 'technical', label: 'Technical', color: '#8b5cf6' },
      { key: 'situational', label: 'Situational', color: '#f97316' },
      { key: 'role-specific', label: 'Role-Specific', color: '#22c55e' },
    ];
    html += '<div class="ipr-section"><h2>Category Scores</h2>';
    cats.forEach(cat => {
      const val = analytics.categoryScores?.[cat.key];
      html += `<div class="ipr-bar-row">
        <span class="ipr-bar-label">${cat.label}</span>
        <div class="ipr-bar-track"><div class="ipr-bar-fill" style="width:${val || 0}%;background:${cat.color}"></div></div>
        <span class="ipr-bar-value">${val != null ? val + '%' : '--'}</span>
      </div>`;
    });
    html += '</div>';

    // Question-by-question review
    html += '<div class="ipr-section"><h2>Question-by-Question Review</h2>';
    answered.forEach(q => {
      const pillColors = { behavioral: '#dbeafe;color:#1d4ed8', technical: '#ede9fe;color:#6d28d9', situational: '#ffedd5;color:#c2410c', 'role-specific': '#dcfce7;color:#15803d' };
      html += `<div class="ipr-q-card">
        <div class="ipr-q-header">
          <span class="ipr-q-pill" style="background:${(pillColors[q.category] || '#dbeafe;color:#1d4ed8').split(';')[0]};${(pillColors[q.category] || '').split(';')[1] || ''}">${escapeHTML(q.category)}</span>
          <span style="font-size:11px;color:var(--ac-text-muted)">${q.difficulty} &middot; ${q.timeSpentSec || 0}s</span>
          <span class="ipr-q-score" style="background:${qScoreColor(q.evaluation.score)}">${q.evaluation.score}/10</span>
        </div>
        <div class="ipr-q-question">${escapeHTML(q.question)}</div>
        <div class="ipr-q-answer-label">Your Answer</div>
        <div class="ipr-q-answer">${escapeHTML(q.userAnswer || '')}</div>
        <div class="ipr-q-answer-label">Sample Answer</div>
        <div class="ipr-q-answer">${escapeHTML(q.evaluation.sampleAnswer || '')}</div>
      </div>`;
    });
    html += '</div>';

    // Weak areas
    if (analytics.weakAreas?.length > 0) {
      html += '<div class="ipr-section"><h2>Areas to Focus On</h2><ul>';
      analytics.weakAreas.forEach(w => { html += `<li style="margin-bottom:4px;color:var(--ac-text-secondary)">${escapeHTML(w)}</li>`; });
      html += '</ul></div>';
    }

    // Positioning advice
    if (analytics.positioningAdvice) {
      html += `<div class="ipr-section"><h2>Positioning Strategy</h2><div class="ipr-advice">${escapeHTML(analytics.positioningAdvice)}</div></div>`;
    }

    // Time analysis
    if (answered.length > 0) {
      html += '<div class="ipr-section"><h2>Time Analysis</h2>';
      cats.forEach(cat => {
        const catQs = answered.filter(q => q.category === cat.key && q.timeSpentSec != null);
        if (catQs.length > 0) {
          const avg = Math.round(catQs.reduce((s, q) => s + q.timeSpentSec, 0) / catQs.length);
          const avgLimit = Math.round(catQs.reduce((s, q) => s + (q.timeLimitSec || 120), 0) / catQs.length);
          html += `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;">
            <span>${cat.label}</span><span style="font-weight:600">${avg}s avg (${avgLimit}s limit)</span>
          </div>`;
        }
      });
      html += '</div>';
    }

    reportEl.innerHTML = html;

    // Wire buttons
    document.getElementById('iprPrint')?.addEventListener('click', () => window.print());
    document.getElementById('iprCopySummary')?.addEventListener('click', () => {
      const summary = [
        `Interview Prep Report: ${session.jobTitle} at ${session.company}`,
        `Readiness: ${analytics.overallReadiness}%`,
        `Questions: ${analytics.questionsAnswered}/${analytics.questionsTotal}`,
        `Avg Time: ${analytics.avgTimePerAnswer || '--'}s`,
        '',
        ...cats.map(c => `${c.label}: ${analytics.categoryScores?.[c.key] ?? '--'}%`),
        '',
        analytics.weakAreas?.length ? 'Weak Areas:\n' + analytics.weakAreas.map(w => '- ' + w).join('\n') : '',
      ].filter(Boolean).join('\n');
      navigator.clipboard.writeText(summary).then(() => {
        const btn = document.getElementById('iprCopySummary');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy Summary'; }, 1500); }
      });
    });

  } catch (err) {
    reportEl.innerHTML = `<p style="text-align:center;padding:40px;color:#dc2626;">Error: ${escapeHTML(err.message)}</p>`;
  }
}

// ─── Hash navigation ──────────────────────────────────────────────────────────

/**
 * Reads the URL fragment (e.g. "#settings") and activates the matching tab.
 * Allows external pages (popup, options, notifications) to deep-link directly
 * into a specific section of the profile page.
 * Only acts on known tab names; unknown hashes are silently ignored.
 */
function handleHash() {
  const hash      = window.location.hash.replace('#', '');

  // Interview Prep full-page report route
  if (hash.startsWith('interview-prep-report')) {
    const params = new URLSearchParams(hash.split('&').slice(1).join('&'));
    const jobId = params.get('jobId');
    if (jobId) renderInterviewPrepReport(jobId);
    return;
  }

  const validTabs = ['profile', 'applied', 'settings'];
  if (validTabs.includes(hash)) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    const tabBtn = document.querySelector('[data-tab="' + hash + '"]');
    const tabPanel = document.getElementById('tab-' + hash);
    if (tabBtn) tabBtn.classList.add('active');
    if (tabPanel) tabPanel.classList.add('active');
    if (hash === 'applied') loadAppliedJobs();
    // Show Save Profile bar only on User Context tab
    const saveBar = document.getElementById('floatingSaveBar');
    if (saveBar) saveBar.style.display = hash === 'profile' ? '' : 'none';
  }
}

// ─── Theme management ─────────────────────────────────────────────────────────

const THEME_ORDER_PROFILE = ['blue', 'dark', 'warm'];
const THEME_HEADER_COLORS = { blue: '#3b82f6', dark: '#1e3a5f', warm: '#d97706' };
const THEME_ICONS_PROFILE = { blue: '\u2600\uFE0F', dark: '\uD83C\uDF19', warm: '\uD83C\uDF3B' };

/**
 * Applies the given theme to the profile page body.
 * @param {string} theme - 'blue', 'dark', or 'warm'
 */
function applyProfileTheme(theme) {
  document.body.classList.remove('theme-dark', 'theme-warm');
  if (theme === 'dark') document.body.classList.add('theme-dark');
  if (theme === 'warm') document.body.classList.add('theme-warm');
  // Update the theme button indicator
  const btn = document.getElementById('profileThemeToggle');
  if (btn) {
    const nextIdx = (THEME_ORDER_PROFILE.indexOf(theme) + 1) % THEME_ORDER_PROFILE.length;
    const nextTheme = THEME_ORDER_PROFILE[nextIdx];
    btn.textContent = THEME_ICONS_PROFILE[theme] || THEME_ICONS_PROFILE.blue;
    const nextName = nextTheme === 'blue' ? 'Ocean Blue' : nextTheme === 'dark' ? 'Dark Mode' : 'Warm Amber';
    btn.title = `Switch to ${nextName}`;
  }
}

/**
 * Loads the saved theme from storage and applies it to the profile page.
 */
async function loadProfileTheme() {
  try {
    const result = await chrome.storage.local.get('ac_theme');
    const theme = result.ac_theme || 'blue';
    if (THEME_ORDER_PROFILE.includes(theme)) {
      applyProfileTheme(theme);
    }
  } catch (e) { /* ignore */ }
}

/**
 * Cycles to the next theme, saves it, and applies it.
 */
let _profileCurrentTheme = 'blue';
document.getElementById('profileThemeToggle').addEventListener('click', async () => {
  const result = await chrome.storage.local.get('ac_theme');
  _profileCurrentTheme = result.ac_theme || 'blue';
  const idx = THEME_ORDER_PROFILE.indexOf(_profileCurrentTheme);
  const nextTheme = THEME_ORDER_PROFILE[(idx + 1) % THEME_ORDER_PROFILE.length];
  _profileCurrentTheme = nextTheme;
  try {
    await chrome.storage.local.set({ ac_theme: nextTheme });
  } catch (e) { /* ignore */ }
  applyProfileTheme(nextTheme);
});

// Load theme immediately on page load
loadProfileTheme();

// ─── Inline editing for data-intake-field elements ──────────────────────────

/**
 * Maps a data-intake-field prefix to the applicantContext section ID.
 * e.g. "career-target_roles" → prefix "career" → section "career-goals"
 */
const INTAKE_FIELD_SECTION_MAP = {
  'career':     'career-goals',
  'summary':    'professional-summary',
  'experience': 'experience-highlights',
  'education':  'education',
  'work':       'work-preferences',
  'personal':   'personal-details',
};

/**
 * Parses a data-intake-field value like "career-target_roles" into
 * { sectionId: 'career-goals', fieldId: 'target_roles' }.
 */
function parseIntakeFieldKey(key) {
  const dashIdx = key.indexOf('-');
  if (dashIdx < 0) return null;
  const prefix = key.substring(0, dashIdx);
  const fieldId = key.substring(dashIdx + 1);
  const sectionId = INTAKE_FIELD_SECTION_MAP[prefix];
  if (!sectionId || !fieldId) return null;
  return { sectionId, fieldId };
}

/** Fields that should use a textarea instead of a single-line input. */
const LONG_INTAKE_FIELDS = new Set([
  'target_roles', 'ideal_role', 'career_motivations',
  'elevator_pitch', 'unique_value',
  'recent_role', 'proudest_achievement', 'daily_tools', 'leadership_example',
  'certifications', 'anything_else',
]);

/**
 * Initialises inline editing on all .inline-editable containers.
 * Single-click on .ie-display adds .editing to the container, showing the
 * paired .ie-input. Blur on the input removes .editing and saves.
 */
function initInlineEditing() {
  document.querySelectorAll('.inline-editable').forEach(container => {
    const display = container.querySelector('.ie-display[data-intake-field]');
    const input   = container.querySelector('.ie-input[data-intake-field]');
    if (!display || !input) return;

    const key    = display.dataset.intakeField;
    const parsed = parseIntakeFieldKey(key);
    if (!parsed) return;

    // Single-click on display span → enter edit mode
    display.addEventListener('click', () => {
      input.value = getAnswer(parsed.sectionId, parsed.fieldId) || '';
      container.classList.add('editing');
      input.focus();
    });

    // Save on blur (clicking away)
    const commit = () => {
      const newValue = input.value.trim();
      setAnswer(parsed.sectionId, parsed.fieldId, newValue);
      display.textContent = newValue;
      container.classList.remove('editing');
    };

    input.addEventListener('blur', commit);

    // Enter key commits for single-line inputs; Shift+Enter is newline in textareas
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (input.tagName === 'INPUT' || !e.shiftKey)) {
        e.preventDefault();
        input.blur();
      }
      if (e.key === 'Escape') {
        container.classList.remove('editing');
      }
    });
  });

  // Also wire .wp-value spans — uses the existing .wp-input in the same .work-pref-item,
  // toggled via the .editing CSS class (mirrors the .inline-editable pattern exactly).
  document.querySelectorAll('.work-pref-item').forEach(item => {
    const span  = item.querySelector('.wp-value[data-intake-field]');
    const input = item.querySelector('.wp-input[data-intake-field]');
    if (!span || !input) return;

    const key    = span.dataset.intakeField;
    const parsed = parseIntakeFieldKey(key);
    if (!parsed) return;

    span.addEventListener('click', () => {
      input.value = getAnswer(parsed.sectionId, parsed.fieldId) || '';
      item.classList.add('editing');
      input.focus();
    });

    const commit = () => {
      const v = input.value.trim();
      setAnswer(parsed.sectionId, parsed.fieldId, v);
      span.textContent = v || '';
      item.classList.remove('editing');
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { item.classList.remove('editing'); }
    });
  });
}

/**
 * Loads saved applicantContext values into all inline-editable display spans.
 */
function loadInlineEditValues() {
  document.querySelectorAll('.ie-display[data-intake-field], .wp-value[data-intake-field]').forEach(span => {
    const key    = span.dataset.intakeField;
    const parsed = parseIntakeFieldKey(key);
    if (!parsed) return;
    const value = getAnswer(parsed.sectionId, parsed.fieldId);
    if (value && value.trim()) {
      span.textContent = value;
    }
  });
}

// ─── Text dump textarea wiring ──────────────────────────────────────────────

/**
 * Wires [data-dump-idx] textareas to save/load from
 * applicantContext.textDumps[idx].
 */
function wireTextDumpTextareas() {
  document.querySelectorAll('textarea[data-dump-idx]').forEach(ta => {
    const idx = parseInt(ta.dataset.dumpIdx);
    // Load existing value
    const dumps = applicantContext.textDumps || [];
    if (dumps[idx] && dumps[idx].content) {
      ta.value = dumps[idx].content;
    }
    // Save on input
    ta.addEventListener('input', () => {
      if (!applicantContext.textDumps) applicantContext.textDumps = [];
      // Ensure the array is long enough
      while (applicantContext.textDumps.length <= idx) {
        applicantContext.textDumps.push({ label: 'Resume', content: '', createdAt: new Date().toISOString() });
      }
      applicantContext.textDumps[idx].content = ta.value.substring(0, MAX_TEXT_DUMP_CHARS);
      scheduleIntakeSave();
    });
  });
}

// ─── Entry point ─────────────────────────────────────────────────────────────

// Kick off data loading and form population
init();

// Handle any fragment present in the initial URL (e.g. arriving via a link)
handleHash();

// Re-run handleHash whenever the fragment changes without a full page navigation
window.addEventListener('hashchange', handleHash);


// ─── Auth UI ─────────────────────────────────────────────────────────────────

const authSignInBtn = document.getElementById('authSignInBtn');
const authUserInfo = document.getElementById('authUserInfo');
const authUserName = document.getElementById('authUserName');
const authSignOutBtn = document.getElementById('authSignOutBtn');

/**
 * Update the auth UI based on the current auth state.
 */
async function updateAuthUI() {
  const banner = document.getElementById('backendStatusBanner');
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_AUTH_STATE' });
    if (response?.success && response.data?.signedIn) {
      authSignInBtn.style.display = 'none';
      authUserInfo.style.display = 'flex';
      authUserName.textContent = response.data.user.name || response.data.user.email || 'Signed in';
      if (banner) banner.style.display = 'block';
    } else {
      authSignInBtn.style.display = 'flex';
      authUserInfo.style.display = 'none';
      if (banner) banner.style.display = 'none';
    }
  } catch (err) {
    authSignInBtn.style.display = 'flex';
    authUserInfo.style.display = 'none';
    if (banner) banner.style.display = 'none';
  }
}

// Sign in button
authSignInBtn?.addEventListener('click', async () => {
  try {
    authSignInBtn.textContent = 'Signing in...';
    authSignInBtn.disabled = true;
    await chrome.runtime.sendMessage({ type: 'SIGN_IN' });
    // OAuth tab will open — the callback handler will notify us
  } catch (err) {
    authSignInBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Sign in';
    authSignInBtn.disabled = false;
    console.error('Sign in failed:', err);
  }
});

// Sign out button
authSignOutBtn?.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'SIGN_OUT' });
    updateAuthUI();
  } catch (err) {
    console.error('Sign out failed:', err);
  }
});

// Listen for auth state changes from background (after OAuth callback)
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'AUTH_STATE_CHANGED') {
    updateAuthUI();
    sendResponse({ success: true });
  }
  return false;
});

// Check auth state on page load
updateAuthUI();
