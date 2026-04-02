// panel/panel-html.js — HTML markup for the side panel
// Extracted from content-main.js getPanelHTML()

/**
 * Returns the static inner HTML string for the side panel.
 * Sections that are initially hidden (display:none) are shown
 * programmatically after analysis / autofill completes.
 * @returns {string} HTML markup for the panel body.
 */
export function getPanelHTML() {
    return `
      <div class="jm-header">
        <h2>
          <span>&#9733;</span>
          <div class="jm-title-text">
            Applicant Copilot
            <span class="jm-subtitle">Resume & Job Analyzer</span>
          </div>
        </h2>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="jm-theme-btn" id="jmThemeToggle" title="Switch theme">&#9728;&#65039;</button>
        </div>
      </div>
      <div class="jm-nav">
        <button class="jm-nav-btn active" data-nav="home">Home</button>
        <button class="jm-nav-btn" data-nav="ask-ai">Ask AI</button>
        <button class="jm-nav-btn" data-nav="saved">Saved</button>
        <button class="jm-nav-btn" data-nav="profile">Profile</button>
        <button class="jm-nav-btn" data-nav="settings">Settings</button>
      </div>
      <div class="jm-body">
        <!-- Saved Jobs tab -->
        <div class="jm-tab-content" id="jmSavedTab">
          <div class="jm-saved-list" id="jmSavedList">
            <div class="jm-saved-empty" id="jmSavedEmpty">No saved jobs yet. Click 'Save Job' on any job posting to bookmark it.</div>
          </div>
        </div>

        <!-- Interview Prep tab (sub-view of Saved) -->
        <div class="jm-tab-content" id="jmInterviewPrepTab">
          <div class="jm-prep-header">
            <button class="jm-prep-back" id="jmPrepBack" aria-label="Back to Saved Jobs">&#8592;</button>
            <div>
              <div class="jm-prep-title" id="jmPrepTitle"></div>
              <div class="jm-prep-subtitle" id="jmPrepSubtitle"></div>
            </div>
          </div>

          <!-- Start screen -->
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

          <!-- Question list -->
          <div id="jmPrepQuestionList" style="display:none">
            <div class="jm-prep-qlist-header">
              <span class="jm-prep-qlist-title" id="jmPrepQCount"></span>
              <button class="jm-btn jm-btn-sm" id="jmPrepAnalyticsBtn" disabled>View Analytics</button>
            </div>
            <div class="jm-prep-qlist" id="jmPrepQList"></div>
          </div>

          <!-- Answer view -->
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
              <button class="jm-btn" id="jmPrepBackToList">Back</button>
              <button class="jm-btn jm-btn-primary" id="jmPrepSubmitAnswer">Submit Answer</button>
            </div>
          </div>

          <!-- Feedback view -->
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
              <button class="jm-btn" id="jmPrepTryAgain">Try Again</button>
              <button class="jm-btn jm-btn-primary" id="jmPrepNextQuestion">Next Question</button>
            </div>
          </div>

          <!-- Analytics summary -->
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
                <button class="jm-btn" id="jmPrepAnalyticsBack">Back to Questions</button>
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

        <!-- Ask AI chat tab -->
        <div class="jm-tab-content" id="jmAskAiTab">
          <div class="jm-chat-container">
            <!-- Context badge — visible when analysis exists -->
            <div class="jm-chat-header" id="jmChatHeader" style="display:none">
              <span class="jm-chat-context" id="jmChatContext"></span>
              <button class="jm-chat-clear" id="jmChatClear" aria-label="Clear conversation" title="Clear conversation">&#128465;</button>
            </div>
            <!-- Messages area -->
            <div class="jm-chat-messages" id="jmChatMessages" role="log" aria-live="polite" aria-label="Chat messages">
              <!-- Empty state: no analysis -->
              <div class="jm-chat-empty" id="jmChatEmptyNoAnalysis">
                <div class="jm-chat-empty-icon">&#128172;</div>
                <div class="jm-chat-empty-title">Analyze a job first</div>
                <div class="jm-chat-empty-text">I'll have full context of the JD and your profile to help you.</div>
                <button class="jm-btn jm-btn-primary jm-chat-analyze-btn" id="jmChatAnalyzeBtn">Analyze Job</button>
              </div>
              <!-- Empty state: analysis done, no messages -->
              <div class="jm-chat-empty" id="jmChatEmptyReady" style="display:none">
                <div class="jm-chat-empty-text">I know this role and your profile. Ask me anything.</div>
                <div class="jm-chat-chips" id="jmChatChips">
                  <button class="jm-chat-chip" aria-label="Ask: Am I a good fit for this role?">Am I a good fit?</button>
                  <button class="jm-chat-chip" aria-label="Ask: Help me prepare for the interview">Interview prep</button>
                  <button class="jm-chat-chip" aria-label="Ask: Tell me about this company">Company research</button>
                  <button class="jm-chat-chip" aria-label="Ask: What should I highlight from my experience?">What to highlight?</button>
                </div>
              </div>
            </div>
            <!-- Input area — sticky bottom -->
            <div class="jm-chat-input-row" id="jmChatInputRow" style="display:none">
              <textarea class="jm-chat-input" id="jmChatInput" placeholder="Ask anything..." rows="1" aria-label="Chat message input"></textarea>
              <button class="jm-chat-send" id="jmChatSend" aria-label="Send message" title="Send">&#10148;</button>
            </div>
          </div>
        </div>

        <!-- Main content (default) -->
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

        <div class="jm-score-section" id="jmScoreSection">
          <div class="jm-score-circle" id="jmScoreCircle">--</div>
          <div class="jm-score-label">Match Score</div>
        </div>

        <div class="jm-section" id="jmMatchingSection">
          <h3>Matching Skills</h3>
          <div class="jm-tags" id="jmMatchingSkills"></div>
        </div>

        <div class="jm-section" id="jmMissingSection">
          <h3>Missing Skills</h3>
          <div class="jm-tags" id="jmMissingSkills"></div>
        </div>

        <div class="jm-section" id="jmRecsSection">
          <h3>Recommendations</h3>
          <ul class="jm-recs" id="jmRecs"></ul>
        </div>

        <div class="jm-section" id="jmInsightsSection">
          <h3>Insights</h3>
          <div id="jmInsights"></div>
        </div>

        <div class="jm-section" id="jmKeywordsSection">
          <h3>ATS Keywords</h3>
          <div class="jm-tags" id="jmKeywords"></div>
        </div>

        <!-- Truncation notice -->
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
            <button class="jm-btn jm-btn-secondary" id="jmCancelFill">Cancel</button>
          </div>
        </div>

        <!-- Cover letter output -->
        <div class="jm-section" id="jmCoverLetterSection" style="display:none">
          <div class="jm-section-head">
            <h3>Cover Letter</h3>
            <button class="jm-btn jm-btn-secondary jm-copy-btn" id="jmCopyCoverLetter">Copy</button>
          </div>
          <div class="jm-cover-letter" id="jmCoverLetterText"></div>
        </div>

        <!-- ATS Resume generator -->
        <div class="jm-section" id="jmResumeSection" style="display:none">
          <!-- Build phase — instructions + generate -->
          <div id="jmResumeBuild">
            <div class="jm-section-head">
              <h3>ATS-Optimized Resume</h3>
              <span style="font-size:11px;background:#059669;color:#fff;padding:2px 8px;border-radius:10px;">90+ ATS</span>
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

          <!-- Result phase — preview + actions -->
          <div id="jmResumeResult" style="display:none;">
            <div class="jm-resume-result-header">
              <span class="jm-resume-result-badge">&#9989; Resume ready</span>
              <span class="jm-resume-result-meta" id="jmResumeResultMeta"></span>
            </div>

            <!-- Mini rendered preview (click to open full) -->
            <div class="jm-resume-mini-preview" id="jmResumeMiniPreview" role="button" tabindex="0" aria-label="Click to open full resume preview">
              <div class="jm-resume-mini-content" id="jmResumeMiniContent"></div>
              <div class="jm-resume-mini-fade">
                <span>Click to open full preview &#8599;</span>
              </div>
            </div>

            <!-- Action buttons -->
            <div class="jm-resume-actions">
              <button class="jm-btn jm-btn-primary" id="jmOpenResumePreview" style="flex:2;">&#128196; Open Full Preview</button>
              <button class="jm-btn jm-btn-secondary" id="jmCopyResume" style="flex:1;">Copy</button>
            </div>
            <button class="jm-btn jm-btn-outline jm-resume-redo" id="jmRedoResume">&#128260; Regenerate with changes</button>

            <!-- Hidden raw markdown storage -->
            <div id="jmResumeText" style="display:none;"></div>
          </div>
        </div>

        <!-- Job notes (always visible) -->
        <div class="jm-notes-section">
          <h3>Notes</h3>
          <textarea class="jm-notes-textarea" id="jmNotesInput" placeholder="Add notes about this job — saved automatically..."></textarea>
        </div>
        </div><!-- end jmMainTab -->
      </div>
    `;
  }
