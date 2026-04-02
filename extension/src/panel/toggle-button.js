// panel/toggle-button.js — Draggable floating ★ toggle button
// Extracted from content-main.js createToggleButton()

import { setToggleBtnRef } from '../state.js';
import { getPanelCSS } from './panel-css.js';
import { togglePanel } from './panel-core.js';

// ─── Toggle button (always visible) ────────────────────────────
// The ★ button is a separate Shadow DOM host from the panel so it can float
// freely without interfering with the panel's stacking context.
// It supports both mouse drag and touch drag, and persists its last position
// across page navigations using localStorage.

/**
 * Creates the draggable floating ★ toggle button and appends it to the page.
 *
 * Position is restored from localStorage on creation. Drag state is tracked
 * with mousedown/mousemove/mouseup (and touch equivalents). A click only fires
 * togglePanel() if the button was not meaningfully dragged (delta < 4px).
 */
export function createToggleButton() {
    const btn = document.createElement('button');
    btn.className = 'jm-toggle';
    btn.id = 'applicant-copilot-toggle';
    btn.innerHTML = '&#9733;';
    btn.title = 'Applicant Copilot';
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', 'Open Applicant Copilot panel');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('tabindex', '0');
    setToggleBtnRef(btn);

    // Restore saved position or default to bottom-right
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem('ac-fab-pos')); } catch { return null; }
    })();
    const defaultRight = 24;
    const defaultBottom = 24;
    if (saved && typeof saved.right === 'number' && typeof saved.bottom === 'number') {
      btn.style.right  = saved.right + 'px';
      btn.style.bottom = saved.bottom + 'px';
      btn.style.left   = 'auto';
      btn.style.top    = 'auto';
    } else {
      btn.style.right  = defaultRight + 'px';
      btn.style.bottom = defaultBottom + 'px';
      btn.style.left   = 'auto';
      btn.style.top    = 'auto';
    }

    // ── Drag logic ──
    let didDrag = false, startX, startY, startRight, startBottom;
    const MIN_MARGIN = 8;
    const DRAG_THRESHOLD = 4;

    function onMove(e) {
      const cx = e.touches ? e.touches[0].clientX : e.clientX;
      const cy = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = cx - startX;
      const dy = cy - startY;

      // Only start dragging after movement exceeds threshold
      if (!didDrag && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      didDrag = true;
      btn.classList.add('dragging');

      // Calculate new right/bottom with bounds checking (8px min margin)
      let newRight  = startRight - dx;
      let newBottom = startBottom - dy;
      newRight  = Math.max(MIN_MARGIN, Math.min(newRight,  window.innerWidth  - 48 - MIN_MARGIN));
      newBottom = Math.max(MIN_MARGIN, Math.min(newBottom, window.innerHeight - 48 - MIN_MARGIN));

      btn.style.right  = newRight + 'px';
      btn.style.bottom = newBottom + 'px';
      btn.style.left   = 'auto';
      btn.style.top    = 'auto';
    }

    function onEnd(e) {
      btn.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onEnd);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend',  onEnd);

      if (didDrag) {
        // Save position as {right, bottom}
        const pos = {
          right:  parseInt(btn.style.right,  10),
          bottom: parseInt(btn.style.bottom, 10)
        };
        try { localStorage.setItem('ac-fab-pos', JSON.stringify(pos)); } catch {}
      }
    }

    btn.addEventListener('mousedown', e => {
      startX = e.clientX; startY = e.clientY;
      startRight  = parseInt(btn.style.right,  10) || defaultRight;
      startBottom = parseInt(btn.style.bottom, 10) || defaultBottom;
      didDrag = false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onEnd);
      e.preventDefault();
    });

    btn.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      startRight  = parseInt(btn.style.right,  10) || defaultRight;
      startBottom = parseInt(btn.style.bottom, 10) || defaultBottom;
      didDrag = false;
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend',  onEnd);
      e.preventDefault();
    }, { passive: false });

    // Only fire click if not dragged (threshold already checked during move)
    btn.addEventListener('click', e => {
      if (!didDrag) togglePanel();
    });

    // Keyboard accessibility: Enter and Space trigger toggle
    btn.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        togglePanel();
      }
    });

    // Attach to shadow root for isolation
    const host = document.createElement('div');
    host.id = 'applicant-copilot-toggle-host';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = getPanelCSS();
    shadow.appendChild(style);
    shadow.appendChild(btn);
    document.body.appendChild(host);
  }
