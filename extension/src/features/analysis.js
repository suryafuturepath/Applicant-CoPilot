// features/analysis.js — Job analysis pipeline and rendering

import { getShadowRoot, setCurrentAnalysis } from '../state.js';
import { sendMessage } from '../messaging.js';
import { getCachedAnalysis, setCachedAnalysis } from '../storage/analysis-cache.js';
import {
  extractJobDescription,
  extractJobTitle,
  extractCompany,
  extractLocation,
  extractSalary
} from '../platform/jd-extractor.js';
import { setStatus, clearStatus } from '../panel/status.js';
import { updateChatEmptyState } from '../features/chat.js';
import { escapeHTML } from '../utils.js';

// ─── Shared Helpers ─────────────────────────────────────────────

/** Race condition guard — prevents concurrent analysis requests */
let _analyzing = false;

/** Clamps and coerces a score to a valid 0-100 integer */
function safeScore(raw) {
  return Math.max(0, Math.min(100, Math.round(Number(raw) || 0)));
}

/** Returns a user-friendly label for the match score */
function getScoreLabel(score) {
  if (score >= 70) return 'Strong Candidate';
  if (score >= 45) return 'Good Match';
  return 'Room to Grow';
}

/** Returns the ring stroke color for a score (sage/amber/red) */
function getScoreColor(score) {
  if (score >= 70) return '#4f614d';
  if (score >= 45) return '#d97706';
  return '#dc2626';
}

/**
 * Updates the SVG score ring and number display.
 * @param {ShadowRoot} shadowRoot
 * @param {number} score - 0-100 (already clamped)
 */
function updateScoreRing(shadowRoot, score) {
  const scoreNumber = shadowRoot.getElementById('jmScoreCircle');
  if (scoreNumber) scoreNumber.textContent = score;

  const ringFill = shadowRoot.getElementById('jmScoreRingFill');
  if (ringFill) {
    const circumference = 2 * Math.PI * 52; // r=52 from the SVG
    const dashLen = (score / 100) * circumference;
    ringFill.style.strokeDasharray = `${dashLen} ${circumference}`;
    ringFill.style.stroke = getScoreColor(score);
  }

  const scoreLabel = shadowRoot.getElementById('jmScoreLabel');
  if (scoreLabel) scoreLabel.textContent = getScoreLabel(score);
}

// ─── Main Analysis Pipeline ─────────────────────────────────────

/**
 * Runs a job analysis for the current page: extracts the JD, sends it to the
 * AI via background.js, caches the result, and renders it in the panel.
 *
 * @async
 * @param {boolean} [forceRefresh=false] - When true, bypasses the cache.
 */
