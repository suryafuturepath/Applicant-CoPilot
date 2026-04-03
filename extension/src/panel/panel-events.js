// panel/panel-events.js — Fan-out hub: wires all panel button/nav event listeners
// Extracted from content-main.js wireEvents()

import { getShadowRoot } from '../state.js';
import { sendMessage } from '../messaging.js';
import { analyzeJob } from '../features/analysis.js';
import { autofillForm, applyAutofill, cancelAutofill } from '../autofill/autofill-pipeline.js';
import { saveJob, markApplied } from '../features/save-applied.js';
import { generateCoverLetter } from '../features/cover-letter.js';
import { generateATSResume, openResumePreviewTab } from '../features/ats-resume.js';
import { scrollPanelTo } from './status.js';
import { loadJobNotes, saveJobNotes } from '../storage/job-notes.js';
import { activateSavedTab, deactivateSavedTab } from '../features/saved-jobs.js';
import { activateAskAiTab, deactivateAskAiTab, sendChatMessage, clearChat } from '../features/chat.js';
// theme.js no longer has a cycle — single sage theme

// ─── Late-binding registry ────────────────────────────────────────
// Interview prep functions live in a module that hasn't been extracted yet.
// They register themselves here at load time so wireEvents can call them.
const _registry = {};

/**
 * Registers a named callback that wireEvents will invoke.
 * Used by modules extracted later (e.g. interview-prep) to avoid
 * circular dependency issues.
 * @param {string} name  - Function name (e.g. 'deactivateInterviewPrep')
 * @param {Function} fn  - The implementation
 */
export function registerEventHandler(name, fn) {
  _registry[name] = fn;
}

/** @param {string} name @param  {...any} args */
function call(name, ...args) {
  if (_registry[name]) return _registry[name](...args);
  console.warn('[AC][panel-events] handler not registered:', name);
}

/**
 * Attaches all button click listeners and tab-switch handlers to the panel.
 * Called once after the panel HTML is injected into the Shadow DOM.
 * @param {HTMLElement} panel - The #jm-panel element inside the Shadow DOM.
 */
