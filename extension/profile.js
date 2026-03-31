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
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
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
 * Replaces the upload zone's inner HTML with a "resume loaded" confirmation
 * that shows the file name and a hint to re-upload if desired.
 *
 * @param {string|null} fileName - The resume file name (or profile name) to display.
 */
function showResumeLoaded(fileName) {
  const zone = document.getElementById('uploadZone');
  const name = fileName || 'Resume';
  zone.innerHTML = `
    <div class="icon" style="color: #059669;">&#9989;</div>
    <div class="text" style="color: #059669; font-weight: 600;">${escapeHTML(name)}</div>
    <div class="hint">Resume loaded. Click or drag to upload a different one.</div>
  `;
}

// ─── Tab switching ────────────────────────────────────────────────────────────

/**
 * Attach click listeners to every `.tab` button.
 * Activating a tab deactivates all others and shows the matching `.tab-content`
 * panel.  Lazy-loads data for the 'applied' and 'stats' tabs on first reveal.
 */
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    // Deactivate all tabs and panels
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    // Show the corresponding panel; panel IDs follow the convention "tab-<name>"
    document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    // Refresh data-heavy tabs every time they become visible
    if (tab.dataset.tab === 'applied') loadAppliedJobs();
    if (tab.dataset.tab === 'stats') renderStats();
  });
});

// ─── Resume upload ────────────────────────────────────────────────────────────

/** DOM references kept at module scope so multiple listeners can share them. */
const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('fileInput');

// Clicking anywhere in the drop zone opens the OS file picker
uploadZone.addEventListener('click', () => fileInput.click());

// Drag-over: prevent default to allow the drop event and add visual feedback
uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

// Drag-leave: remove visual feedback when the dragged item leaves the zone
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));

