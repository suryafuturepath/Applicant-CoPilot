import { getShadowRoot, getCurrentAnalysis } from '../state.js';
import { sendMessage } from '../messaging.js';
import { escapeHTML } from '../utils.js';
import { extractJobTitle, extractCompany } from '../platform/jd-extractor.js';

// ─── Ask AI chat tab ────────────────────────────────────────────

/** Module-level chat state */
let _chatMessages = [];    // [{role: 'user'|'assistant', content: string}]
let _chatWaiting = false;  // True while waiting for AI response

/** Simple hash for URL-based chat storage keys */
function hashUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash) + url.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

/** Save chat history to chrome.storage via background.js */
function saveChatHistory() {
  const currentAnalysis = getCurrentAnalysis();
  const urlHash = hashUrl(window.location.href);
  sendMessage({
    type: 'SAVE_CHAT',
    urlHash,
    messages: _chatMessages,
    meta: {
      jobTitle: currentAnalysis?.title || extractJobTitle() || '',
      company: currentAnalysis?.company || extractCompany() || ''
    }
  }).catch(() => {});
}

/** Load chat history from chrome.storage and render it */
async function loadChatHistory() {
  const urlHash = hashUrl(window.location.href);
  try {
    const data = await sendMessage({ type: 'GET_CHAT', urlHash });
    if (data?.messages?.length > 0) {
      _chatMessages = data.messages;
      // Render all saved messages
      for (const msg of _chatMessages) {
        renderChatMessage(msg.role, msg.content);
      }
    }
  } catch (_) {}
}

/**
 * Activates the Ask AI tab: highlights nav, shows chat, hides other tabs.
 * Updates empty state based on whether analysis has been performed.
 */
export function activateAskAiTab() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  shadowRoot.querySelectorAll('.jm-nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.nav === 'ask-ai');
  });
  const askAiTab = shadowRoot.getElementById('jmAskAiTab');
  const mainTab = shadowRoot.getElementById('jmMainTab');
  const savedTab = shadowRoot.getElementById('jmSavedTab');
  if (askAiTab) askAiTab.classList.add('active');
  if (mainTab) mainTab.classList.remove('active');
  if (savedTab) savedTab.classList.remove('active');
  updateChatEmptyState();
  // Load persisted chat history for this URL (if any)
  if (_chatMessages.length === 0) {
    loadChatHistory();
  }
}

/**
 * Deactivates the Ask AI tab: hides it, restores main tab.
 */
export function deactivateAskAiTab() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const askAiTab = shadowRoot.getElementById('jmAskAiTab');
  const mainTab = shadowRoot.getElementById('jmMainTab');
  if (askAiTab) askAiTab.classList.remove('active');
  if (mainTab) mainTab.classList.add('active');
  // Remove active from ask-ai nav if it was active
  const askAiBtn = shadowRoot.querySelector('.jm-nav-btn[data-nav="ask-ai"]');
  if (askAiBtn) askAiBtn.classList.remove('active');
}

/**
 * Updates the chat empty state based on current analysis.
 * Shows "Analyze first" if no analysis, or chips + input if ready.
 */
export function updateChatEmptyState() {
  const shadowRoot = getShadowRoot();
  const currentAnalysis = getCurrentAnalysis();
  if (!shadowRoot) return;
  const noAnalysis = shadowRoot.getElementById('jmChatEmptyNoAnalysis');
  const ready = shadowRoot.getElementById('jmChatEmptyReady');
  const inputRow = shadowRoot.getElementById('jmChatInputRow');
  const header = shadowRoot.getElementById('jmChatHeader');
  const contextEl = shadowRoot.getElementById('jmChatContext');

  const hasAnalysis = !!currentAnalysis;
  const hasMessages = _chatMessages.length > 0;

  if (noAnalysis) noAnalysis.style.display = (!hasAnalysis && !hasMessages) ? 'flex' : 'none';
  if (ready) ready.style.display = (hasAnalysis && !hasMessages) ? 'flex' : 'none';
  if (inputRow) inputRow.style.display = hasAnalysis ? 'flex' : 'none';

  // Show context badge when analysis exists
  if (header && contextEl && hasAnalysis) {
    const company = currentAnalysis.company || extractCompany() || '';
    const title = currentAnalysis.title || extractJobTitle() || '';
    const score = currentAnalysis.matchScore || currentAnalysis.score || '';
    contextEl.textContent = [company, title, score ? score + '% match' : ''].filter(Boolean).join(' \u00B7 ');
    header.style.display = 'flex';
  } else if (header) {
    header.style.display = 'none';
  }
}

/**
 * Appends a message bubble to the chat area.
 * @param {'user'|'assistant'|'error'} role - The message sender.
 * @param {string} text - The message content.
 */
