// auto-scan/score-widget.js — Floating Score Widget
// Shadow DOM badge + expandable card showing keyword match score.

// Module-local state
let _scoreWidgetHost = null;
let _scoreWidgetShadow = null;
let _scoreWidgetExpanded = false;

// Callbacks for panel integration — set via initScoreWidget()
let _ensureInitialized = null;
let _togglePanel = null;
let _analyzeJob = null;
let _getPanelOpen = null;
let _getShadowRoot = null;
let _getCurrentAnalysis = null;

/**
 * Initializes the score widget with callbacks to panel functions.
 * Must be called before showScoreWidget().
 * @param {Object} callbacks
 * @param {Function} callbacks.ensureInitialized
 * @param {Function} callbacks.togglePanel
 * @param {Function} callbacks.getPanelOpen
 * @param {Function} callbacks.getShadowRoot
 * @param {Function} callbacks.getCurrentAnalysis
 */
export function initScoreWidget({ ensureInitialized, togglePanel, analyzeJob, getPanelOpen, getShadowRoot, getCurrentAnalysis }) {
  _ensureInitialized = ensureInitialized;
  _togglePanel = togglePanel;
  _analyzeJob = analyzeJob;
  _getPanelOpen = getPanelOpen;
  _getShadowRoot = getShadowRoot;
  _getCurrentAnalysis = getCurrentAnalysis;
}

function getScoreColor(score) {
  if (score >= 70) return '#16a34a'; // green
  if (score >= 40) return '#d97706'; // amber
  return '#dc2626'; // red
}

function getScoreTrackColor(score) {
  if (score >= 70) return '#dcfce7';
  if (score >= 40) return '#fef3c7';
  return '#fee2e2';
}

