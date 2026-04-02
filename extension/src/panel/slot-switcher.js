import { getShadowRoot, setCurrentAnalysis } from '../state.js';
import { setStatus, clearStatus } from './status.js';

// ─── Resume slot switcher ─────────────────────────────────────

let _activeSlot = 0;
let _slotNames = ['Resume 1', 'Resume 2', 'Resume 3'];
let _slotHasData = [false, false, false];

export function getActiveSlot() { return _activeSlot; }
export function getSlotNames() { return _slotNames; }

/**
 * Loads slot state from chrome.storage.local and renders the switcher pills.
 * Called when the panel opens so the switcher always reflects current storage.
 * @async
 */
export async function loadSlotState() {
  try {
    const result = await chrome.storage.local.get(['profileSlots', 'activeProfileSlot', 'slotNames']);
    _activeSlot  = result.activeProfileSlot ?? 0;
    _slotNames   = result.slotNames   || ['Resume 1', 'Resume 2', 'Resume 3'];
    const slots  = result.profileSlots || [null, null, null];
    _slotHasData = slots.map(s => !!s);
    renderSlotSwitcher();
  } catch (e) { /* ignore — switcher stays hidden */ }
}

/**
 * Renders the three slot pills into #jmSwitchPills.
 * Disables pills for empty slots. Marks the active slot with .active class.
 */
export function renderSlotSwitcher() {
  const shadowRoot = getShadowRoot();
  const container = shadowRoot && shadowRoot.getElementById('jmSwitchPills');
  if (!container) return;
  container.innerHTML = '';
  _slotNames.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = 'jm-switch-pill' + (i === _activeSlot ? ' active' : '');
    btn.textContent = name || `Resume ${i + 1}`;
    btn.title = _slotHasData[i] ? name : `${name} (empty)`;
    btn.disabled = !_slotHasData[i];
    btn.addEventListener('click', () => switchSlot(i));
    container.appendChild(btn);
  });
}

/**
 * Switches the active resume slot, updates chrome.storage.local, and resets
 * the current analysis so the user re-analyzes with the new resume.
 * @async
 * @param {number} slotIndex - The slot index (0, 1, or 2) to switch to.
 */
export async function switchSlot(slotIndex) {
  const shadowRoot = getShadowRoot();
  if (slotIndex === _activeSlot) return;
  try {
    const result = await chrome.storage.local.get(['profileSlots', 'slotNames']);
    const slots  = result.profileSlots || [null, null, null];
    if (!slots[slotIndex]) return; // slot is empty — should not happen (button is disabled)

    // Persist the new active slot and update the top-level `profile` key
    // so background.js always reads the correct resume for AI calls.
    await chrome.storage.local.set({
      activeProfileSlot: slotIndex,
      profile: slots[slotIndex]
    });

    _activeSlot = slotIndex;
    renderSlotSwitcher();

    // Reset analysis — it was scored against the previous resume
    setCurrentAnalysis(null);
    const analyzeBtn = shadowRoot.getElementById('jmAnalyze');
    if (analyzeBtn) analyzeBtn.textContent = 'Analyze Job';

    // Hide all result sections so the panel is clean for the new resume
    ['jmScoreSection','jmMatchingSection','jmMissingSection','jmRecsSection',
     'jmInsightsSection','jmKeywordsSection','jmCoverLetterSection',
     'jmSaveJob','jmMarkApplied','jmCoverLetterBtn'
    ].forEach(id => {
      const el = shadowRoot.getElementById(id);
      if (el) el.style.display = 'none';
    });

    setStatus(`Switched to ${_slotNames[slotIndex] || `Resume ${slotIndex + 1}`}. Click Analyze Job.`, 'success');
    setTimeout(clearStatus, 2500);
  } catch (e) {
    setStatus('Could not switch resume: ' + e.message, 'error');
  }
}
