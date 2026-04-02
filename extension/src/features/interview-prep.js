import { getShadowRoot } from '../state.js';
import { sendMessage } from '../messaging.js';
import { escapeHTML, escapeAttr } from '../utils.js';
import { setStatus, clearStatus, scrollPanelTo } from '../panel/status.js';
import { registerEventHandler } from '../panel/panel-events.js';

// ─── Interview Prep ──────────────────────────────────────────────

let _currentPrepJobId = null;
let _currentPrepSession = null;
let _currentPrepQuestionIdx = null;
let _prepTimerEnabled = true;
let _prepTimerInterval = null;
let _prepTimerRemaining = 0;
let _prepTimerPaused = false;
let _prepTimerStartTime = 0;
let _prepElapsedBeforePause = 0;

export function activateInterviewPrep(jobId, title, company, url) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  _currentPrepJobId = jobId;

  // Hide saved tab, show prep tab
  const savedTab = shadowRoot.getElementById('jmSavedTab');
  const prepTab = shadowRoot.getElementById('jmInterviewPrepTab');
  if (savedTab) savedTab.classList.remove('active');
  if (prepTab) prepTab.classList.add('active');

  // Set header
  const titleEl = shadowRoot.getElementById('jmPrepTitle');
  const subtitleEl = shadowRoot.getElementById('jmPrepSubtitle');
  if (titleEl) titleEl.textContent = title || 'Interview Prep';
  if (subtitleEl) subtitleEl.textContent = company || '';

  // Check for existing session
  sendMessage({ type: 'GET_INTERVIEW_SESSION', jobId }).then(session => {
    if (session && session.questions && session.questions.length > 0) {
      _currentPrepSession = session;
      showPrepView('questionList');
      renderPrepQuestionList(session);
    } else {
      showPrepView('start');
    }
  }).catch(() => showPrepView('start'));
}

export function deactivateInterviewPrep(returnToSaved) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  clearPrepTimer();

  const prepTab = shadowRoot.getElementById('jmInterviewPrepTab');
  const wasActive = prepTab?.classList.contains('active');
  if (prepTab) prepTab.classList.remove('active');

  // Only show saved tab if explicitly returning (back button), not when nav handler is switching tabs
  if (returnToSaved && wasActive) {
    const savedTab = shadowRoot.getElementById('jmSavedTab');
    if (savedTab) savedTab.classList.add('active');
  }

  _currentPrepJobId = null;
  _currentPrepSession = null;
  _currentPrepQuestionIdx = null;
}

