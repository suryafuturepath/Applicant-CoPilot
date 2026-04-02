// utils.js — HTML/attribute escaping utilities

const _escDiv = document.createElement('div');

/**
 * Escapes a string for safe insertion into HTML via innerHTML.
 * Uses the browser's own text node serialisation so all special characters
 * (&, <, >, ", ') are correctly escaped without a manual replacement table.
 * @param {string} str - The raw string to escape.
 * @returns {string} HTML-safe string.
 */
export function escapeHTML(str) {
  _escDiv.textContent = str;
  return _escDiv.innerHTML;
}

/**
 * Escapes a string for safe insertion into an HTML attribute value.
 * @param {string} str - The raw string to escape.
 * @returns {string} Attribute-safe string.
 */
export function escapeAttr(str) {
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
