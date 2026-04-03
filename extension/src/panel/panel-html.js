// panel/panel-html.js — HTML markup for the side panel
// Restructured: 3 bottom tabs (Analysis, Coaching, Saved), gear icon header

/**
 * Returns the static inner HTML string for the side panel.
 * Sections that are initially hidden (display:none) are shown
 * programmatically after analysis / autofill completes.
 * @returns {string} HTML markup for the panel body.
 */
export function getPanelHTML() {
    return `
      <!-- Handle bar — grounds panel in browser chrome -->
      <div class="jm-handle"></div>

      <!-- Header: Brand + Gear icon -->
      <div class="jm-header">
        <div class="jm-header-brand">
          <span class="jm-header-icon">&#9650;</span>
          <span class="jm-header-title">Applicant Copilot</span>
        </div>
        <button class="jm-header-gear" id="jmGearBtn" aria-label="Settings" title="Profile & Settings">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="10" cy="10" r="3"/>
            <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4"/>
          </svg>
        </button>
      </div>

      <!-- Scrollable body -->
      <div class="jm-body">
        <!-- ═══ Analysis Tab (Home — default) ═══ -->
        <div class="jm-tab-content active" id="jmMainTab">
          <div class="jm-status" id="jmStatus"></div>

          <div class="jm-job-info" id="jmJobInfo">
            <div class="jm-job-title" id="jmJobTitle"></div>
            <div class="jm-job-company" id="jmJobCompany"></div>
            <div class="jm-job-meta">
              <span id="jmJobLocation" style="display:none">&#128205; <span id="jmJobLocationText"></span></span>
              <span id="jmJobSalary" style="display:none">&#128176; <span id="jmJobSalaryText"></span></span>
            </div>
          </div>

          <!-- Resume slot switcher -->
          <div class="jm-resume-switcher" id="jmResumeSwitch">
            <span class="jm-switch-label">Resume:</span>
            <div class="jm-switch-pills" id="jmSwitchPills"></div>
          </div>

          <div class="jm-actions">
            <button class="jm-btn jm-btn-primary" id="jmAnalyze">Analyze Job</button>
            <button class="jm-btn jm-btn-secondary" id="jmAutofill">AutoFill Application</button>
            <button class="jm-btn jm-btn-success" id="jmSaveJob" style="display:none">Save Job</button>
            <button class="jm-btn jm-btn-applied" id="jmMarkApplied" style="display:none">Mark as Applied</button>
            <button class="jm-btn jm-btn-outline" id="jmCoverLetterBtn" style="display:none">&#9993; Cover Letter</button>
            <button class="jm-btn jm-btn-outline" id="jmGenerateResumeBtn" style="display:none">&#128196; ATS Resume</button>
          </div>

          <!-- Score Section with SVG ring -->
          <div class="jm-score-section" id="jmScoreSection">
            <div class="jm-score-label-top">MATCH SCORE</div>
            <div class="jm-score-ring-container">
              <svg class="jm-score-ring" viewBox="0 0 120 120">
                <circle class="jm-score-ring-track" cx="60" cy="60" r="52" />
                <circle class="jm-score-ring-fill" id="jmScoreRingFill" cx="60" cy="60" r="52" />
              </svg>
              <div class="jm-score-value">
                <span class="jm-score-number" id="jmScoreCircle">--</span>
                <span class="jm-score-percent">%</span>
              </div>
            </div>
            <div class="jm-score-label" id="jmScoreLabel">Match Score</div>
          </div>

          <div class="jm-section" id="jmMatchingSection">
            <div class="jm-section-header">
              <span class="jm-section-icon">&#10004;</span>
              <h3>Matching Skills</h3>
              <span class="jm-section-count" id="jmMatchCount"></span>
            </div>
            <div class="jm-tags" id="jmMatchingSkills"></div>
          </div>

          <div class="jm-section" id="jmMissingSection">
            <div class="jm-section-header">
              <span class="jm-section-icon jm-icon-gap">&#9678;</span>
              <h3>Growth Gaps</h3>
            </div>
            <div class="jm-tags" id="jmMissingSkills"></div>
          </div>

          <div class="jm-section" id="jmRecsSection">
            <h3 class="jm-section-title-caps">AI Recommendations</h3>
            <ul class="jm-recs" id="jmRecs"></ul>
          </div>

          <div class="jm-section" id="jmInsightsSection">
            <h3 class="jm-section-title-caps">Insights</h3>
            <div id="jmInsights"></div>
          </div>

          <div class="jm-section" id="jmKeywordsSection">
            <h3 class="jm-section-title-caps">ATS Keywords</h3>
            <div class="jm-tags" id="jmKeywords"></div>
          </div>

          <!-- Truncation notices -->
          <div class="jm-trunc-notice" id="jmTruncNotice">
            &#9888; Job description was too long and was trimmed — match score may be approximate.
          </div>
          <div class="jm-trunc-notice" id="jmResumeTruncNotice">
            &#9888; Note: Your resume was truncated for analysis. Consider shortening it for better results.
          </div>

          <!-- AutoFill preview -->
          <div class="jm-section" id="jmAutofillPreview" style="display:none">
            <h3>Review Autofill <span id="jmPreviewCount" style="font-weight:400;color:var(--ac-text-secondary);text-transform:none;letter-spacing:0"></span></h3>
            <div class="jm-preview-list" id="jmPreviewList"></div>
            <div class="jm-preview-actions">
              <button class="jm-btn jm-btn-primary" id="jmApplyFill" style="flex:1">Apply Selected</button>
              <button class="jm-btn jm-btn-tertiary" id="jmCancelFill">Cancel</button>
            </div>
          </div>

          <!-- Cover letter output -->
          <div class="jm-section" id="jmCoverLetterSection" style="display:none">
            <div class="jm-section-head">
              <h3>Cover Letter</h3>
              <button class="jm-btn jm-btn-tertiary jm-copy-btn" id="jmCopyCoverLetter">Copy</button>
            </div>
            <div class="jm-cover-letter" id="jmCoverLetterText"></div>
          </div>

          <!-- ATS Resume generator -->
          <div class="jm-section" id="jmResumeSection" style="display:none">
            <div id="jmResumeBuild">
              <div class="jm-section-head">
                <h3>ATS-Optimized Resume</h3>
                <span class="jm-badge-green">90+ ATS</span>
              </div>
              <div style="margin-bottom:8px;">
                <div style="font-size:11px;color:var(--ac-text-secondary);margin-bottom:6px;">Tailor your resume (click to add):</div>
                <div class="jm-resume-chips" id="jmResumeChips">
                  <button class="jm-resume-chip" data-instruction="Emphasize leadership and team management">Leadership</button>
                  <button class="jm-resume-chip" data-instruction="Highlight technical skills and programming experience">Technical</button>
                  <button class="jm-resume-chip" data-instruction="Focus on quantified achievements and metrics">Metrics</button>
                  <button class="jm-resume-chip" data-instruction="Rewrite bullets to match JD keywords exactly">Match JD</button>
                  <button class="jm-resume-chip" data-instruction="Condense to fit 1 page — prioritize recent and relevant experience only">Fit 1 Page</button>
                  <button class="jm-resume-chip" data-instruction="Emphasize cross-functional collaboration and stakeholder management">Cross-functional</button>
                </div>
              </div>
              <div style="margin-bottom:10px;">
                <textarea class="jm-notes-textarea" id="jmResumeInstructions" placeholder="Add your own: e.g. 'Remove internship from 2019', 'Add AWS cert', 'Emphasize Python + ML'..." style="min-height:50px;font-size:12px;"></textarea>
              </div>
              <button class="jm-btn jm-btn-primary" id="jmDoGenerateResume" style="width:100%;">&#10024; Generate Resume</button>
            </div>

            <div id="jmResumeResult" style="display:none;">
              <div class="jm-resume-result-header">
                <span class="jm-resume-result-badge">&#9989; Resume ready</span>
                <span class="jm-resume-result-meta" id="jmResumeResultMeta"></span>
              </div>
              <div class="jm-resume-mini-preview" id="jmResumeMiniPreview" role="button" tabindex="0" aria-label="Click to open full resume preview">
                <div class="jm-resume-mini-content" id="jmResumeMiniContent"></div>
                <div class="jm-resume-mini-fade">
                  <span>Click to open full preview &#8599;</span>
                </div>
              </div>
              <div class="jm-resume-actions">
                <button class="jm-btn jm-btn-primary" id="jmOpenResumePreview" style="flex:2;">&#128196; Open Full Preview</button>
                <button class="jm-btn jm-btn-secondary" id="jmCopyResume" style="flex:1;">Copy</button>
              </div>
              <button class="jm-btn jm-btn-outline jm-resume-redo" id="jmRedoResume">&#128260; Regenerate with changes</button>
              <div id="jmResumeText" style="display:none;"></div>
            </div>
          </div>

          <!-- Job notes -->
          <div class="jm-notes-section">
            <h3 class="jm-section-title-caps">Notes</h3>
            <textarea class="jm-notes-textarea" id="jmNotesInput" placeholder="Add notes about this job — saved automatically..."></textarea>
          </div>
        </div><!-- end jmMainTab -->

        <!-- ═══ Coaching Tab (was Ask AI) ═══ -->
        <div class="jm-tab-content" id="jmAskAiTab">
          <div class="jm-chat-container">
            <!-- AI Coach header -->
            <div class="jm-coach-header" id="jmCoachHeader">
              <div class="jm-coach-avatar">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5">
                  <rect x="3" y="11" width="18" height="10" rx="2"/>
                  <circle cx="9" cy="16" r="1.5" fill="white"/>
                  <circle cx="15" cy="16" r="1.5" fill="white"/>
                  <path d="M8 11V7a4 4 0 018 0v4"/>
                </svg>
                <span class="jm-coach-dot"></span>
              </div>
              <div class="jm-coach-info">
                <div class="jm-coach-name">AI Coach</div>
                <div class="jm-coach-role">Professional Career Advisor</div>
              </div>
              <button class="jm-chat-clear" id="jmChatClear" aria-label="Clear conversation" title="Clear conversation">&#128465;</button>
            </div>

            <!-- Context badge — visible when analysis exists -->
            <div class="jm-chat-header" id="jmChatHeader" style="display:none">
              <span class="jm-chat-context" id="jmChatContext"></span>
            </div>

            <!-- Messages area -->
            <div class="jm-chat-messages" id="jmChatMessages" role="log" aria-live="polite" aria-label="Chat messages">
              <!-- Empty state: no analysis -->
              <div class="jm-chat-empty" id="jmChatEmptyNoAnalysis">
                <div class="jm-coach-avatar" style="width:48px;height:48px;margin:0 auto 12px;">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5">
                    <rect x="3" y="11" width="18" height="10" rx="2"/>
                    <circle cx="9" cy="16" r="1.5" fill="white"/>
                    <circle cx="15" cy="16" r="1.5" fill="white"/>
                    <path d="M8 11V7a4 4 0 018 0v4"/>
                  </svg>
                  <span class="jm-coach-dot"></span>
                </div>
                <div class="jm-chat-empty-title">AI Coach</div>
                <div class="jm-chat-empty-text">Analyze a job first and I'll help you prepare with strategic, personalized advice.</div>
                <button class="jm-btn jm-btn-primary jm-chat-analyze-btn" id="jmChatAnalyzeBtn">Analyze Job</button>
              </div>
              <!-- Empty state: analysis done, no messages -->
              <div class="jm-chat-empty" id="jmChatEmptyReady" style="display:none">
                <div class="jm-chat-empty-text">I've analyzed your profile and the current job description. How can I help you prepare?</div>
                <div class="jm-chat-chips" id="jmChatChips">
                  <button class="jm-chat-chip" aria-label="Ask: Am I a good fit for this role?">&#10004; Am I a good fit?</button>
                  <button class="jm-chat-chip" aria-label="Ask: Help me prepare for the interview">&#128640; How to prepare?</button>
                  <button class="jm-chat-chip" aria-label="Ask: Tell me about this company">&#128270; Company research</button>
                  <button class="jm-chat-chip" aria-label="Ask: What should I highlight from my experience?">&#11088; What to highlight?</button>
                </div>
              </div>
            </div>

            <!-- Suggested topics (visible below messages when conversation active) -->
            <div class="jm-chat-suggested" id="jmChatSuggested" style="display:none">
              <div class="jm-chat-suggested-label">SUGGESTED TOPICS</div>
              <div class="jm-chat-chips" id="jmChatSuggestedChips">
                <button class="jm-chat-chip" aria-label="Ask: Am I a good fit for this role?">&#10004; Am I a good fit?</button>
                <button class="jm-chat-chip" aria-label="Ask: Help me prepare for the interview">&#128640; How to prepare?</button>
                <button class="jm-chat-chip" aria-label="Ask: Tell me about this company">&#128270; Company research</button>
              </div>
            </div>

            <!-- Input area — sticky bottom -->
            <div class="jm-chat-input-row" id="jmChatInputRow" style="display:none">
              <textarea class="jm-chat-input" id="jmChatInput" placeholder="Ask AI Coach anything..." rows="1" aria-label="Chat message input"></textarea>
              <button class="jm-chat-send" id="jmChatSend" aria-label="Send message" title="Send">&#10148;</button>
            </div>
          </div>
        </div>

        <!-- ═══ Saved Jobs Tab ═══ -->
        <div class="jm-tab-content" id="jmSavedTab">
          <div class="jm-saved-header">
            <h2 class="jm-saved-title-main">Saved Jobs</h2>
            <p class="jm-saved-subtitle">Focus on your top opportunities.</p>
          </div>
          <div class="jm-saved-list" id="jmSavedList">
            <div class="jm-saved-empty" id="jmSavedEmpty">No saved jobs yet. Analyze and save jobs to track them here.</div>
          </div>
        </div>

        <!-- ═══ Interview Prep Tab (sub-view of Saved) ═══ -->
        <div class="jm-tab-content" id="jmInterviewPrepTab">
          <div class="jm-prep-header">
            <button class="jm-prep-back" id="jmPrepBack" aria-label="Back to Saved Jobs">&#8592;</button>
            <div>
              <div class="jm-prep-title" id="jmPrepTitle"></div>
              <div class="jm-prep-subtitle" id="jmPrepSubtitle"></div>
            </div>
          </div>

          <div id="jmPrepStart" class="jm-prep-start">
            <h3>Interview Prep</h3>
            <p>Practice with AI-generated questions tailored to this role</p>
            <div class="jm-prep-categories" id="jmPrepCategories">
              <label class="jm-prep-cat-check"><input type="checkbox" value="behavioral" checked> Behavioral</label>
              <label class="jm-prep-cat-check"><input type="checkbox" value="technical" checked> Technical</label>
              <label class="jm-prep-cat-check"><input type="checkbox" value="situational" checked> Situational</label>
              <label class="jm-prep-cat-check"><input type="checkbox" value="role-specific" checked> Role-Specific</label>
            </div>
            <div class="jm-prep-timer-toggle">
              <label><input type="checkbox" id="jmPrepTimerEnabled" checked> Enable countdown timer</label>
            </div>
            <button class="jm-btn jm-btn-primary" id="jmPrepGenerateBtn">Generate Questions</button>
          </div>

          <div id="jmPrepQuestionList" style="display:none">
            <div class="jm-prep-qlist-header">
              <span class="jm-prep-qlist-title" id="jmPrepQCount"></span>
              <button class="jm-btn jm-btn-sm" id="jmPrepAnalyticsBtn" disabled>View Analytics</button>
            </div>
            <div class="jm-prep-qlist" id="jmPrepQList"></div>
          </div>

          <div id="jmPrepAnswerView" style="display:none">
            <div class="jm-prep-qcard-header" id="jmPrepAnsHeader"></div>
            <div class="jm-prep-question-display" id="jmPrepAnsQuestion"></div>
            <div class="jm-prep-timer" id="jmPrepTimer" style="display:none">2:00</div>
            <div class="jm-prep-timer-controls" id="jmPrepTimerControls" style="display:none">
              <button class="jm-prep-timer-btn" id="jmPrepTimerPause">Pause</button>
            </div>
            <details class="jm-prep-hints" id="jmPrepHints">
              <summary>Hints (key points to cover)</summary>
              <ul id="jmPrepHintsList"></ul>
            </details>
            <textarea class="jm-prep-textarea" id="jmPrepAnswerInput" placeholder="Type your answer here..."></textarea>
            <div class="jm-prep-wordcount" id="jmPrepWordCount">0 words</div>
            <div class="jm-prep-action-row">
              <button class="jm-btn jm-btn-tertiary" id="jmPrepBackToList">Back</button>
              <button class="jm-btn jm-btn-primary" id="jmPrepSubmitAnswer">Submit Answer</button>
            </div>
          </div>

          <div id="jmPrepFeedbackView" style="display:none">
            <div class="jm-prep-score-circle" id="jmPrepScoreCircle"></div>
            <div class="jm-prep-time-badge" id="jmPrepTimeBadge"></div>
            <div class="jm-prep-feedback-section" id="jmPrepStrengths">
              <div class="jm-prep-feedback-label">Strengths</div>
              <ul class="jm-prep-feedback-list strengths" id="jmPrepStrengthsList"></ul>
            </div>
            <div class="jm-prep-feedback-section" id="jmPrepImprovements">
              <div class="jm-prep-feedback-label">Areas to Improve</div>
              <ul class="jm-prep-feedback-list improvements" id="jmPrepImprovementsList"></ul>
            </div>
            <details class="jm-prep-sample-answer">
              <summary>View Sample Answer</summary>
              <p id="jmPrepSampleAnswer"></p>
            </details>
            <div class="jm-prep-followup-banner" id="jmPrepFollowUpBanner" style="display:none">
              <p>This area needs more practice. Try a follow-up question.</p>
              <button class="jm-btn jm-btn-primary jm-btn-sm" id="jmPrepFollowUpBtn">Practice Follow-Up</button>
            </div>
            <div class="jm-prep-action-row">
              <button class="jm-btn jm-btn-tertiary" id="jmPrepTryAgain">Try Again</button>
              <button class="jm-btn jm-btn-primary" id="jmPrepNextQuestion">Next Question</button>
            </div>
          </div>

          <div id="jmPrepAnalyticsView" style="display:none">
            <div class="jm-prep-score-circle" id="jmPrepReadinessCircle" style="width:72px;height:72px;font-size:26px;"></div>
            <div style="text-align:center;font-size:12px;color:var(--ac-text-secondary);margin-bottom:12px;">Interview Readiness</div>
            <div class="jm-prep-analytics-grid">
              <div>
                <div class="jm-prep-feedback-label">Category Scores</div>
                <div id="jmPrepCategoryBars"></div>
              </div>
              <div>
                <div class="jm-prep-stat-row"><span>Questions answered</span><span class="jm-prep-stat-value" id="jmPrepStatAnswered">0</span></div>
                <div class="jm-prep-stat-row"><span>Avg. time per answer</span><span class="jm-prep-stat-value" id="jmPrepStatAvgTime">--</span></div>
                <div class="jm-prep-stat-row"><span>Follow-ups generated</span><span class="jm-prep-stat-value" id="jmPrepStatFollowUps">0</span></div>
              </div>
              <div id="jmPrepWeakAreasSection">
                <div class="jm-prep-feedback-label">Weak Areas</div>
                <ul class="jm-prep-weak-list" id="jmPrepWeakAreasList"></ul>
              </div>
              <div class="jm-prep-action-row">
                <button class="jm-btn jm-btn-tertiary" id="jmPrepAnalyticsBack">Back to Questions</button>
                <button class="jm-btn jm-btn-primary" id="jmPrepPositioningBtn" disabled>Generate Positioning Advice</button>
              </div>
              <div id="jmPrepPositioningAdvice" style="display:none">
                <div class="jm-prep-feedback-label">Positioning Strategy</div>
                <div id="jmPrepPositioningContent" style="font-size:12px;color:var(--ac-text-secondary);line-height:1.6;white-space:pre-wrap;"></div>
              </div>
              <div class="jm-prep-action-row" id="jmPrepReportRow" style="display:none">
                <button class="jm-btn jm-btn-primary" id="jmPrepFullReportBtn">View Full Report</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ Bottom Navigation Bar ═══ -->
      <div class="jm-bottom-nav">
        <button class="jm-bottom-nav-btn active" data-nav="home" aria-label="Analysis">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          <span>Analysis</span>
        </button>
        <button class="jm-bottom-nav-btn" data-nav="coaching" aria-label="Coaching">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/><path d="M8 11V7a4 4 0 018 0v4"/>
          </svg>
          <span>Coaching</span>
        </button>
        <button class="jm-bottom-nav-btn" data-nav="saved" aria-label="Saved">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
          </svg>
          <span>Saved</span>
        </button>
      </div>
    `;
  }