function showPrepView(view) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const views = ['jmPrepStart', 'jmPrepQuestionList', 'jmPrepAnswerView', 'jmPrepFeedbackView', 'jmPrepAnalyticsView'];
  views.forEach(id => {
    const el = shadowRoot.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const map = { start: 'jmPrepStart', questionList: 'jmPrepQuestionList', answer: 'jmPrepAnswerView', feedback: 'jmPrepFeedbackView', analytics: 'jmPrepAnalyticsView' };
  const target = shadowRoot.getElementById(map[view]);
  if (target) target.style.display = 'block';
}

// Timer functions
function startPrepTimer(seconds, onExpire) {
  const shadowRoot = getShadowRoot();
  clearPrepTimer();
  _prepTimerRemaining = seconds;
  _prepTimerPaused = false;
  _prepTimerStartTime = Date.now();
  _prepElapsedBeforePause = 0;
  updateTimerDisplay();

  const timerEl = shadowRoot.getElementById('jmPrepTimer');
  const controlsEl = shadowRoot.getElementById('jmPrepTimerControls');
  if (timerEl) timerEl.style.display = 'block';
  if (controlsEl) controlsEl.style.display = 'flex';

  _prepTimerInterval = setInterval(() => {
    if (_prepTimerPaused) return;
    _prepTimerRemaining--;
    updateTimerDisplay();
    if (_prepTimerRemaining <= 0) {
      clearPrepTimer();
      if (onExpire) onExpire();
    }
  }, 1000);
}

function clearPrepTimer() {
  if (_prepTimerInterval) {
    clearInterval(_prepTimerInterval);
    _prepTimerInterval = null;
  }
}

function updateTimerDisplay() {
  const shadowRoot = getShadowRoot();
  const timerEl = shadowRoot?.getElementById('jmPrepTimer');
  if (!timerEl) return;
  const mins = Math.floor(Math.max(0, _prepTimerRemaining) / 60);
  const secs = Math.max(0, _prepTimerRemaining) % 60;
  timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  // Color coding
  const totalTime = _currentPrepSession?.questions[_currentPrepQuestionIdx]?.timeLimitSec || 120;
  const pct = _prepTimerRemaining / totalTime;
  timerEl.className = 'jm-prep-timer';
  if (pct <= 0.1) timerEl.classList.add('flash', 'critical');
  else if (pct <= 0.25) timerEl.classList.add('critical');
  else if (pct <= 0.5) timerEl.classList.add('warning');
}

function getTimeSpent() {
  const q = _currentPrepSession?.questions[_currentPrepQuestionIdx];
  if (!q) return 0;
  const totalTime = q.timeLimitSec || 120;
  return totalTime - Math.max(0, _prepTimerRemaining);
}

// Render functions
function renderPrepQuestionList(session) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const list = shadowRoot.getElementById('jmPrepQList');
  const countEl = shadowRoot.getElementById('jmPrepQCount');
  const analyticsBtn = shadowRoot.getElementById('jmPrepAnalyticsBtn');
  if (!list) return;

  list.innerHTML = '';
  const answered = session.questions.filter(q => q.evaluation).length;
  if (countEl) countEl.textContent = `${answered}/${session.questions.length} answered`;
  if (analyticsBtn) analyticsBtn.disabled = answered < 3;

  session.questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'jm-prep-qcard' + (q.isFollowUp ? ' follow-up' : '');
    card.addEventListener('click', () => {
      _currentPrepQuestionIdx = idx;
      if (q.evaluation) {
        renderPrepFeedbackView(q);
        showPrepView('feedback');
      } else {
        renderPrepAnswerView(q);
        showPrepView('answer');
      }
    });

    const header = document.createElement('div');
    header.className = 'jm-prep-qcard-header';

    if (q.isFollowUp) {
      const arrow = document.createElement('span');
      arrow.textContent = '\u21B3 ';
      arrow.style.color = 'var(--ac-primary)';
      header.appendChild(arrow);
    }

    const pill = document.createElement('span');
    pill.className = `jm-prep-category-pill jm-prep-pill-${q.category}`;
    pill.textContent = q.category;
    header.appendChild(pill);

    const diff = document.createElement('span');
    diff.className = `jm-prep-difficulty jm-prep-diff-${q.difficulty}`;
    diff.title = q.difficulty;
    header.appendChild(diff);

    card.appendChild(header);

    const text = document.createElement('div');
    text.className = 'jm-prep-qcard-text';
    text.textContent = q.question;
    card.appendChild(text);

    // Status badge
    const status = document.createElement('span');
    status.className = 'jm-prep-qcard-status';
    if (q.evaluation) {
      status.classList.add('jm-prep-status-scored');
      status.textContent = q.evaluation.score + '/10';
      const s = q.evaluation.score;
      status.style.background = s >= 7 ? '#22c55e' : s >= 4 ? '#f59e0b' : '#ef4444';
    } else {
      status.classList.add('jm-prep-status-pending');
      status.textContent = 'Pending';
    }
    card.appendChild(status);

    list.appendChild(card);
  });

  showPrepView('questionList');
}

