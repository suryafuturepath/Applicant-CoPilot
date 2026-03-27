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
const SUPABASE_ANON_KEY = 'sb_publishable_7y8gnIiUPWgXZWDPIaa6fA_7BuPEfzT'; // TODO: Paste your anon key here after project setup

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
  if (_currentSession) return _currentSession;
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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Edge function error: ${response.status}`);
  }

  return data;
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