export function wireEvents(panel) {
    const shadowRoot = getShadowRoot();

    panel.querySelector('#jmAnalyze').addEventListener('click', () => {
      const btn = shadowRoot.getElementById('jmAnalyze');
      // If button says "Re-Analyze", force refresh; otherwise use cache
      const forceRefresh = btn.textContent.trim() === 'Re-Analyze';
      analyzeJob(forceRefresh);
    });
    panel.querySelector('#jmAutofill').addEventListener('click', autofillForm);
    panel.querySelector('#jmSaveJob').addEventListener('click', saveJob);

    panel.querySelector('#jmMarkApplied').addEventListener('click', markApplied);
    panel.querySelector('#jmCoverLetterBtn').addEventListener('click', generateCoverLetter);
    panel.querySelector('#jmGenerateResumeBtn').addEventListener('click', () => {
      const section = shadowRoot.getElementById('jmResumeSection');
      if (section.style.display === 'none') {
        section.style.display = 'block';
        // Always show build view when opening from button
        shadowRoot.getElementById('jmResumeBuild').style.display = 'block';
        scrollPanelTo(section);
      } else {
        section.style.display = 'none';
      }
    });
    panel.querySelector('#jmDoGenerateResume').addEventListener('click', generateATSResume);

    // Resume instruction chip clicks — toggle chip and append/remove instruction
    panel.querySelectorAll('.jm-resume-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const textarea = shadowRoot.getElementById('jmResumeInstructions');
        const instruction = chip.dataset.instruction;
        if (!textarea || !instruction) return;
        const current = textarea.value;
        if (chip.classList.contains('selected')) {
          chip.classList.remove('selected');
          textarea.value = current.replace(instruction, '').replace(/\.\s*\./g, '.').replace(/^\.\s*/, '').replace(/\s*\.\s*$/, '').trim();
        } else {
          chip.classList.add('selected');
          textarea.value = current ? current + '. ' + instruction : instruction;
        }
      });
    });

    // Open full preview in a new tab (with download/print buttons built in)
    const openPreviewHandler = () => {
      const resumeMarkdown = shadowRoot.getElementById('jmResumeText').textContent;
      if (!resumeMarkdown) return;
      openResumePreviewTab(resumeMarkdown);
    };
    panel.querySelector('#jmOpenResumePreview').addEventListener('click', openPreviewHandler);
    panel.querySelector('#jmResumeMiniPreview').addEventListener('click', openPreviewHandler);
    panel.querySelector('#jmResumeMiniPreview').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreviewHandler(); }
    });

    // Copy resume text
    panel.querySelector('#jmCopyResume').addEventListener('click', () => {
      const text = shadowRoot.getElementById('jmResumeText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = shadowRoot.getElementById('jmCopyResume');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
      }).catch(() => {});
    });

    // Redo — switch back to build view so user can tweak instructions
    panel.querySelector('#jmRedoResume').addEventListener('click', () => {
      shadowRoot.getElementById('jmResumeResult').style.display = 'none';
      shadowRoot.getElementById('jmResumeBuild').style.display = 'block';
      scrollPanelTo(shadowRoot.getElementById('jmResumeBuild'));
    });
    panel.querySelector('#jmApplyFill').addEventListener('click', applyAutofill);
    panel.querySelector('#jmCancelFill').addEventListener('click', cancelAutofill);
    panel.querySelector('#jmCopyCoverLetter').addEventListener('click', () => {
      const text = shadowRoot.getElementById('jmCoverLetterText').textContent;
      navigator.clipboard.writeText(text).then(() => {
        const btn = shadowRoot.getElementById('jmCopyCoverLetter');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {});
    });
    panel.querySelector('#jmNotesInput').addEventListener('blur', saveJobNotes);
    let _notesDebounce = null;
    panel.querySelector('#jmNotesInput').addEventListener('input', () => {
      clearTimeout(_notesDebounce);
      _notesDebounce = setTimeout(saveJobNotes, 800);
    });

    // Gear icon — opens Profile & Settings page
    const gearBtn = panel.querySelector('#jmGearBtn');
    if (gearBtn) {
      gearBtn.addEventListener('click', () => {
        sendMessage({ type: 'OPEN_PROFILE_TAB', hash: 'settings' });
      });
    }

    // Bottom navigation — 3 tabs: Analysis (home), Coaching (ask-ai), Saved
    shadowRoot.querySelectorAll('.jm-bottom-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.nav;
        // Always deactivate interview prep when switching tabs
        call('deactivateInterviewPrep');

        // Update active state on bottom nav
        shadowRoot.querySelectorAll('.jm-bottom-nav-btn').forEach(b => {
          b.classList.toggle('active', b === btn);
        });

        if (tab === 'home') {
          deactivateSavedTab();
          deactivateAskAiTab();
        } else if (tab === 'coaching') {
          deactivateSavedTab();
          activateAskAiTab();
        } else if (tab === 'saved') {
          deactivateAskAiTab();
          activateSavedTab();
        }
      });
    });

    // ── Ask AI chat listeners ──────────────────────────────────────────
    const chatInput = panel.querySelector('#jmChatInput');
    const chatSend = panel.querySelector('#jmChatSend');
    const chatAnalyze = panel.querySelector('#jmChatAnalyzeBtn');
    const chatClear = panel.querySelector('#jmChatClear');

    // Send on button click
    if (chatSend) {
      chatSend.addEventListener('click', () => {
        if (chatInput) {
          sendChatMessage(chatInput.value);
          chatInput.value = '';
          chatInput.style.height = 'auto';
        }
      });
    }

    // Send on Enter (Shift+Enter for newline), auto-grow textarea
    if (chatInput) {
      chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendChatMessage(chatInput.value);
          chatInput.value = '';
          chatInput.style.height = 'auto';
        }
      });
      chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + 'px';
      });
    }

    // "Analyze Job" button inside empty state — triggers analysis then refreshes chat
    if (chatAnalyze) {
      chatAnalyze.addEventListener('click', () => {
        deactivateAskAiTab();
        analyzeJob(false);
      });
    }

    // Clear chat
    if (chatClear) {
      chatClear.addEventListener('click', () => {
        if (confirm('Clear this conversation?')) {
          clearChat();
        }
      });
    }

    // Suggestion chip clicks → send as message
    panel.querySelectorAll('.jm-chat-chip').forEach(chip => {
      const CHIP_MESSAGES = {
        'Am I a good fit?': 'Am I a good fit for this role?',
        'Interview prep': 'Help me prepare for the interview',
        'Company research': 'Tell me about this company',
        'What to highlight?': 'What should I highlight from my experience?'
      };
      chip.addEventListener('click', () => {
        const fullMessage = CHIP_MESSAGES[chip.textContent] || chip.textContent;
        sendChatMessage(fullMessage);
      });
    });

    // ── Interview Prep listeners ──────────────────────────────────────
    const prepBack = panel.querySelector('#jmPrepBack');
    if (prepBack) prepBack.addEventListener('click', () => call('deactivateInterviewPrep', true));

    const prepGenBtn = panel.querySelector('#jmPrepGenerateBtn');
    if (prepGenBtn) prepGenBtn.addEventListener('click', () => call('handleGeneratePrepQuestions'));

    const prepSubmitBtn = panel.querySelector('#jmPrepSubmitAnswer');
    if (prepSubmitBtn) prepSubmitBtn.addEventListener('click', () => call('submitCurrentAnswer'));

    const prepBackToList = panel.querySelector('#jmPrepBackToList');
    if (prepBackToList) prepBackToList.addEventListener('click', () => {
      call('clearPrepTimer');
      call('renderPrepQuestionListFromSession');
    });

    const prepNextQ = panel.querySelector('#jmPrepNextQuestion');
    if (prepNextQ) prepNextQ.addEventListener('click', () => call('handleNextQuestion'));

    const prepTryAgain = panel.querySelector('#jmPrepTryAgain');
    if (prepTryAgain) prepTryAgain.addEventListener('click', () => call('handleTryAgain'));

    const prepFollowUpBtn = panel.querySelector('#jmPrepFollowUpBtn');
    if (prepFollowUpBtn) prepFollowUpBtn.addEventListener('click', () => call('handlePrepFollowUp'));

    const prepAnalyticsBtn = panel.querySelector('#jmPrepAnalyticsBtn');
    if (prepAnalyticsBtn) prepAnalyticsBtn.addEventListener('click', () => call('renderPrepAnalyticsFromSession'));

    const prepAnalyticsBack = panel.querySelector('#jmPrepAnalyticsBack');
    if (prepAnalyticsBack) prepAnalyticsBack.addEventListener('click', () => call('renderPrepQuestionListFromSession'));

    const prepPositioningBtn = panel.querySelector('#jmPrepPositioningBtn');
    if (prepPositioningBtn) prepPositioningBtn.addEventListener('click', () => call('handleGeneratePositioning'));

    const prepFullReportBtn = panel.querySelector('#jmPrepFullReportBtn');
    if (prepFullReportBtn) prepFullReportBtn.addEventListener('click', () => call('handleFullReport'));

    // Timer pause/resume
    const timerPauseBtn = panel.querySelector('#jmPrepTimerPause');
    if (timerPauseBtn) timerPauseBtn.addEventListener('click', () => call('togglePrepTimerPause', timerPauseBtn));

    // Word count on answer textarea
    const answerInput = panel.querySelector('#jmPrepAnswerInput');
    if (answerInput) {
      answerInput.addEventListener('input', () => {
        const wc = shadowRoot.getElementById('jmPrepWordCount');
        if (wc) {
          const words = answerInput.value.trim().split(/\s+/).filter(Boolean).length;
          wc.textContent = words + ' word' + (words !== 1 ? 's' : '');
        }
      });
    }
  }
