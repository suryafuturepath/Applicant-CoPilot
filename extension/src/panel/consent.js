import { getShadowRoot } from '../state.js';
import { sendMessage } from '../messaging.js';

// ─── Consent banner ─────────────────────────────────────────────

export async function showConsentBannerIfNeeded() {
  const shadowRoot = getShadowRoot();
  try {
    const consent = await sendMessage({ type: 'GET_DATA_CONSENT' });
    if (consent.asked) return; // Already asked (yes or no), don't show again

    const auth = await sendMessage({ type: 'GET_AUTH_STATE' });
    if (!auth.signedIn) return; // Only ask signed-in users

    // Create banner
    let banner = shadowRoot.getElementById('jmConsentBanner');
    if (banner) return; // Already showing

    banner = document.createElement('div');
    banner.id = 'jmConsentBanner';
    banner.style.cssText = 'padding:12px 14px;margin:8px 12px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1px solid #bfdbfe;border-radius:10px;font-size:12px;line-height:1.5;color:#1e40af';
    banner.innerHTML = `
      <div style="font-weight:600;margin-bottom:6px">Help improve Applicant Copilot</div>
      <div style="color:#3b82f6;margin-bottom:10px">Share anonymous usage data to help us build better tools for job seekers. You can opt out anytime in Settings.</div>
      <div style="display:flex;gap:8px">
        <button id="jmConsentYes" style="flex:1;padding:6px 12px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:12px;font-weight:500;cursor:pointer">Yes, I'm in</button>
        <button id="jmConsentNo" style="flex:1;padding:6px 12px;background:white;color:#64748b;border:1px solid #e2e8f0;border-radius:6px;font-size:12px;cursor:pointer">No thanks</button>
      </div>`;

    // Insert at top of panel body
    const panelBody = shadowRoot.querySelector('.jm-panel-body') || shadowRoot.getElementById('jm-panel');
    if (panelBody) panelBody.prepend(banner);

    banner.querySelector('#jmConsentYes').addEventListener('click', async () => {
      await sendMessage({ type: 'SET_DATA_CONSENT', consented: true });
      banner.remove();
    });
    banner.querySelector('#jmConsentNo').addEventListener('click', async () => {
      await sendMessage({ type: 'SET_DATA_CONSENT', consented: false });
      banner.remove();
    });
  } catch (_) {}
}