function createScoreWidget() {
  const host = document.createElement('div');
  host.id = 'applicant-copilot-score-host';
  host.style.cssText = 'position:fixed;bottom:24px;left:24px;z-index:2147483644;pointer-events:auto;';

  const shadow = host.attachShadow({ mode: 'closed' });
  _scoreWidgetShadow = shadow;

  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .ac-widget {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .ac-badge {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 2px 12px rgba(0,0,0,0.18);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
      border: 2px solid #e5e7eb;
    }
    .ac-badge:hover {
      transform: scale(1.08);
      box-shadow: 0 4px 16px rgba(0,0,0,0.22);
    }

    .ac-badge svg {
      position: absolute;
      top: 0; left: 0;
      width: 48px; height: 48px;
      transform: rotate(-90deg);
    }
    .ac-badge svg circle {
      fill: none;
      stroke-width: 3;
    }
    .ac-badge-track { stroke: #e5e7eb; }
    .ac-badge-progress {
      stroke-linecap: round;
      transition: stroke-dasharray 0.5s ease, stroke 0.5s ease;
    }

    .ac-badge-score {
      font-size: 15px;
      font-weight: 700;
      z-index: 1;
      color: #374151;
      line-height: 1;
    }
    .ac-badge-label {
      font-size: 7px;
      font-weight: 500;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      position: absolute;
      bottom: 5px;
      z-index: 1;
    }

    .ac-card {
      display: none;
      width: 260px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15);
      padding: 14px;
      margin-bottom: 8px;
      animation: ac-slide-up 0.2s ease;
      border: 1px solid #e5e7eb;
    }
    .ac-card.open { display: block; }

    @keyframes ac-slide-up {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .ac-card-header {
      font-size: 12px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ac-card-header span { font-size: 14px; }

    .ac-kw-section { margin-bottom: 10px; }
    .ac-kw-label {
      font-size: 11px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 4px;
    }
    .ac-kw-tags { display: flex; flex-wrap: wrap; gap: 4px; }

    .ac-kw-tag {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
    }
    .ac-kw-tag.match { background: #dcfce7; color: #166534; }
    .ac-kw-tag.missing { background: #fee2e2; color: #991b1b; }

    .ac-full-btn {
      width: 100%;
      padding: 8px;
      border: 1px solid #3b82f6;
      background: #eff6ff;
      color: #2563eb;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease;
      text-align: center;
    }
    .ac-full-btn:hover { background: #dbeafe; }
  `;
  shadow.appendChild(style);

  const widget = document.createElement('div');
  widget.className = 'ac-widget';
  widget.innerHTML = `
    <div class="ac-card" id="acCard">
      <div class="ac-card-header"><span>&#9889;</span> Quick Match</div>
      <div class="ac-kw-section">
        <div class="ac-kw-label">Matching</div>
        <div class="ac-kw-tags" id="acMatchTags"></div>
      </div>
      <div class="ac-kw-section">
        <div class="ac-kw-label">Missing from profile</div>
        <div class="ac-kw-tags" id="acMissTags"></div>
      </div>
      <button class="ac-full-btn" id="acFullBtn">Full AI Analysis &rarr;</button>
    </div>
    <div class="ac-badge" id="acBadge" role="status" aria-label="Keyword match score" tabindex="0">
      <svg viewBox="0 0 48 48">
        <circle class="ac-badge-track" cx="24" cy="24" r="20" />
        <circle class="ac-badge-progress" id="acRing" cx="24" cy="24" r="20" />
      </svg>
      <span class="ac-badge-score" id="acScore">0</span>
      <span class="ac-badge-label">match</span>
    </div>
  `;
  shadow.appendChild(widget);

  // Wire interactions
  const badge = shadow.getElementById('acBadge');
  const card = shadow.getElementById('acCard');
  const fullBtn = shadow.getElementById('acFullBtn');

  badge.addEventListener('click', () => {
    _scoreWidgetExpanded = !_scoreWidgetExpanded;
    card.classList.toggle('open', _scoreWidgetExpanded);
  });
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      badge.click();
    }
  });

  fullBtn.addEventListener('click', () => {
    _scoreWidgetExpanded = false;
    card.classList.remove('open');
    if (_ensureInitialized) _ensureInitialized();
    if (_getPanelOpen && !_getPanelOpen()) {
      if (_togglePanel) _togglePanel();
    }
    // Trigger full AI analysis if not already done
    if (_getCurrentAnalysis && !_getCurrentAnalysis()) {
      setTimeout(() => {
        const shadowRoot = _getShadowRoot ? _getShadowRoot() : null;
        const btn = shadowRoot?.getElementById('jmAnalyze');
        if (btn && btn.textContent !== 'Re-Analyze') btn.click();
      }, 300);
    }
  });

  // Close card on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _scoreWidgetExpanded) {
      _scoreWidgetExpanded = false;
      card.classList.remove('open');
    }
  });

  document.body.appendChild(host);
  _scoreWidgetHost = host;
  console.log('[AC][scoreWidget] Widget created and appended to body');
}

export function showScoreWidget(result) {
  if (!_scoreWidgetHost) createScoreWidget();

  const shadow = _scoreWidgetShadow;
  const score = result.score;
  const color = getScoreColor(score);
  const trackColor = getScoreTrackColor(score);

  // Update score number
  shadow.getElementById('acScore').textContent = score;

  // Update ring arc
  const circumference = 2 * Math.PI * 20; // r=20
  const dashLen = (score / 100) * circumference;
  const ring = shadow.getElementById('acRing');
  ring.style.stroke = color;
  ring.style.strokeDasharray = `${dashLen} ${circumference}`;

  // Update track color
  shadow.querySelector('.ac-badge-track').style.stroke = trackColor;

  // Update border
  shadow.querySelector('.ac-badge').style.borderColor = color;

  // Update matched keywords
  const matchTags = shadow.getElementById('acMatchTags');
  matchTags.innerHTML = result.matchedKeywords.slice(0, 5)
    .map(kw => `<span class="ac-kw-tag match">${kw}</span>`).join('');
  if (result.matchedKeywords.length === 0) {
    matchTags.innerHTML = '<span style="color:#9ca3af;font-size:11px">None found</span>';
  }

  // Update missing keywords
  const missTags = shadow.getElementById('acMissTags');
  missTags.innerHTML = result.missingKeywords.slice(0, 5)
    .map(kw => `<span class="ac-kw-tag missing">${kw}</span>`).join('');
  if (result.missingKeywords.length === 0) {
    missTags.innerHTML = '<span style="color:#9ca3af;font-size:11px">Great coverage!</span>';
  }

  // Update aria label
  shadow.getElementById('acBadge').setAttribute('aria-label', `Keyword match score: ${score}%`);

  // Collapse card on new job
  _scoreWidgetExpanded = false;
  shadow.getElementById('acCard').classList.remove('open');

  _scoreWidgetHost.style.display = 'block';
  console.log('[AC][scoreWidget] Widget shown, score:', score, 'host display:', _scoreWidgetHost.style.display, 'host in DOM:', !!_scoreWidgetHost.parentNode);
}

export function hideScoreWidget() {
  if (_scoreWidgetHost) {
    _scoreWidgetHost.style.display = 'none';
    _scoreWidgetExpanded = false;
    if (_scoreWidgetShadow) {
      const card = _scoreWidgetShadow.getElementById('acCard');
      if (card) card.classList.remove('open');
    }
  }
}
