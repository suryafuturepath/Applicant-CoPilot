/**
 * @file supabase-client.js
 * @description Singleton Supabase client for the Applicant Copilot extension.
 *
 * Handles auth state persistence across service worker restarts by storing
 * the session in chrome.storage.local and restoring it on module load.
 *
 * IMPORTANT: SUPABASE_URL and SUPABASE_ANON_KEY are public values (shipped
 * in the extension). The anon key only grants access that RLS policies allow.
 */

import { createClient } from './libs/supabase-bundle.js';

// ─── Config (public — safe to ship in extension) ─────────────────────────────

export const SUPABASE_URL = 'https://oeeatotpwtftmvlydgsg.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9lZWF0b3Rwd3RmdG12bHlkZ3NnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1MDkxNDIsImV4cCI6MjA5MDA4NTE0Mn0.RX8yGv35gjIEVJ0a4TCKmd0PGEcD5cNEIMXUDPs28qI';

// ─── Storage keys ─────────────────────────────────────────────────────────────

const SESSION_KEY = 'supabase_session';

// ─── Client ───────────────────────────────────────────────────────────────────

let _client = null;
let _currentSession = null;

function getClient() {
  if (!_client) {
    if (!SUPABASE_ANON_KEY) {
      console.warn('[supabase-client] SUPABASE_ANON_KEY not configured');
      return null;
    }
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // We handle persistence via chrome.storage
        detectSessionInUrl: false, // We handle redirect manually
      },
    });

    // Listen for auth state changes and persist to chrome.storage
    _client.auth.onAuthStateChange((event, session) => {
      _currentSession = session;
      if (session) {
        chrome.storage.local.set({ [SESSION_KEY]: session });
      } else {
        chrome.storage.local.remove(SESSION_KEY);
      }
    });
  }
  return _client;
}

// ─── Session management ───────────────────────────────────────────────────────

/**
 * Restore session from chrome.storage.local (called on service worker wake).
 * Must be called before any auth-dependent operation.
 */
export async function restoreSession() {
  const client = getClient();
  if (!client) return null;

  const result = await chrome.storage.local.get(SESSION_KEY);
  const stored = result[SESSION_KEY];
  if (stored?.access_token && stored?.refresh_token) {
    const { data, error } = await client.auth.setSession({
      access_token: stored.access_token,
      refresh_token: stored.refresh_token,
    });
    if (error) {
      console.error('[supabase-client] Failed to restore session:', error.message);
      chrome.storage.local.remove(SESSION_KEY);
      return null;
    }
    _currentSession = data.session;
    return data.session;
  }
  return null;
}

/**
 * Get the current session (in-memory or from storage).
 */
export async function getSession() {
  if (_currentSession) {
    // Check if token is expired or about to expire (within 120s buffer)
    const expiresAt = _currentSession.expires_at;
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt && expiresAt < now + 120) {
      console.log('[supabase-client] Token expiring/expired, refreshing...');
      // Try explicit refresh first
      try {
        const client = getClient();
        if (client) {
          const { data, error } = await client.auth.refreshSession();
          if (!error && data.session) {
            _currentSession = data.session;
            chrome.storage.local.set({ [SESSION_KEY]: data.session });
            return data.session;
          }
        }
      } catch (_) {}
      // Fallback: restore from storage
      return restoreSession();
    }
    return _currentSession;
  }
  return restoreSession();
}

/**
 * Get the current user or null.
 */
export async function getUser() {
  const session = await getSession();
  return session?.user || null;
}

/**
 * Check if user is signed in.
 */
export async function isSignedIn() {
  const session = await getSession();
  return !!session;
}

// ─── Auth actions ─────────────────────────────────────────────────────────────

/**
 * Sign in with Google OAuth (opens a tab).
 * Returns the URL to open — the caller should open it in a new tab.
 */
