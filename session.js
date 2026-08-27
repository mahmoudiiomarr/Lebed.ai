/**
 * session.js — shared session-refresh helper for LEBED.ai
 * ------------------------------------------------------------------
 * Works with the app's existing localStorage-based session
 * (lebed_token / lebed_refresh_token) rather than supabase-js's own
 * persisted session, since auth.js/settings.js manage tokens manually
 * and pass access_token explicitly to the 'auth' Edge Function.
 *
 * Load this BEFORE auth.js and settings.js:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="supabase-config.js"></script>
 *   <script src="session.js"></script>
 *   <script src="auth.js"></script>      (index.html)
 *   <script src="settings.js"></script>  (settings.html)
 * ------------------------------------------------------------------
 */

const SESSION_REFRESH_BUFFER_MS = 60_000; // refresh if <60s of life left

function decodeJwtExpiryMs(token) {
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
    );
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null; // malformed/opaque token — treat as "needs refresh"
  }
}

function clearLocalSession() {
  localStorage.removeItem('lebed_token');
  localStorage.removeItem('lebed_refresh_token');
  localStorage.removeItem('lebed_user_logged');
  localStorage.removeItem('lebed_auth_session');
  localStorage.removeItem('lebed_chats');
}

// There's no separate /login route in this app — signing in is the
// #authOverlay modal on index.html. Point redirectTo elsewhere if you
// later add a dedicated login page.
function redirectToLogin(redirectTo = 'index.html') {
  window.location.href = redirectTo;
}

/**
 * Returns a valid access token, refreshing it first if it's expired or
 * about to expire. Returns null (and redirects to sign-in) if there's
 * no session or the refresh itself fails — callers should bail out
 * immediately when they get null back.
 *
 * @param {object} supabaseClient - a client created with persistSession:
 *   true, autoRefreshToken: true (see settings.js / auth.js).
 * @param {object} [opts]
 * @param {string} [opts.redirectTo] - where to send the user if the
 *   session can't be recovered.
 */
async function ensureValidAccessToken(supabaseClient, { redirectTo = 'index.html' } = {}) {
  const accessToken = localStorage.getItem('lebed_token');
  const refreshToken = localStorage.getItem('lebed_refresh_token');

  if (!accessToken || !refreshToken) {
    redirectToLogin(redirectTo);
    return null;
  }

  const expiresAt = decodeJwtExpiryMs(accessToken);
  const needsRefresh = !expiresAt || (expiresAt - Date.now()) < SESSION_REFRESH_BUFFER_MS;
  if (!needsRefresh) return accessToken;

  if (!supabaseClient) {
    // No client to refresh with — can't recover, treat as expired.
    clearLocalSession();
    redirectToLogin(redirectTo);
    return null;
  }

  try {
    const { data, error } = await supabaseClient.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session?.access_token) {
      throw error || new Error('Refresh returned no session');
    }
    localStorage.setItem('lebed_token', data.session.access_token);
    localStorage.setItem('lebed_refresh_token', data.session.refresh_token);
    return data.session.access_token;
  } catch (err) {
    console.warn('[LEBED.ai] Session refresh failed:', err?.message || err);
    clearLocalSession();
    redirectToLogin(redirectTo);
    return null;
  }
}

/**
 * Safety net for the "refresh token itself is dead" case (device offline
 * for days, user revoked sessions, etc.) — inspect a failed auth-action
 * response and decide whether to bail out to sign-in instead of leaving
 * a dead form on screen.
 */
function isSessionExpiredResponse(result) {
  const msg = (result?.message || '').toLowerCase();
  return msg.includes('session expired') || msg.includes('not authenticated');
}

window.LebedSession = {
  ensureValidAccessToken,
  isSessionExpiredResponse,
  clearLocalSession,
  redirectToLogin,
};
