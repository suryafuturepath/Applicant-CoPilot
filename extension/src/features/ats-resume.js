import { getShadowRoot, getCurrentAnalysis } from '../state.js';
import { sendMessage } from '../messaging.js';
import { setStatus, scrollPanelTo } from '../panel/status.js';
import { extractJobDescription, extractJobTitle, extractCompany } from '../platform/jd-extractor.js';

// ─── ATS Resume Generator ────────────────────────────────────

/**
 * Converts markdown to simple HTML for the mini preview inside the panel.
 * Lighter than the full PDF version — just enough for visual hierarchy.
 */
export function markdownToPreviewHTML(md) {
  return md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\*(.+)\*$/gm, '<p style="color:var(--ac-text-muted);"><em>$1</em></p>')
    .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^(?!<)(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '')
    // Wrap consecutive <li> items in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => '<ul>' + match + '</ul>');
}

export async function generateATSResume() {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  const btn = shadowRoot.getElementById('jmDoGenerateResume');
  const buildSection = shadowRoot.getElementById('jmResumeBuild');
  const resultSection = shadowRoot.getElementById('jmResumeResult');

  btn.disabled = true;
  btn.innerHTML = '<span class="jm-spinner"></span> Generating resume...';

  try {
    if (!currentAnalysis) throw new Error('Analyze the job first.');
    const jd = await extractJobDescription();
    const instructions = shadowRoot.getElementById('jmResumeInstructions').value.trim();

    const result = await sendMessage({
      type: 'GENERATE_RESUME',
      jobDescription: jd,
      jobTitle: currentAnalysis.title || extractJobTitle() || '',
      company: currentAnalysis.company || extractCompany() || '',
      customInstructions: instructions || undefined,
      url: window.location.href,
    });

    const text = typeof result === 'string' ? result : result.text;

    // Store raw markdown
    shadowRoot.getElementById('jmResumeText').textContent = text;

    // Render mini preview as formatted HTML
    const miniContent = shadowRoot.getElementById('jmResumeMiniContent');
    miniContent.innerHTML = markdownToPreviewHTML(text);

    // Show context in result header
    const meta = shadowRoot.getElementById('jmResumeResultMeta');
    const company = currentAnalysis.company || extractCompany() || '';
    const role = currentAnalysis.title || extractJobTitle() || '';
    meta.textContent = [company, role].filter(Boolean).join(' \u00B7 ');

    // Switch from build → result view
    buildSection.style.display = 'none';
    resultSection.style.display = 'block';
    scrollPanelTo(resultSection);

  } catch (err) {
    setStatus('Resume generation failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#10024; Generate Resume';
  }
}

/**
 * Opens a new tab with the generated resume as a beautifully formatted HTML page.
 * The page includes its own "Download PDF" and "Print" action bar at the top,
 * which hides when printing. No more auto-triggering the print dialog.
 * @param {string} resumeMarkdown - The raw markdown resume text.
 */
export function openResumePreviewTab(resumeMarkdown) {
  if (!resumeMarkdown || resumeMarkdown.startsWith('Error:')) return;

  const html = markdownToResumeHTML(resumeMarkdown);

  const previewWindow = window.open('', '_blank');
  previewWindow.document.write(html);
  previewWindow.document.close();

  // Attach event listeners after DOM is written (inline onclick can be blocked by CSP)
  previewWindow.addEventListener('DOMContentLoaded', () => {
    attachPreviewListeners(previewWindow);
  });
  // Fallback if DOMContentLoaded already fired
  setTimeout(() => attachPreviewListeners(previewWindow), 200);
}

/** Attaches click handlers to the preview tab's action buttons. */
function attachPreviewListeners(win) {
  try {
    const doc = win.document;
    const printBtn = doc.getElementById('resumePrintBtn');
    const copyBtn = doc.getElementById('resumeCopyBtn');
    if (printBtn && !printBtn._bound) {
      printBtn._bound = true;
      printBtn.addEventListener('click', () => win.print());
    }
    if (copyBtn && !copyBtn._bound) {
      copyBtn._bound = true;
      copyBtn.addEventListener('click', () => {
        const content = doc.querySelector('.resume-content');
        if (content) {
          win.navigator.clipboard.writeText(content.innerText).then(() => {
            copyBtn.textContent = 'Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy Text'; }, 1500);
          });
        }
      });
    }
  } catch (_) {}
}

/**
 * Converts resume markdown to clean, printable HTML with ATS-friendly styling.
 * @param {string} md - Resume text in markdown format.
 * @returns {string} Complete HTML document string.
 */
function markdownToResumeHTML(md) {
  let html = md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^\*(.+)\*$/gm, '<div class="dates">$1</div>')
    .replace(/^[•\-\*] (.+)$/gm, '<div class="bullet">&bull; $1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^(?!<)(.+)$/gm, '<p>$1</p>');

  html = html.replace(/<p><\/p>/g, '');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Resume — Applicant Copilot</title>
  <style>
    @page { margin: 0.6in 0.7in; size: letter; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 12px;
      line-height: 1.5;
      color: #1a1a1a;
      max-width: 750px;
      margin: 0 auto;
      padding: 20px 40px;
    }
    h1 { font-size: 22px; margin: 0 0 4px 0; color: #111; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 1.2px; border-bottom: 1.5px solid #333; padding-bottom: 3px; margin: 20px 0 8px 0; color: #111; }
    h3 { font-size: 13px; margin: 10px 0 2px 0; color: #111; }
    p { margin: 2px 0; font-size: 12px; color: #333; }
    .dates { font-size: 11px; color: #555; margin-bottom: 4px; font-style: italic; }
    .bullet { padding-left: 16px; text-indent: -12px; margin: 2px 0; font-size: 12px; }
    strong { font-weight: 700; }

    /* Action bar — hidden when printing */
    .action-bar {
      position: sticky;
      top: 0;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      padding: 10px 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      margin: -20px -40px 20px -40px;
      z-index: 10;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .action-bar .label {
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      margin-right: auto;
    }
    .action-bar button {
      padding: 8px 16px;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s;
    }
    .btn-primary { background: #3b82f6; color: #fff; }
    .btn-primary:hover { background: #2563eb; }
    .btn-secondary { background: #e2e8f0; color: #334155; }
    .btn-secondary:hover { background: #cbd5e1; }

    @media print {
      .action-bar { display: none !important; }
      body { padding: 0; margin: 0; max-width: 100%; }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <span class="label">Resume Preview</span>
    <button class="btn-secondary" id="resumeCopyBtn">Copy Text</button>
    <button class="btn-primary" id="resumePrintBtn">Download PDF</button>
  </div>
  <div class="resume-content">${html}</div>
</body>
</html>`;
}