function renderPrepAnswerView(question) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const headerEl = shadowRoot.getElementById('jmPrepAnsHeader');
  const questionEl = shadowRoot.getElementById('jmPrepAnsQuestion');
  const hintsListEl = shadowRoot.getElementById('jmPrepHintsList');
  const inputEl = shadowRoot.getElementById('jmPrepAnswerInput');
  const wordCountEl = shadowRoot.getElementById('jmPrepWordCount');

  if (headerEl) {
    headerEl.innerHTML = '';
    const pill = document.createElement('span');
    pill.className = `jm-prep-category-pill jm-prep-pill-${question.category}`;
    pill.textContent = question.category;
    headerEl.appendChild(pill);
    const diff = document.createElement('span');
    diff.className = `jm-prep-difficulty jm-prep-diff-${question.difficulty}`;
    headerEl.appendChild(diff);
    const diffLabel = document.createElement('span');
    diffLabel.textContent = question.difficulty;
    diffLabel.style.cssText = 'font-size:11px;color:var(--ac-text-muted);';
    headerEl.appendChild(diffLabel);
  }

  if (questionEl) questionEl.textContent = question.question;

  if (hintsListEl) {
    hintsListEl.innerHTML = '';
    (question.keyPoints || []).forEach(kp => {
      const li = document.createElement('li');
      li.textContent = kp;
      hintsListEl.appendChild(li);
    });
  }

  if (inputEl) {
    inputEl.value = question.userAnswer || '';
    inputEl.focus();
  }
  if (wordCountEl) wordCountEl.textContent = '0 words';

  // Start timer
  if (_prepTimerEnabled) {
    startPrepTimer(question.timeLimitSec || 120, () => {
      // Auto-submit on timer expiry
      submitCurrentAnswer();
    });
  } else {
    const timerEl = shadowRoot.getElementById('jmPrepTimer');
    const controlsEl = shadowRoot.getElementById('jmPrepTimerControls');
    if (timerEl) timerEl.style.display = 'none';
    if (controlsEl) controlsEl.style.display = 'none';
    _prepTimerStartTime = Date.now();
  }
}

function renderPrepFeedbackView(question) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot || !question.evaluation) return;
  const eval_ = question.evaluation;
  const score = eval_.score;

  const circleEl = shadowRoot.getElementById('jmPrepScoreCircle');
  if (circleEl) {
    circleEl.textContent = score + '/10';
    circleEl.className = 'jm-prep-score-circle';
    if (score >= 7) circleEl.classList.add('jm-prep-score-high');
    else if (score >= 4) circleEl.classList.add('jm-prep-score-mid');
    else circleEl.classList.add('jm-prep-score-low');
  }

  const timeBadge = shadowRoot.getElementById('jmPrepTimeBadge');
  if (timeBadge && question.timeSpentSec != null) {
    const limit = question.timeLimitSec || 120;
    timeBadge.textContent = `Answered in ${question.timeSpentSec}s (${Math.floor(limit / 60)}:${(limit % 60).toString().padStart(2, '0')} limit)`;
  }

  const strengthsList = shadowRoot.getElementById('jmPrepStrengthsList');
  if (strengthsList) {
    strengthsList.innerHTML = '';
    (eval_.strengths || []).forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      strengthsList.appendChild(li);
    });
  }

  const improvementsList = shadowRoot.getElementById('jmPrepImprovementsList');
  if (improvementsList) {
    improvementsList.innerHTML = '';
    (eval_.improvements || []).forEach(s => {
      const li = document.createElement('li');
      li.textContent = s;
      improvementsList.appendChild(li);
    });
  }

  const sampleEl = shadowRoot.getElementById('jmPrepSampleAnswer');
  if (sampleEl) sampleEl.textContent = eval_.sampleAnswer || '';

  // Follow-up banner
  const banner = shadowRoot.getElementById('jmPrepFollowUpBanner');
  if (banner) banner.style.display = score < 5 ? 'block' : 'none';
}