export async function signInWithGoogle() {
  const client = getClient();
  if (!client) throw new Error('Supabase client not configured');

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${SUPABASE_URL}/auth/v1/callback`,
      skipBrowserRedirect: true, // We handle the redirect ourselves
    },
  });

  if (error) throw error;
  return data.url; // URL to open in a new tab
}

/**
 * Handle the OAuth callback URL (extract tokens and set session).
 * Called when we detect a tab navigating to our callback URL.
 */
export async function handleOAuthCallback(url) {
  const client = getClient();
  if (!client) return null;

  // Supabase returns tokens as URL hash fragments
  const hashParams = new URLSearchParams(url.split('#')[1] || '');
  const accessToken = hashParams.get('access_token');
  const refreshToken = hashParams.get('refresh_token');

  if (!accessToken || !refreshToken) {
    // Try query params (some flows use these)
    const queryParams = new URL(url).searchParams;
    const code = queryParams.get('code');
    if (code) {
      const { data, error } = await client.auth.exchangeCodeForSession(code);
      if (error) throw error;
      _currentSession = data.session;
      return data.session;
    }
    return null;
  }

  const { data, error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) throw error;
  _currentSession = data.session;
  return data.session;
}

/**
 * Sign out and clear stored session.
 */
export async function signOut() {
  const client = getClient();
  if (client) {
    await client.auth.signOut();
  }
  _currentSession = null;
  await chrome.storage.local.remove(SESSION_KEY);
}

// ─── Edge Function calls ──────────────────────────────────────────────────────

/**
 * Call a Supabase Edge Function with the current user's JWT.
 * @param {string} functionName - The edge function to call
 * @param {object} body - Request body (will be JSON-stringified)
 * @returns {Promise<object>} Parsed response data
 */
export async function callEdgeFunction(functionName, body) {
  const session = await getSession();
  if (!session) {
    throw new Error('Not signed in. Please sign in to use this feature.');
  }

  console.log('[EDGE][callEdgeFunction] Fetching:', `${SUPABASE_URL}/functions/v1/${functionName}`, 'action:', body?.action_type || 'default');
  console.log('[EDGE][callEdgeFunction] Token preview:', session.access_token?.substring(0, 30) + '...', 'expires_at:', session.expires_at);

  const response = await fetch(
    `${SUPABASE_URL}/functions/v1/${functionName}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(body),
    }
  );

  console.log('[EDGE][callEdgeFunction] Response status:', response.status);

  // Check status FIRST, then parse — response might not be JSON (e.g. HTML error page)
  if (!response.ok) {
    const text = await response.text();
    let errorMsg;
    try {
      const errData = JSON.parse(text);
      errorMsg = errData.error || errData.message || `Edge function error: ${response.status}`;
      // Include provider-level errors if the Edge Function reported them
      if (errData.provider_errors && Array.isArray(errData.provider_errors)) {
        const providerDetail = errData.provider_errors.map(
          e => `${e.provider}(${e.status || 'err'}): ${(e.error || '').substring(0, 80)}`
        ).join('; ');
        errorMsg += ` | Providers: ${providerDetail}`;
        console.warn('[EDGE][callEdgeFunction] Provider errors:', errData.provider_errors);
      }
    } catch (_) {
      errorMsg = `Edge function error: ${response.status} — ${text.substring(0, 150)}`;
    }
    console.error('[EDGE][callEdgeFunction] Error:', errorMsg);
    throw new Error(errorMsg);
  }

  return await response.json();
}

// ─── Database helpers ─────────────────────────────────────────────────────────

/**
 * Get the Supabase client for direct database operations (with RLS).
 * Returns null if not configured or not signed in.
 */
export async function getAuthenticatedClient() {
  const session = await getSession();
  if (!session) return null;
  return getClient();
}

// ─── Initialize on import ─────────────────────────────────────────────────────

// Eagerly restore session when this module is first imported
restoreSession().catch(err =>
  console.error('[supabase-client] Initial session restore failed:', err)
);