// Drop: extract the first dropped file and process it
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
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

    setUploadStatus('Parsing resume with AI... This may take a moment.', 'loading');

    // Hand off raw text to the background script which calls the configured AI provider
    const parsed = await sendMessage({ type: 'PARSE_RESUME', rawText });
    // Merge parsed fields into existing profileData while preserving any extra keys
    // (e.g. resumeFileName from a previous save) and stamp the new file name
    profileData = { ...profileData, ...parsed, resumeFileName: file.name };
    populateProfileForm();
    showResumeLoaded(file.name);
    setUploadStatus('Resume parsed successfully! Review and edit below.', 'success');
    markProfileDirty();
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
    showToast('Please enter a valid email address');
    return;
  }
  if (profileData.phone && (profileData.phone.replace(/\D/g, '').length < 10)) {
    showToast('Please enter a valid phone number');
    return;
  }

  try {
    await sendMessage({ type: 'SAVE_PROFILE', profile: profileData });
    // Deep-copy into the active slot so the slot array always reflects the latest save
    profileSlots[activeSlot] = JSON.parse(JSON.stringify(profileData));
    await chrome.storage.local.set({ profileSlots });
    updateSlotButtons();
    markProfileClean();
    showToast('Profile saved!');
  } catch (err) {
    showToast('Error saving: ' + err.message);
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
    icon: '&#9733;',
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
    icon: '&#128188;',
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
    icon: '&#128640;',
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
    icon: '&#127891;',
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
    icon: '&#9881;',
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
    icon: '&#128100;',
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
    icon: '&#128203;',
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
      <div class="intake-sidebar-icon">${complete ? '&#10003;' : section.icon}</div>
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
  reviewBtn.innerHTML = `<div class="intake-sidebar-icon">&#128220;</div><div style="font-size:13px;">Review & Finish</div>`;
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
      showToast('Applicant context saved!');
    } catch (err) {
      showToast('Error saving: ' + err.message);
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
        <span class="prompt-section-arrow">&#9654;</span>
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
        showToast('Prompt reset to default');
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
function escapeHTML(str) {
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

// Reset All Prompts button
document.getElementById('resetAllPromptsBtn')?.addEventListener('click', async () => {
  if (!confirm('Reset all system prompts to defaults?')) return;
  await chrome.storage.local.remove('customPrompts');
  // Reload prompt sections from defaults
  const data = await sendMessage({ type: 'GET_CUSTOM_PROMPTS' });
  renderPromptSections(data);
  showToast('All prompts reset to defaults');
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
 * Saves settings first (so the background uses the latest values), then sends a
 * TEST_CONNECTION message and displays the result inline.
 */
document.getElementById('testConnBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('testResult');
  // Reset to hidden/neutral state before the new attempt
  resultEl.className    = 'test-result';
  resultEl.style.display = 'none';

  // Always save before testing so the background has the current key/model
  await saveSettings();

  try {
    resultEl.textContent   = 'Testing connection...';
    resultEl.className     = 'test-result loading';
    resultEl.style.display = 'block';

    const data = await sendMessage({ type: 'TEST_CONNECTION' });
    resultEl.textContent = 'Connection successful!';
    resultEl.className   = 'test-result success';
  } catch (err) {
    resultEl.textContent = 'Connection failed: ' + err.message;
    resultEl.className   = 'test-result error';
  }
});

/** "Save Settings" button — delegates to saveSettings() then shows a toast. */
document.getElementById('saveSettingsBtn').addEventListener('click', async () => {
  await saveSettings();
  await saveCustomPrompts();
  showToast('Settings & prompts saved!');
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
    tokenBudgets: {
      resume:      parseInt(document.getElementById('sBudgetResume').value, 10),
      analysis:    parseInt(document.getElementById('sBudgetAnalysis').value, 10),
      coverLetter: parseInt(document.getElementById('sBudgetCoverLetter').value, 10),
      chat:        parseInt(document.getElementById('sBudgetChat').value, 10),
    }
  };
  await sendMessage({ type: 'SAVE_SETTINGS', settings });
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
      // Show the name / file name in the upload zone so users know a resume is loaded
      const displayName = profile.resumeFileName || profile.name || 'Resume';
      showResumeLoaded(displayName);
    }

    // Load applicant context (new intake flow) or migrate from old qaList
    if (contextData && Object.keys(contextData.sections || {}).length > 0) {
      applicantContext = contextData;
    } else if (qa && qa.length) {
      // One-time migration from old Q&A format
      qaList = qa;
      if (migrateFromQAList(qa)) {
        sendMessage({ type: 'SAVE_APPLICANT_CONTEXT', applicantContext }).catch(() => {});
        showToast('Imported your existing Q&A answers into the new intake flow.');
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

    // Render system prompt editors
    if (promptData) {
      renderPromptSections(promptData);
    }

    // Pre-load applied jobs so the Applied tab is ready before the user clicks it
    loadAppliedJobs();
    // Load multi-slot state (activeSlot, profileSlots, slotNames) from local storage
    await loadProfileSlots();
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
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Applied jobs tracker ─────────────────────────────────────────────────────

/**
 * Fetches the applied-jobs list from the background and passes it to renderAppliedJobs.
 * Errors are silently swallowed — the section simply stays empty.
 */
async function loadAppliedJobs() {
  try {
    const jobs = await sendMessage({ type: 'GET_APPLIED_JOBS' });
    renderAppliedJobs(jobs || []);
  } catch (err) {
    // Silently fail — the applied jobs section will show the empty state
  }
}

/**
 * Renders the applied-jobs tracker as an HTML table.
 * Shows an empty-state message when the list is empty.
 * Each row has a Delete button that immediately removes the job from storage
 * and refreshes the table.
 *
 * Score badges are coloured by threshold:
 *   >= 70 → green (strong match)
 *   45-69 → amber (good match)
 *   <  45 → red   (weak match)
 *
 * @param {Array<{id: string, title: string, company: string, location: string,
 *                salary: string, date: string, url: string, score: number}>} jobs
 */
function renderAppliedJobs(jobs) {
  const container = document.getElementById('appliedJobsList');
  const countEl   = document.getElementById('appliedCount');

  if (!jobs.length) {
    container.innerHTML = '<div class="applied-empty">No applied jobs yet. Use the side panel on a job posting to mark jobs as applied.</div>';
    countEl.textContent = '';
    return;
  }

  // Pluralise "job" / "jobs" based on count
  countEl.textContent = jobs.length + ' job' + (jobs.length === 1 ? '' : 's') + ' applied';

  let html = `<table class="applied-table">
    <thead>
      <tr>
        <th>Score</th>
        <th>Title</th>
        <th>Company</th>
        <th>Location</th>
        <th>Salary</th>
        <th>Date</th>
        <th></th>
      </tr>
    </thead>
    <tbody>`;

  for (const job of jobs) {
    // Colour-code the score badge based on the match quality thresholds
    const scoreClass = job.score >= 70 ? 'green' : job.score >= 45 ? 'amber' : 'red';
    const title    = escapeHTML(job.title    || 'Unknown');
    const company  = escapeHTML(job.company  || '');
    const location = escapeHTML(job.location || '-');
    const salary   = escapeHTML(job.salary   || '-');
    const date     = escapeHTML(job.date     || '');
    const url      = escapeAttr(job.url      || '#');

    html += `<tr>
      <td><span class="score-badge score-badge-${scoreClass}">${job.score || 0}</span></td>
      <td><a href="${url}" target="_blank" rel="noopener">${title}</a></td>
      <td>${company}</td>
      <td>${location}</td>
      <td>${salary}</td>
      <td>${date}</td>
      <td><button class="btn btn-danger btn-sm delete-applied" data-id="${escapeAttr(job.id)}">Delete</button></td>
    </tr>`;
  }

  html += '</tbody></table>';
  container.innerHTML = html;

  // Wire delete buttons after the HTML is in the DOM
  container.querySelectorAll('.delete-applied').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await sendMessage({ type: 'DELETE_APPLIED_JOB', jobId: btn.dataset.id });
        showToast('Job removed.');
        // Reload the full list so the deleted row is gone and the count is correct
        loadAppliedJobs();
      } catch (err) {
        showToast('Error: ' + err.message);
      }
    });
  });
}

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
 * Refreshes the visual state of all slot buttons to reflect:
 *   - Which slot is active (bold/highlighted via 'active' class)
 *   - Which slots contain data ('has-data' class adds a visual indicator)
 *   - The current human-readable name for each slot
 * Also updates the slot name input to show the active slot's name for editing.
 */
