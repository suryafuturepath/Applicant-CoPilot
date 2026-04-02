import { getShadowRoot, getCurrentAnalysis } from '../state.js';
import { sendMessage } from '../messaging.js';
import { setStatus, clearStatus, scrollPanelTo } from '../panel/status.js';
import { extractJobDescription } from '../platform/jd-extractor.js';
import { escapeHTML } from '../utils.js';

// ─── Cover letter ─────────────────────────────────────────────

/**
 * Generates a tailored cover letter for the current job via the AI and
 * displays it in the Cover Letter section of the panel.
 * Requires a completed analysis (currentAnalysis must be non-null).
 * @async
 */
export async function generateCoverLetter() {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  const btn = shadowRoot.getElementById('jmCoverLetterBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="jm-spinner"></span> Writing...';
  try {
    if (!currentAnalysis) throw new Error('Analyze the job first.');
    const jd = await extractJobDescription();
    const clResult = await sendMessage({
      type: 'GENERATE_COVER_LETTER',
      jobDescription: jd,
      analysis: {
        matchingSkills: currentAnalysis.matchingSkills,
        matchScore: currentAnalysis.matchScore,
        jdDigest: currentAnalysis.jdDigest || null
      },
      url: window.location.href
    });
    // Support both old string and new object response format
    const text = typeof clResult === 'string' ? clResult : clResult.text;
    const clTruncated = typeof clResult === 'object' && clResult.truncated;
    shadowRoot.getElementById('jmCoverLetterText').textContent = text;
    const section = shadowRoot.getElementById('jmCoverLetterSection');
    section.style.display = 'block';
    scrollPanelTo(section);
  } catch (err) {
    setStatus('Error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#9993; Cover Letter';
  }
}