function renderPrepAnalytics(session) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const analytics = session.analytics;

  const readinessEl = shadowRoot.getElementById('jmPrepReadinessCircle');
  if (readinessEl) {
    readinessEl.textContent = analytics.overallReadiness + '%';
    readinessEl.className = 'jm-prep-score-circle';
    readinessEl.style.cssText = 'width:72px;height:72px;font-size:26px;';
    if (analytics.overallReadiness >= 70) readinessEl.classList.add('jm-prep-score-high');
    else if (analytics.overallReadiness >= 40) readinessEl.classList.add('jm-prep-score-mid');
    else readinessEl.classList.add('jm-prep-score-low');
  }

  // Category bars
  const barsEl = shadowRoot.getElementById('jmPrepCategoryBars');
  if (barsEl) {
    barsEl.innerHTML = '';
    const cats = [
      { key: 'behavioral', label: 'Behavioral', color: '#3b82f6' },
      { key: 'technical', label: 'Technical', color: '#8b5cf6' },
      { key: 'situational', label: 'Situational', color: '#f97316' },
      { key: 'role-specific', label: 'Role-Specific', color: '#22c55e' },
    ];
    cats.forEach(cat => {
      const val = analytics.categoryScores[cat.key];
      const container = document.createElement('div');
      container.className = 'jm-prep-bar-container';
      const label = document.createElement('div');
      label.className = 'jm-prep-bar-label';
      label.innerHTML = `<span>${cat.label}</span><span>${val != null ? val + '%' : '--'}</span>`;
      const track = document.createElement('div');
      track.className = 'jm-prep-bar-track';
      const fill = document.createElement('div');
      fill.className = 'jm-prep-bar-fill';
      fill.style.width = (val || 0) + '%';
      fill.style.background = cat.color;
      track.appendChild(fill);
      container.appendChild(label);
      container.appendChild(track);
      barsEl.appendChild(container);
    });
  }

  // Stats
  const answeredEl = shadowRoot.getElementById('jmPrepStatAnswered');
  if (answeredEl) answeredEl.textContent = `${analytics.questionsAnswered}/${analytics.questionsTotal}`;
  const avgTimeEl = shadowRoot.getElementById('jmPrepStatAvgTime');
  if (avgTimeEl) avgTimeEl.textContent = analytics.avgTimePerAnswer ? analytics.avgTimePerAnswer + 's' : '--';
  const followUpsEl = shadowRoot.getElementById('jmPrepStatFollowUps');
  if (followUpsEl) followUpsEl.textContent = analytics.followUpsGenerated;

  // Weak areas
  const weakList = shadowRoot.getElementById('jmPrepWeakAreasList');
  const weakSection = shadowRoot.getElementById('jmPrepWeakAreasSection');
  if (weakList && weakSection) {
    weakList.innerHTML = '';
    if (analytics.weakAreas && analytics.weakAreas.length > 0) {
      weakSection.style.display = 'block';
      analytics.weakAreas.forEach(w => {
        const li = document.createElement('li');
        li.textContent = w;
        weakList.appendChild(li);
      });
    } else {
      weakSection.style.display = 'none';
    }
  }

  // Positioning button
  const posBtn = shadowRoot.getElementById('jmPrepPositioningBtn');
  if (posBtn) posBtn.disabled = analytics.questionsAnswered < 5;

  // Positioning advice (if already generated)
  const posAdviceEl = shadowRoot.getElementById('jmPrepPositioningAdvice');
  const posContentEl = shadowRoot.getElementById('jmPrepPositioningContent');
  const reportRow = shadowRoot.getElementById('jmPrepReportRow');
  if (analytics.positioningAdvice && posAdviceEl && posContentEl) {
    posAdviceEl.style.display = 'block';
    posContentEl.textContent = analytics.positioningAdvice;
    if (reportRow) reportRow.style.display = 'flex';
  } else if (posAdviceEl) {
    posAdviceEl.style.display = 'none';
    if (reportRow) reportRow.style.display = 'none';
  }

  showPrepView('analytics');
}

