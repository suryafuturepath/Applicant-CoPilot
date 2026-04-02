// messaging.js — Chrome runtime message passing wrapper

/**
 * Sends a message to the background service worker and returns a Promise.
 * Wraps chrome.runtime.sendMessage to:
 *  - Check chrome.runtime.id before sending (detects invalidated extension context)
 *  - Translate the { success, data/error } envelope into resolve/reject
 *  - Provide a user-friendly error when the extension has been updated mid-session
 * @param {Object} msg - The message object to send (must have a `type` field).
 * @returns {Promise<*>} Resolves with resp.data on success, rejects with Error on failure.
 */
export function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      if (!chrome.runtime?.id) {
        return reject(new Error('Extension was updated. Please refresh this page (F5) and try again.'));
      }
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) {
          const errMsg = chrome.runtime.lastError.message || '';
          if (errMsg.includes('invalidated') || errMsg.includes('Extension context')) {
            return reject(new Error('Extension was updated. Please refresh this page (F5) and try again.'));
          }
          return reject(new Error(errMsg));
        }
        if (!resp) return reject(new Error('No response'));
        if (!resp.success) return reject(new Error(resp.error));
        resolve(resp.data);
      });
    } catch (e) {
      reject(new Error('Extension was updated. Please refresh this page (F5) and try again.'));
    }
  });
}