export async function analyzeJob(forceRefresh) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return; // Panel not created yet

  const btn = shadowRoot.getElementById('jmAnalyze');
  const pageUrl = window.location.href;

  // Check cache first (unless force re-analyze)
  const cached = await getCachedAnalysis(pageUrl);
  if (!forceRefresh && cached) {
    setCurrentAnalysis(cached.analysis);
    showJobMeta(cached.title, cached.company, cached.location, cached.salary);
    renderAnalysis(cached.response);
    shadowRoot.getElementById('jmSaveJob').style.display = 'flex';
    shadowRoot.getElementById('jmCoverLetterBtn').style.display = 'flex';
    shadowRoot.getElementById('jmGenerateResumeBtn').style.display = 'flex';
    btn.textContent = 'Re-Analyze';
    setStatus('Showing cached results.', 'success');
    updateChatEmptyState();
    setTimeout(clearStatus, 2000);
    return;
  }

  // Race condition guard — prevent concurrent analysis
  if (_analyzing) return;
  _analyzing = true;

  btn.disabled = true;
  btn.innerHTML = '<span class="jm-spinner"></span> Extracting...';
  let analysisSucceeded = false;

  try {
    setStatus('Extracting job description...', 'info');
    const jd = await extractJobDescription();
    const title = extractJobTitle();
    const company = extractCompany();
    const location = extractLocation();
    const salary = extractSalary();

    console.log('[AC][analyze] JD extracted:', jd.length, 'chars | title:', title, '| company:', company);

    if (jd.length < 50) {
      setStatus('Could not find a job description on this page. Try scrolling down first.', 'error');
      return;
    }

    showJobMeta(title, company, location, salary);
    btn.innerHTML = '<span class="jm-spinner"></span> Analyzing...';
    setStatus(`Extracted ${jd.length} chars — analyzing match...`, 'info');

    const response = await sendMessage({
      type: 'ANALYZE_JOB',
      jobDescription: jd,
      jobTitle: title,
      company: company,
      url: window.location.href
    });

    if (!response) {
      setStatus('No response from AI. Check your connection or API key.', 'error');
      return;
    }

    const currentAnalysis = { ...response, title, company, location, salary, url: pageUrl };
    setCurrentAnalysis(currentAnalysis);
    await setCachedAnalysis(pageUrl, { response, analysis: currentAnalysis, title, company, location, salary });
    analysisSucceeded = true;
    renderAnalysis(response);
    clearStatus();
    updateChatEmptyState();

    // Truncation notices
    const truncNotice = shadowRoot.getElementById('jmTruncNotice');
    const resumeTruncNotice = shadowRoot.getElementById('jmResumeTruncNotice');
    if (truncNotice) truncNotice.style.display = response.jdTruncated ? 'block' : 'none';
    if (resumeTruncNotice) resumeTruncNotice.style.display = response.truncated ? 'block' : 'none';

    // Show action buttons
    shadowRoot.getElementById('jmSaveJob').style.display = 'flex';
    const appliedBtn = shadowRoot.getElementById('jmMarkApplied');
    if (appliedBtn && appliedBtn.textContent !== 'Applied') {
      appliedBtn.style.display = 'flex';
    }
    shadowRoot.getElementById('jmCoverLetterBtn').style.display = 'flex';
    shadowRoot.getElementById('jmGenerateResumeBtn').style.display = 'flex';

    // Reset previous AI output sections
    const coverSection = shadowRoot.getElementById('jmCoverLetterSection');
    const resumeSection = shadowRoot.getElementById('jmResumeSection');
    if (coverSection) coverSection.style.display = 'none';
    if (resumeSection) resumeSection.style.display = 'none';
  } catch (err) {
    const msg = err.message || 'Unknown error';
    if (msg.includes('invalidated') || msg.includes('Extension context')) {
      setStatus('Extension restarted. Please refresh the page and try again.', 'error');
    } else {
      setStatus('Analysis failed: ' + msg, 'error');
    }
  } finally {
    _analyzing = false;
    btn.disabled = false;
    btn.textContent = analysisSucceeded ? 'Re-Analyze' : 'Analyze Job';
  }
}

// ─── Rendering ──────────────────────────────────────────────────

/**
 * Renders job title, company, location, salary in the panel header.
 */
function showJobMeta(title, company, location, salary) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const jobInfo = shadowRoot.getElementById('jmJobInfo');
  if (!jobInfo) return;
  shadowRoot.getElementById('jmJobTitle').textContent = title;
  shadowRoot.getElementById('jmJobCompany').textContent = company;
  jobInfo.style.display = 'block';
  if (location) {
    shadowRoot.getElementById('jmJobLocationText').textContent = location;
    shadowRoot.getElementById('jmJobLocation').style.display = 'inline-flex';
  }
  if (salary) {
    shadowRoot.getElementById('jmJobSalaryText').textContent = salary;
    shadowRoot.getElementById('jmJobSalary').style.display = 'inline-flex';
  }
}

/**
 * Populates all analysis sections in the panel with AI results.
 * @param {Object} data - The analysis object from background.js.
 */