async function submitCurrentAnswer() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot || _currentPrepQuestionIdx == null || !_currentPrepSession) return;
  const inputEl = shadowRoot.getElementById('jmPrepAnswerInput');
  const answer = inputEl?.value?.trim() || '';
  if (!answer) return;

  clearPrepTimer();
  const q = _currentPrepSession.questions[_currentPrepQuestionIdx];
  const timeSpent = _prepTimerEnabled ? getTimeSpent() : Math.round((Date.now() - _prepTimerStartTime) / 1000);

  // Show loading
  const submitBtn = shadowRoot.getElementById('jmPrepSubmitAnswer');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Evaluating...'; }

  try {
    const result = await sendMessage({
      type: 'EVALUATE_INTERVIEW_ANSWER',
      jobId: _currentPrepJobId,
      questionId: q.id,
      question: q.question,
      userAnswer: answer,
      category: q.category,
      keyPoints: q.keyPoints,
      timeSpentSec: timeSpent,
    });

    // Update local session
    _currentPrepSession.questions[_currentPrepQuestionIdx].userAnswer = answer;
    _currentPrepSession.questions[_currentPrepQuestionIdx].timeSpentSec = timeSpent;
    _currentPrepSession.questions[_currentPrepQuestionIdx].answeredAt = Date.now();
    _currentPrepSession.questions[_currentPrepQuestionIdx].evaluation = result.evaluation;
    _currentPrepSession.analytics = result.analytics;

    renderPrepFeedbackView(_currentPrepSession.questions[_currentPrepQuestionIdx]);
    showPrepView('feedback');

    // Show follow-up banner if needed
    const banner = shadowRoot.getElementById('jmPrepFollowUpBanner');
    if (banner) banner.style.display = result.shouldFollowUp ? 'block' : 'none';

  } catch (err) {
    if (submitBtn) submitBtn.textContent = 'Error - Retry';
    console.error('[prep] Evaluation failed:', err);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; if (submitBtn.textContent === 'Evaluating...') submitBtn.textContent = 'Submit Answer'; }
  }
}

async function handlePrepFollowUp() {
  const shadowRoot = getShadowRoot();
  if (!_currentPrepSession || _currentPrepQuestionIdx == null) return;
  const q = _currentPrepSession.questions[_currentPrepQuestionIdx];

  const followUpBtn = shadowRoot.getElementById('jmPrepFollowUpBtn');
  if (followUpBtn) { followUpBtn.disabled = true; followUpBtn.textContent = 'Generating...'; }

  try {
    const result = await sendMessage({
      type: 'GENERATE_FOLLOWUP_QUESTION',
      jobId: _currentPrepJobId,
      parentQuestionId: q.id,
      question: q.question,
      userAnswer: q.userAnswer,
      evaluation: q.evaluation,
      category: q.category,
    });

    _currentPrepSession = result.session;
    renderPrepQuestionList(_currentPrepSession);

  } catch (err) {
    console.error('[prep] Follow-up generation failed:', err);
    if (followUpBtn) followUpBtn.textContent = 'Error - Retry';
  } finally {
    if (followUpBtn) { followUpBtn.disabled = false; if (followUpBtn.textContent === 'Generating...') followUpBtn.textContent = 'Practice Follow-Up'; }
  }
}

async function handleGeneratePrepQuestions() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const categories = [];
  shadowRoot.querySelectorAll('#jmPrepCategories input:checked').forEach(cb => categories.push(cb.value));
  _prepTimerEnabled = shadowRoot.getElementById('jmPrepTimerEnabled')?.checked !== false;

  if (categories.length === 0) return;

  const btn = shadowRoot.getElementById('jmPrepGenerateBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating questions...'; }

  try {
    const session = await sendMessage({
      type: 'GENERATE_INTERVIEW_QUESTIONS',
      jobId: _currentPrepJobId,
      jobUrl: window.location.href,
      categories,
    });

    _currentPrepSession = session;
    renderPrepQuestionList(session);

  } catch (err) {
    console.error('[prep] Question generation failed:', err);
    const errMsg = err?.message || String(err);
    if (btn) btn.textContent = 'Error - Retry';
    // Show error detail below the button
    let errDiv = shadowRoot?.getElementById('jmPrepError');
    if (!errDiv) {
      errDiv = document.createElement('div');
      errDiv.id = 'jmPrepError';
      errDiv.style.cssText = 'color:#dc2626;font-size:12px;padding:10px;background:#fef2f2;border-radius:8px;margin-top:10px;line-height:1.4';
      btn?.parentNode?.appendChild(errDiv);
    }
    errDiv.textContent = errMsg;
  } finally {
    if (btn) { btn.disabled = false; if (btn.textContent === 'Generating questions...') btn.textContent = 'Generate Questions'; }
  }
}