function renderChatMessage(role, text) {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const container = shadowRoot.getElementById('jmChatMessages');
  if (!container) return;

  // Hide empty states once messages exist
  const noAnalysis = shadowRoot.getElementById('jmChatEmptyNoAnalysis');
  const ready = shadowRoot.getElementById('jmChatEmptyReady');
  if (noAnalysis) noAnalysis.style.display = 'none';
  if (ready) ready.style.display = 'none';

  const bubble = document.createElement('div');
  bubble.className = `jm-chat-bubble jm-chat-${role}`;

  const textEl = document.createElement('div');
  textEl.className = 'jm-chat-bubble-text';
  textEl.textContent = text;
  bubble.appendChild(textEl);

  // Copy button on AI responses
  if (role === 'assistant') {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'jm-chat-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.setAttribute('aria-label', 'Copy response');
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
      });
    });
    bubble.appendChild(copyBtn);
  }

  // Retry button on error messages
  if (role === 'error') {
    const retryBtn = document.createElement('button');
    retryBtn.className = 'jm-chat-retry';
    retryBtn.textContent = 'Retry';
    retryBtn.setAttribute('aria-label', 'Retry last message');
    retryBtn.addEventListener('click', () => {
      bubble.remove();
      // Re-send the last user message
      const lastUserMsg = _chatMessages.filter(m => m.role === 'user').pop();
      if (lastUserMsg) sendChatMessage(lastUserMsg.content, true);
    });
    bubble.appendChild(retryBtn);
  }

  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
}

/** Shows the typing indicator (animated dots) */
function showTypingIndicator() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const container = shadowRoot.getElementById('jmChatMessages');
  if (!container || container.querySelector('.jm-chat-typing')) return;
  const indicator = document.createElement('div');
  indicator.className = 'jm-chat-typing';
  indicator.setAttribute('aria-label', 'AI is thinking');
  indicator.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(indicator);
  container.scrollTop = container.scrollHeight;
}

/** Removes the typing indicator */
function removeTypingIndicator() {
  const shadowRoot = getShadowRoot();
  if (!shadowRoot) return;
  const indicator = shadowRoot.querySelector('.jm-chat-typing');
  if (indicator) indicator.remove();
}

/**
 * Sends a user message to the AI and renders the response.
 * @param {string} text - The user's message.
 * @param {boolean} [isRetry=false] - If true, don't add to history (already there).
 */
export async function sendChatMessage(text, isRetry = false) {
  const shadowRoot = getShadowRoot();
  if (!text.trim() || _chatWaiting) return;

  // Render user bubble and add to history
  if (!isRetry) {
    _chatMessages.push({ role: 'user', content: text.trim() });
    renderChatMessage('user', text.trim());
  }

  // Hide suggestion chips after first message
  const chips = shadowRoot?.getElementById('jmChatChips');
  if (chips) chips.style.display = 'none';
  const readyEmpty = shadowRoot?.getElementById('jmChatEmptyReady');
  if (readyEmpty) readyEmpty.style.display = 'none';

  // Show typing indicator and disable input
  _chatWaiting = true;
  const sendBtn = shadowRoot?.getElementById('jmChatSend');
  const input = shadowRoot?.getElementById('jmChatInput');
  if (sendBtn) sendBtn.disabled = true;
  if (input) input.disabled = true;
  showTypingIndicator();

  try {
    // Send to background.js — last 10 messages for context, with 30s timeout
    const history = _chatMessages.slice(-10);
    const responsePromise = sendMessage({
      type: 'CHAT_MESSAGE',
      message: text.trim(),
      history,
      jobUrl: window.location.href
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Response timed out. The AI took too long — please try again.')), 30000)
    );
    const response = await Promise.race([responsePromise, timeoutPromise]);

    removeTypingIndicator();

    if (response?.reply) {
      _chatMessages.push({ role: 'assistant', content: response.reply });
      renderChatMessage('assistant', response.reply);
      saveChatHistory();
    } else {
      renderChatMessage('error', 'No response received. Try again.');
    }
  } catch (err) {
    removeTypingIndicator();
    renderChatMessage('error', err.message || 'Something went wrong. Try again.');
  } finally {
    _chatWaiting = false;
    if (sendBtn) sendBtn.disabled = false;
    if (input) {
      input.disabled = false;
      input.focus();
    }
  }
}

/**
 * Clears the chat UI and message history for the current page.
 */
export function clearChat() {
  const shadowRoot = getShadowRoot();
  _chatMessages = [];
  if (!shadowRoot) return;
  const container = shadowRoot.getElementById('jmChatMessages');
  if (container) {
    container.querySelectorAll('.jm-chat-bubble, .jm-chat-typing').forEach(el => el.remove());
  }
  // Clear persisted history for this URL
  const urlHash = hashUrl(window.location.href);
  sendMessage({ type: 'CLEAR_CHAT', urlHash }).catch(() => {});
  updateChatEmptyState();
}