export function renderAnalysis(data) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot || !data) return; // Guard: panel or data missing

  // Hide "Quick Match" label since we now have full AI results
  const quickLabel = shadowRoot.getElementById('jmQuickMatchLabel');
  if (quickLabel) quickLabel.style.display = 'none';

  if (data._parseError) {
    setStatus('AI response format was unexpected. Try Re-Analyze for better results.', 'error');
  }

  // Score — clamp and render ring
  const scoreSection = shadowRoot.getElementById('jmScoreSection');
  const score = safeScore(data.matchScore);
  updateScoreRing(shadowRoot, score);
  if (scoreSection) scoreSection.style.display = 'block';

  // Matching skills
  const matchingSection = shadowRoot.getElementById('jmMatchingSection');
  const matchingEl = shadowRoot.getElementById('jmMatchingSkills');
  if (matchingEl && data.matchingSkills && data.matchingSkills.length) {
    matchingEl.innerHTML = data.matchingSkills.map(s =>
      `<span class="jm-tag jm-tag-match">${escapeHTML(s)}</span>`
    ).join('');
    if (matchingSection) matchingSection.style.display = 'block';
  }

  // Missing skills
  const missingSection = shadowRoot.getElementById('jmMissingSection');
  const missingEl = shadowRoot.getElementById('jmMissingSkills');
  if (missingEl && data.missingSkills && data.missingSkills.length) {
    missingEl.innerHTML = data.missingSkills.map(s =>
      `<span class="jm-tag jm-tag-missing">${escapeHTML(s)}</span>`
    ).join('');
    if (missingSection) missingSection.style.display = 'block';
  }

  // Recommendations
  const recsSection = shadowRoot.getElementById('jmRecsSection');
  const recsEl = shadowRoot.getElementById('jmRecs');
  if (recsEl && data.recommendations && data.recommendations.length) {
    recsEl.innerHTML = data.recommendations.map(r =>
      `<li>${escapeHTML(r)}</li>`
    ).join('');
    if (recsSection) recsSection.style.display = 'block';
  }

  // Insights
  const insightsSection = shadowRoot.getElementById('jmInsightsSection');
  const insightsEl = shadowRoot.getElementById('jmInsights');
  if (insightsEl && data.insights) {
    let html = '';
    if (data.insights.strengths) {
      html += `<div class="jm-insight-block"><h4>Strengths</h4><p>${escapeHTML(data.insights.strengths)}</p></div>`;
    }
    if (data.insights.gaps) {
      html += `<div class="jm-insight-block"><h4>Gaps</h4><p>${escapeHTML(data.insights.gaps)}</p></div>`;
    }
    insightsEl.innerHTML = html;
    if (insightsSection) insightsSection.style.display = 'block';

    // ATS Keywords
    if (data.insights.keywords && data.insights.keywords.length) {
      const keySection = shadowRoot.getElementById('jmKeywordsSection');
      const keyEl = shadowRoot.getElementById('jmKeywords');
      if (keyEl) {
        keyEl.innerHTML = data.insights.keywords.map(k =>
          `<span class="jm-tag jm-tag-keyword">${escapeHTML(k)}</span>`
        ).join('');
        if (keySection) keySection.style.display = 'block';
      }
    }
  }
}

/**
 * Renders a quick keyword match result in the panel using the same UI sections
 * as the full AI analysis. Labels it as "Quick Match" so users know it's local.
 * @param {Object} result - From computeMatchScore: { score, matchedKeywords[], missingKeywords[] }
 * @param {string} title - Job title
 * @param {string} company - Company name
 * @param {string} location - Location
 * @param {string} salary - Salary
 */
export function renderQuickMatch(result, title, company, location, salary) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot || !result) return;

  showJobMeta(title, company, location, salary);

  // Score ring
  const scoreSection = shadowRoot.getElementById('jmScoreSection');
  const score = safeScore(result.score);
  updateScoreRing(shadowRoot, score);
  if (scoreSection) scoreSection.style.display = 'block';

  // "Quick Match" label
  let quickLabel = shadowRoot.getElementById('jmQuickMatchLabel');
  if (!quickLabel) {
    quickLabel = document.createElement('div');
    quickLabel.id = 'jmQuickMatchLabel';
    quickLabel.style.cssText = 'text-align:center;font-size:11px;color:var(--ac-text-muted);margin-top:4px;font-weight:500;';
    if (scoreSection) scoreSection.appendChild(quickLabel);
  }
  quickLabel.textContent = 'Quick Match (keyword scan)';
  quickLabel.style.display = 'block';

  // Match count badge
  const matchCount = shadowRoot.getElementById('jmMatchCount');
  if (matchCount && result.matchedKeywords) {
    matchCount.textContent = result.matchedKeywords.length + ' Found';
  }

  // Matching keywords
  const matchingSection = shadowRoot.getElementById('jmMatchingSection');
  const matchingEl = shadowRoot.getElementById('jmMatchingSkills');
  if (matchingEl && result.matchedKeywords && result.matchedKeywords.length) {
    matchingEl.innerHTML = result.matchedKeywords.map(s =>
      `<span class="jm-tag jm-tag-match">${escapeHTML(s)}</span>`
    ).join('');
    if (matchingSection) matchingSection.style.display = 'block';
  }

  // Missing keywords
  const missingSection = shadowRoot.getElementById('jmMissingSection');
  const missingEl = shadowRoot.getElementById('jmMissingSkills');
  if (missingEl && result.missingKeywords && result.missingKeywords.length) {
    missingEl.innerHTML = result.missingKeywords.map(s =>
      `<span class="jm-tag jm-tag-missing">${escapeHTML(s)}</span>`
    ).join('');
    if (missingSection) missingSection.style.display = 'block';
  }
}