function renderPrepQuestionListFromSession() {
  if (_currentPrepSession) renderPrepQuestionList(_currentPrepSession);
}

function renderPrepAnalyticsFromSession() {
  if (_currentPrepSession) renderPrepAnalytics(_currentPrepSession);
}

function handleNextQuestion() {
  if (!_currentPrepSession) return;
  const questions = _currentPrepSession.questions || [];
  const nextIdx = (_currentPrepQuestionIdx || 0) + 1;
  if (nextIdx < questions.length) {
    _currentPrepQuestionIdx = nextIdx;
    renderPrepAnswerView(questions[nextIdx]);
  } else {
    renderPrepQuestionList(_currentPrepSession);
  }
}

function handleTryAgain() {
  if (!_currentPrepSession) return;
  const questions = _currentPrepSession.questions || [];
  const q = questions[_currentPrepQuestionIdx];
  if (q) {
    q.userAnswer = null;
    q.evaluation = null;
    renderPrepAnswerView(q);
  }
}

function togglePrepTimerPause(btn) {
  if (_prepTimerPaused) {
    _prepTimerPaused = false;
    _prepTimerStartTime = Date.now();
    _prepTimerInterval = setInterval(updateTimerDisplay, 1000);
    if (btn) btn.textContent = 'Pause';
  } else {
    _prepTimerPaused = true;
    _prepElapsedBeforePause += (Date.now() - _prepTimerStartTime) / 1000;
    clearInterval(_prepTimerInterval);
    if (btn) btn.textContent = 'Resume';
  }
}

function handleFullReport() {
  // Open report in a new tab if the session has enough data
  if (!_currentPrepSession) return;
  const shadowRoot = getShadowRoot();
  sendMessage({ type: 'OPEN_PROFILE_TAB', hash: 'report' });
}

async function handleGeneratePositioning() {
  const shadowRoot = getShadowRoot();
  const btn = shadowRoot?.getElementById('jmPrepPositioningBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

  try {
    const result = await sendMessage({
      type: 'GENERATE_POSITIONING_ADVICE',
      jobId: _currentPrepJobId,
    });

    _currentPrepSession.analytics = result.analytics;
    renderPrepAnalytics(_currentPrepSession);

  } catch (err) {
    console.error('[prep] Positioning advice failed:', err);
    if (btn) btn.textContent = 'Error - Retry';
  } finally {
    if (btn) { btn.disabled = false; if (btn.textContent === 'Generating...') btn.textContent = 'Generate Positioning Advice'; }
  }
}

/**
 * Registers all interview prep handler functions with the panel-events registry.
 * Must be called at startup so wireEvents() can invoke them via call().
 */
export function registerInterviewPrepHandlers() {
  registerEventHandler('deactivateInterviewPrep', deactivateInterviewPrep);
  registerEventHandler('handleGeneratePrepQuestions', handleGeneratePrepQuestions);
  registerEventHandler('submitCurrentAnswer', submitCurrentAnswer);
  registerEventHandler('clearPrepTimer', clearPrepTimer);
  registerEventHandler('renderPrepQuestionListFromSession', renderPrepQuestionListFromSession);
  registerEventHandler('handleNextQuestion', handleNextQuestion);
  registerEventHandler('handleTryAgain', handleTryAgain);
  registerEventHandler('handlePrepFollowUp', handlePrepFollowUp);
  registerEventHandler('renderPrepAnalyticsFromSession', renderPrepAnalyticsFromSession);
  registerEventHandler('handleGeneratePositioning', handleGeneratePositioning);
  registerEventHandler('handleFullReport', handleFullReport);
  registerEventHandler('togglePrepTimerPause', togglePrepTimerPause);
}