function updateSlotButtons() {
  document.querySelectorAll('.profile-slot-btn').forEach(btn => {
    const slot = parseInt(btn.dataset.slot);
    // Toggle 'active' class — only the current activeSlot should be active
    btn.classList.toggle('active', slot === activeSlot);
    // Toggle 'has-data' if the slot has a non-null profile snapshot
    btn.classList.toggle('has-data', !!profileSlots[slot]);
    // Use the custom name or fall back to "Resume N" (1-based for readability)
    btn.textContent = slotNames[slot] || `Resume ${slot + 1}`;
  });
  // Populate the rename input with the active slot's current name
  document.getElementById('slotNameInput').value = slotNames[activeSlot] || '';
}

/**
 * Loads the multi-slot state from chrome.storage.local and refreshes the UI.
 * Called during init.  Silently ignores storage errors (extension context loss,
 * incognito mode, etc.).
 */
async function loadProfileSlots() {
  try {
    const result = await chrome.storage.local.get(['profileSlots', 'activeProfileSlot', 'slotNames']);
    profileSlots = result.profileSlots || [null, null, null];
    activeSlot   = result.activeProfileSlot || 0;
    slotNames    = result.slotNames || ['Resume 1', 'Resume 2', 'Resume 3'];
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
    // No-op if the user clicks the already-active slot
    if (newSlot === activeSlot) return;

    // Step 1: Capture any form edits and snapshot the current profile
    syncCurrentProfileFromForm();
    // Deep-copy via JSON round-trip to break object references
    profileSlots[activeSlot] = JSON.parse(JSON.stringify(profileData));
    activeSlot = newSlot;

    const newProfile = profileSlots[activeSlot];
    if (newProfile) {
      // Step 2a: Slot has data — deep-copy it into profileData and repopulate the form
      profileData = JSON.parse(JSON.stringify(newProfile));
      populateProfileForm();
      // Show the resume filename or name in the upload zone
      const displayName = profileData.resumeFileName || profileData.name || 'Resume';
      showResumeLoaded(displayName);
    } else {
      // Step 2b: Slot is empty — reset profileData and restore the default upload zone
      profileData = {
        name: '', email: '', phone: '', location: '', linkedin: '', website: '',
        summary: '', skills: [], experience: [], education: [], certifications: [], projects: []
      };
      populateProfileForm();
      // Restore the original drag-and-drop prompt in the upload zone
      document.getElementById('uploadZone').innerHTML = `
        <div class="icon">&#128196;</div>
        <div class="text">Drag & drop your resume or click to browse</div>
        <div class="hint">Supports PDF and DOCX</div>`;
    }

    // Step 3: Persist both the slots array and the active slot index.
    // Also write 'profile' so the background service worker picks up the new active profile.
    await chrome.storage.local.set({
      profileSlots,
      activeProfileSlot: activeSlot,
      profile: profileSlots[activeSlot] || null  // null signals an empty slot to the background
    });
    updateSlotButtons();
    showToast(`Switched to ${slotNames[activeSlot]}.`);
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
  showToast('Profile renamed.');
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
async function renderStats() {
  const container = document.getElementById('statsContent');
  if (!container) return;
  container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">Loading\u2026</p>';
  try {
    // Read both storage keys in a single call for efficiency
    const result    = await chrome.storage.local.get(['ac_analysisCache', 'appliedJobs']);
    const cache     = result.ac_analysisCache || {};
    const applied   = result.appliedJobs || [];
    // Flatten the cache object into an array of analysis records
    const analyses  = Object.values(cache);

    // Extract all numeric matchScore values (skip entries where score is undefined)
    const scores    = analyses.map(a => a.analysis?.matchScore).filter(s => typeof s === 'number');
    // Arithmetic mean, rounded to the nearest integer
    const avgScore  = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    // Color the average score using the same green/amber/red thresholds as the badge
    const scoreColor = avgScore === null ? '#94a3b8' : avgScore >= 70 ? '#059669' : avgScore >= 45 ? '#d97706' : '#dc2626';

    // Aggregate missing skills across all analyses into a frequency map
    const skillCounts = {};
    analyses.forEach(a => {
      (a.analysis?.missingSkills || []).forEach(s => {
        skillCounts[s] = (skillCounts[s] || 0) + 1;
      });
    });
    // Sort descending by frequency and take the top 8 for the chart
    const topMissing = Object.entries(skillCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

    if (analyses.length === 0) {
      container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:30px 0;">No jobs analyzed yet. Visit a job posting and click Analyze Job in the side panel.</p>';
      return;
    }

    // Count how many scores fall into each tier
    const green = scores.filter(s => s >= 70).length;
    const amber = scores.filter(s => s >= 45 && s < 70).length;
    const red   = scores.filter(s => s < 45).length;

    let html = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${analyses.length}</div>
          <div class="stat-label">Jobs Analyzed</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${applied.length}</div>
          <div class="stat-label">Jobs Applied</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" style="color:${scoreColor}">${avgScore !== null ? avgScore + '%' : '\u2014'}</div>
          <div class="stat-label">Avg Match Score</div>
        </div>
      </div>`;

    if (scores.length > 0) {
      html += `
        <div class="stat-section-title">Score Distribution</div>
        <div class="score-dist">
          <div class="score-dist-bar" style="background:#d1fae5;color:#059669">${green}<small>Strong \u226570</small></div>
          <div class="score-dist-bar" style="background:#fef3c7;color:#92400e">${amber}<small>Good 45\u201369</small></div>
          <div class="score-dist-bar" style="background:#fee2e2;color:#dc2626">${red}<small>Low &lt;45</small></div>
        </div>`;
    }

    if (topMissing.length > 0) {
      // The most-frequent skill defines the 100% width; all others are proportional
      const maxCount = topMissing[0][1];
      html += `<div class="stat-section-title">Skills to Add to Your Resume</div>
        <p style="font-size:12px;color:#94a3b8;margin-bottom:12px;">Appears as missing across your analyzed jobs.</p>`;
      topMissing.forEach(([skill, count]) => {
        // Percentage relative to the highest-count skill for proportional bar widths
        const pct = Math.round((count / maxCount) * 100);
        html += `
          <div class="skill-freq-bar">
            <div class="skill-freq-name">${escapeHTML(skill)}</div>
            <div class="skill-freq-track"><div class="skill-freq-fill" style="width:${pct}%"></div></div>
            <div class="skill-freq-count">${count}x</div>
          </div>`;
      });
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p style="color:#dc2626;">Error loading stats: ${escapeHTML(err.message)}</p>`;
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
  const validTabs = ['profile', 'qa', 'applied', 'stats', 'settings'];
  if (validTabs.includes(hash)) {
    // Deactivate all tabs and panels first
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    // Activate the target tab button and its content panel
    document.querySelector('[data-tab="' + hash + '"]').classList.add('active');
    document.getElementById('tab-' + hash).classList.add('active');
    // Lazy-load data for tabs that fetch it on demand
    if (hash === 'applied') loadAppliedJobs();
    if (hash === 'stats')   renderStats();
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'AUTH_STATE_CHANGED') {
    updateAuthUI();
    sendResponse({ success: true });
  }
  return false;
});

// Check auth state on page load
updateAuthUI();
