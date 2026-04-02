// features/analysis.js — Job analysis pipeline and rendering
// Extracted from content-main.js analyzeJob(), showJobMeta(), renderAnalysis(), getScoreClass()

import { getShadowRoot, getCurrentAnalysis, setCurrentAnalysis } from '../state.js';
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

/**
 * Runs a job analysis for the current page: extracts the JD, sends it to the
 * AI via background.js, caches the result, and renders it in the panel.
 *
 * If a cached result exists for the current URL and forceRefresh is false,
 * the cached result is displayed immediately with no API call.
 *
 * @async
 * @param {boolean} [forceRefresh=false] - When true, bypasses the cache and
 *   always makes a fresh AI call (triggered by the "Re-Analyze" button).
 */
export async function analyzeJob(forceRefresh) {
    const shadowRoot = getShadowRoot();
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

    btn.disabled = true;
    btn.innerHTML = '<span class="jm-spinner"></span> Analyzing...';
    let analysisSucceeded = false;

    try {
      const jd = await extractJobDescription();
      const title = extractJobTitle();
      const company = extractCompany();
      const location = extractLocation();
      const salary = extractSalary();

      console.log('[AC][analyze] JD extracted:', jd.length, 'chars | title:', title, '| company:', company);
      if (jd.length < 200) console.log('[AC][analyze] Short JD text:', JSON.stringify(jd.substring(0, 500)));

      if (jd.length < 50) {
        setStatus('Could not find a job description on this page.', 'error');
        return;
      }

      showJobMeta(title, company, location, salary);

      // Warn if the extracted JD is too short to produce reliable results,
      // but don't block — the user can still trigger analysis.
      if (jd.length < 100) {
        setStatus('Could not extract enough job details from this page. Try copying the job description manually.', 'error');
        btn.disabled = false;
        btn.textContent = 'Analyze Job';
        return;
      }

      setStatus('Analyzing job match...', 'info');

      const response = await sendMessage({
        type: 'ANALYZE_JOB',
        jobDescription: jd,
        jobTitle: title,
        company: company,
        url: window.location.href
      });

      const currentAnalysis = { ...response, title, company, location, salary, url: pageUrl };
      setCurrentAnalysis(currentAnalysis);
      await setCachedAnalysis(pageUrl, { response, analysis: currentAnalysis, title, company, location, salary });
      analysisSucceeded = true;
      renderAnalysis(response);
      clearStatus();
      // Update Ask AI chat state so it knows analysis is available
      updateChatEmptyState();

      // Show truncation notices if text was trimmed
      shadowRoot.getElementById('jmTruncNotice').style.display = response.jdTruncated ? 'block' : 'none';
      shadowRoot.getElementById('jmResumeTruncNotice').style.display = response.truncated ? 'block' : 'none';

      // Show save, applied, cover letter, bullet rewriter buttons
      shadowRoot.getElementById('jmSaveJob').style.display = 'flex';
      const appliedBtn = shadowRoot.getElementById('jmMarkApplied');
      if (appliedBtn.textContent !== 'Applied') {
        appliedBtn.style.display = 'flex';
      }
      shadowRoot.getElementById('jmCoverLetterBtn').style.display = 'flex';

      shadowRoot.getElementById('jmGenerateResumeBtn').style.display = 'flex';
      // Reset any previous AI output sections
      shadowRoot.getElementById('jmCoverLetterSection').style.display = 'none';
      shadowRoot.getElementById('jmResumeSection').style.display = 'none';
    } catch (err) {
      setStatus('Error: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = analysisSucceeded ? 'Re-Analyze' : 'Analyze Job';
    }
  }

/**
 * Renders the job title, company, location, and salary in the panel header.
 * Elements with no data are hidden to avoid empty UI gaps.
 * @param {string} title    - Job title text.
 * @param {string} company  - Company name.
 * @param {string} location - Job location string.
 * @param {string} salary   - Salary/compensation string.
 */
function showJobMeta(title, company, location, salary) {
    const shadowRoot = getShadowRoot();
    const jobInfo = shadowRoot.getElementById('jmJobInfo');
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
 * Populates all analysis sections in the panel (score, matching skills,
 * missing skills, recommendations, insights, ATS keywords).
 * Each section is shown only if the AI returned data for it.
 * @param {Object} data - The analysis object returned by background.js handleAnalyzeJob.
 */
export function renderAnalysis(data) {
    const shadowRoot = getShadowRoot();

    // Hide "Quick Match" label since we now have full AI results
    const quickLabel = shadowRoot.getElementById('jmQuickMatchLabel');
    if (quickLabel) quickLabel.style.display = 'none';

    // If JSON parsing failed, show a retry hint
    if (data._parseError) {
      setStatus('AI response format was unexpected. Try Re-Analyze for better results.', 'error');
    }

    // Score
    const scoreSection = shadowRoot.getElementById('jmScoreSection');
    const scoreCircle = shadowRoot.getElementById('jmScoreCircle');
    const score = data.matchScore || 0;
    scoreCircle.textContent = score;
    scoreCircle.className = 'jm-score-circle ' + getScoreClass(score);
    scoreSection.style.display = 'block';

    // Matching skills
    const matchingSection = shadowRoot.getElementById('jmMatchingSection');
    const matchingEl = shadowRoot.getElementById('jmMatchingSkills');
    if (data.matchingSkills && data.matchingSkills.length) {
      matchingEl.innerHTML = data.matchingSkills.map(s =>
        `<span class="jm-tag jm-tag-match">${escapeHTML(s)}</span>`
      ).join('');
      matchingSection.style.display = 'block';
    }

    // Missing skills
    const missingSection = shadowRoot.getElementById('jmMissingSection');
    const missingEl = shadowRoot.getElementById('jmMissingSkills');
    if (data.missingSkills && data.missingSkills.length) {
      missingEl.innerHTML = data.missingSkills.map(s =>
        `<span class="jm-tag jm-tag-missing">${escapeHTML(s)}</span>`
      ).join('');
      missingSection.style.display = 'block';
    }

    // Recommendations
    const recsSection = shadowRoot.getElementById('jmRecsSection');
    const recsEl = shadowRoot.getElementById('jmRecs');
    if (data.recommendations && data.recommendations.length) {
      recsEl.innerHTML = data.recommendations.map(r =>
        `<li>${escapeHTML(r)}</li>`
      ).join('');
      recsSection.style.display = 'block';
    }

    // Insights
    const insightsSection = shadowRoot.getElementById('jmInsightsSection');
    const insightsEl = shadowRoot.getElementById('jmInsights');
    if (data.insights) {
      let html = '';
      if (data.insights.strengths) {
        html += `<div class="jm-insight-block"><h4>Strengths</h4><p>${escapeHTML(data.insights.strengths)}</p></div>`;
      }
      if (data.insights.gaps) {
        html += `<div class="jm-insight-block"><h4>Gaps</h4><p>${escapeHTML(data.insights.gaps)}</p></div>`;
      }
      insightsEl.innerHTML = html;
      insightsSection.style.display = 'block';

      // Keywords
      if (data.insights.keywords && data.insights.keywords.length) {
        const keySection = shadowRoot.getElementById('jmKeywordsSection');
        const keyEl = shadowRoot.getElementById('jmKeywords');
        keyEl.innerHTML = data.insights.keywords.map(k =>
          `<span class="jm-tag jm-tag-keyword">${escapeHTML(k)}</span>`
        ).join('');
        keySection.style.display = 'block';
      }
    }
  }

/**
 * Renders a quick keyword match result in the panel using the same UI sections
 * as the full AI analysis. Labels it as "Quick Match" so users know it's local.
 * Called automatically when a job is detected, before AI analysis is triggered.
 * @param {Object} result - From computeMatchScore: { score, matchedKeywords[], missingKeywords[] }
 * @param {string} title - Job title
 * @param {string} company - Company name
 * @param {string} location - Location
 * @param {string} salary - Salary
 */
export function renderQuickMatch(result, title, company, location, salary) {
    const shadowRoot = getShadowRoot();
    if (!shadowRoot) return;

    // Show job metadata
    showJobMeta(title, company, location, salary);

    // Score — show with "Quick Match" label
    const scoreSection = shadowRoot.getElementById('jmScoreSection');
    const scoreCircle = shadowRoot.getElementById('jmScoreCircle');
    const score = result.score || 0;
    scoreCircle.textContent = score;
    scoreCircle.className = 'jm-score-circle ' + getScoreClass(score);
    scoreSection.style.display = 'block';

    // Add/update "Quick Match" label below score
    let quickLabel = shadowRoot.getElementById('jmQuickMatchLabel');
    if (!quickLabel) {
      quickLabel = document.createElement('div');
      quickLabel.id = 'jmQuickMatchLabel';
      quickLabel.style.cssText = 'text-align:center;font-size:11px;color:#6b7280;margin-top:4px;font-weight:500;';
      scoreSection.appendChild(quickLabel);
    }
    quickLabel.textContent = 'Quick Match (keyword scan)';
    quickLabel.style.display = 'block';

    // Matching keywords as skill tags
    const matchingSection = shadowRoot.getElementById('jmMatchingSection');
    const matchingEl = shadowRoot.getElementById('jmMatchingSkills');
    if (result.matchedKeywords && result.matchedKeywords.length) {
      matchingEl.innerHTML = result.matchedKeywords.map(s =>
        `<span class="jm-tag jm-tag-match">${escapeHTML(s)}</span>`
      ).join('');
      matchingSection.style.display = 'block';
    }

    // Missing keywords as skill tags
    const missingSection = shadowRoot.getElementById('jmMissingSection');
    const missingEl = shadowRoot.getElementById('jmMissingSkills');
    if (result.missingKeywords && result.missingKeywords.length) {
      missingEl.innerHTML = result.missingKeywords.map(s =>
        `<span class="jm-tag jm-tag-missing">${escapeHTML(s)}</span>`
      ).join('');
      missingSection.style.display = 'block';
    }

    // Change analyze button to indicate AI upgrade available
    const btn = shadowRoot.getElementById('jmAnalyze');
    if (btn && btn.textContent === 'Analyze Job') {
      btn.textContent = 'Analyze Job';
    }
  }

/**
 * Maps a 0-100 match score to a CSS class for color-coding the score circle.
 * @param {number} score - The match score.
 * @returns {'score-green'|'score-amber'|'score-red'}
 */
function getScoreClass(score) {
    if (score >= 70) return 'score-green';
    if (score >= 45) return 'score-amber';
    return 'score-red';
  }
