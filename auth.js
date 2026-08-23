/**
 * auth.js — LEBED.ai Authentication Controller
 * ------------------------------------------------------------------
 * Talks to api/register.php, api/verify-otp.php, api/login.php and
 * api/logout.php. Wires up the existing #authOverlay
 * markup already in index.html (loginForm / registerForm / otpForm and
 * their child inputs).
 *
 * INTEGRATION NOTE: this file supersedes the "AUTHENTICATION + GUEST
 * TRIAL" block currently living inside script.js. Load this file
 * instead of that block (remove the old block from script.js, or load
 * auth.js first and delete the duplicate addEventListener calls) so
 * you don't end up with two competing submit handlers on the same
 * forms.
 *
 *   <script src="auth.js"></script>
 *   <script src="script.js"></script>
 * ------------------------------------------------------------------
 */

// Supabase client used for both the "auth" Edge Function calls below AND
// password-reset emails (resetPasswordForEmail is a client-side-only
// Supabase Auth call). This replaces the old api/*.php endpoints — those
// required a PHP host (DreamHost), which this site isn't actually running
// on (it's served from GitHub Pages, which can't execute PHP at all).
// Everything now goes through Supabase Edge Functions instead, using the
// same public anon key already exposed via supabase-config.js.
const supabaseAuthClient = (window.supabase && window.LEBED_SUPABASE_CONFIG)
  ? window.supabase.createClient(window.LEBED_SUPABASE_CONFIG.url, window.LEBED_SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

const authOverlay = document.getElementById('authOverlay');
const authViews = document.querySelectorAll('.auth-view');
const userInputEl = document.getElementById('userInput');
const sendBtnEl = document.getElementById('sendBtn');

let pendingRegistration = null; // { name, email, password, dob, phone } — set after register(), used by the resend-email button

// ===== View / overlay plumbing =====
function showAuthView(viewId) {
  authViews.forEach(view => { view.hidden = view.id !== viewId; });
  document.querySelectorAll('.auth-error').forEach(el => { el.textContent = ''; });
}

function openAuth(viewId = 'loginView') {
  showAuthView(viewId);
  authOverlay?.classList.add('active');
  authOverlay?.setAttribute('aria-hidden', 'false');
  setTimeout(() => authOverlay?.querySelector('input:not(.otp-input)')?.focus(), 50);
}

function closeAuth() {
  authOverlay?.classList.remove('active');
  authOverlay?.setAttribute('aria-hidden', 'true');
}

// ===== Session state =====
function isAuthenticated() {
  return Boolean(localStorage.getItem('lebed_token'));
}

function setSession({ accessToken, refreshToken, name, email, photo }) {
  if (accessToken) localStorage.setItem('lebed_token', accessToken);
  if (refreshToken) localStorage.setItem('lebed_refresh_token', refreshToken);
  localStorage.setItem('lebed_user_logged', 'true');
  localStorage.setItem('lebed_auth_session', JSON.stringify({ name, email, photo: photo || null, authenticatedAt: Date.now() }));
}

function clearSession() {
  localStorage.removeItem('lebed_token');
  localStorage.removeItem('lebed_refresh_token');
  localStorage.removeItem('lebed_user_logged');
  localStorage.removeItem('lebed_auth_session');
}

function renderAuthedNavbar(name) {
  const authTrigger = document.getElementById('authTrigger');
  const authTriggerText = document.getElementById('authTriggerText');
  if (!authTrigger || !authTriggerText) return;
  const displayName = (name || 'Account').split(' ')[0];
  // Once authenticated, this same button's job is to sign the user out —
  // both the tooltip/aria-label and the visible text must say that
  // clearly, instead of still reading like a "sign in" trigger.
  authTriggerText.textContent = `Sign out (${displayName})`;
  authTrigger.setAttribute('aria-label', 'Sign out');
  authTrigger.title = 'Sign out';

  // Swap the guest "person" icon for a signed-in check icon, and hide
  // the guest pulsing dot, so the authed state reads clearly at a glance.
  const icon = authTrigger.querySelector('.auth-trigger-icon');
  if (icon) {
    icon.outerHTML = '<svg class="auth-trigger-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"></path><circle cx="12" cy="7" r="4"></circle><path d="M17 11l1.5 1.5L21.5 9" stroke="var(--success)" stroke-width="2.5"></path></svg>';
  }
  authTrigger.classList.add('authed');
}

function resetAuthSurfaces() {
  authOverlay?.classList.remove('active');
  authOverlay?.setAttribute('aria-hidden', 'true');
}

function completeAuth(name, email, tokens = {}, photo = null) {
  setSession({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, name, email, photo });
  resetAuthSurfaces();
  renderAuthedNavbar(name);
  if (typeof window.renderUserProfile === 'function' && name) {
    window.userProfile = window.userProfile || {};
    window.userProfile.name = name;
    window.renderUserProfile();
  }
}

/**
 * initAuth() — run this once on page load.
 * Restores the signed-in navbar when a token already exists locally.
 */
function initAuth() {
  const token = localStorage.getItem('lebed_token');
  if (!token) return false;

  resetAuthSurfaces();
  const session = JSON.parse(localStorage.getItem('lebed_auth_session') || '{}');
  renderAuthedNavbar(session.name || 'Account');
  if (typeof window.renderUserProfile === 'function' && session.name) {
    window.userProfile = window.userProfile || {};
    window.userProfile.name = session.name;
    window.renderUserProfile();
  }
  return true;
}

// ===== API calls =====
// Every call site below still calls postJSON('login.php', {...}),
// postJSON('signup.php', {...}), etc. — the '.php' name is now just a
// label mapped to an "action" on the single 'auth' Edge Function, so
// none of the call sites had to change. supabaseClient.functions.invoke
// already handles CORS + the apikey header for us, the same way
// script.js calls the existing 'groq-chat' function.
function actionForPath(path) {
  return path.replace(/\.php$/, '');
}

async function postJSON(path, body) {
  if (!supabaseAuthClient) {
    return { ok: false, result: { success: false, message: 'AI service is unavailable. Please refresh and try again.' } };
  }
  const { data, error } = await supabaseAuthClient.functions.invoke('auth', {
    body: { action: actionForPath(path), ...body },
  });
  if (error) {
    // Mirrors the old "non-JSON response" debug message — surface the
    // real body from the function's error response when available.
    const errorBody = typeof error.context?.json === 'function'
      ? await error.context.json().catch(() => null)
      : null;
    console.error(`[LEBED.ai] auth action "${actionForPath(path)}" failed:`, error, errorBody);
    return {
      ok: false,
      result: errorBody || { message: error.message || `Server error calling "${actionForPath(path)}".` },
    };
  }
  return { ok: true, result: data };
}

async function handleRegister(event) {
  event.preventDefault();
  const form = event.currentTarget;

  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const dob = document.getElementById('registerDob')?.value ?? '';
  const phoneLocalDigits = (document.getElementById('registerPhone')?.value ?? '').replace(/\D/g, '');
  // The flag/dial-code badge is a separate picker (selectedPhoneCountry) —
  // stitch it onto the local digits here so the value sent to the
  // backend is a complete international number.
  const phone = phoneLocalDigits ? `${selectedPhoneCountry.dial}${phoneLocalDigits}` : '';
  const error = document.getElementById('registerError');

  if (name.length < 2) { error.textContent = 'Enter your full name.'; return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error.textContent = 'Enter a valid email address.'; return; }
  if (password.length < 8) { error.textContent = 'Use at least 8 characters for your password.'; return; }
  if (!dob || new Date(dob) > new Date()) { error.textContent = 'Enter a valid date of birth.'; return; }
  if (phoneLocalDigits.length < 6) { error.textContent = 'Enter a valid phone number.'; return; }

  const submitButton = form.querySelector('.auth-submit');
  submitButton.disabled = true;

  try {
    const { ok, result } = await postJSON('signup.php', {
      name, email, password, dob, phone,
    });
    if (!ok || !result.success) {
      // Email already has a pending, unconfirmed account — same screen
      // as a normal successful signup (they can hit Resend right away),
      // just with a message explaining why, instead of a hard error.
      if (result.unconfirmed) {
        pendingRegistration = { name, email, password, dob, phone };
        document.getElementById('checkEmailAddress').textContent = email;
        showAuthView('checkEmailView');
        const checkEmailError = document.getElementById('checkEmailError');
        if (checkEmailError) checkEmailError.textContent = result.message || 'This email already has a pending registration.';
        setResendState(false, 'Resend email');
        return;
      }
      let msg = result.message || 'Registration failed.';
      if (result.debug) {
        msg += ` [http:${result.debug.http_status ?? '?'} curl:${result.debug.curl_error || 'none'} raw:${(result.debug.raw_response || '').toString().slice(0, 200)}]`;
      }
      throw new Error(msg);
    }

    // Kept in memory only (never localStorage) purely so the "Resend
    // email" button on the check-email screen can re-call signup.php
    // with the same payload without asking the user to retype everything.
    pendingRegistration = { name, email, password, dob, phone };
    document.getElementById('checkEmailAddress').textContent = email;
    showAuthView('checkEmailView');
    startResendCooldown(60);
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submitButton.disabled = false;
  }
}

// ===== Check-email screen (link-based confirmation, no OTP typing) =====
const resendBtn = document.getElementById('resendVerification');
let resendCooldownInterval = null;

function setResendState(disabled, label) {
  if (!resendBtn) return;
  resendBtn.disabled = disabled;
  resendBtn.textContent = label;
}

function startResendCooldown(seconds = 60) {
  let remaining = seconds;
  setResendState(true, `Resend email (${remaining}s)`);
  if (resendCooldownInterval) clearInterval(resendCooldownInterval);
  resendCooldownInterval = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(resendCooldownInterval);
      resendCooldownInterval = null;
      setResendState(false, 'Resend email');
    } else {
      setResendState(true, `Resend email (${remaining}s)`);
    }
  }, 1000);
}

async function handleResendVerification() {
  const error = document.getElementById('checkEmailError');
  if (error) error.textContent = '';
  if (!pendingRegistration?.email) return;

  setResendState(true, 'Sending...');
  try {
    // NOTE: this calls /auth/v1/resend (via resend.php), not
    // /auth/v1/signup again — Supabase's signup endpoint is
    // anti-enumeration and silently does NOT send a new email for an
    // address that already has an account, even if unconfirmed.
    const { ok, result } = await postJSON('resend.php', { email: pendingRegistration.email });
    if (!ok || !result.success) {
      throw new Error(result.message || 'Could not resend the email.');
    }
    startResendCooldown(60);
  } catch (err) {
    if (error) error.textContent = err.message;
    setResendState(false, 'Resend email');
  }
}
resendBtn?.addEventListener('click', handleResendVerification);

async function handleLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const error = document.getElementById('loginError');

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { error.textContent = 'Enter a valid email address.'; return; }
  if (password.length < 8) { error.textContent = 'Password must contain at least 8 characters.'; return; }

  const submitButton = form.querySelector('.auth-submit');
  submitButton.disabled = true;

  try {
    const { ok, result } = await postJSON('login.php', {
      email, password,
    });
    if (!ok || !result.success || !result.access_token) {
      throw new Error(result.message || 'Invalid email or password.');
    }
    completeAuth(result.user?.user_metadata?.full_name || email.split('@')[0], email, result, result.user?.user_metadata?.avatar_url || null);

    // The chat page starts as a guest. Reload after a successful password
    // login so script.js initializes the Supabase session and loads this
    // account's saved chat history immediately.
    window.location.reload();
    return;
  } catch (err) {
    error.textContent = err.message;
  } finally {
    submitButton.disabled = false;
  }
}

async function handleLogout() {
  const accessToken = localStorage.getItem('lebed_token');
  try {
    await postJSON('logout.php', { access_token: accessToken });
  } catch (err) {
    // Non-fatal — we still clear the local session below regardless.
  }
  clearSession();
  // Chat history for a signed-in account lives in Supabase, not
  // localStorage — but drop any locally-cached copy anyway (belt and
  // suspenders against older cached data) so it never leaks into the
  // next guest session or a different account signing in on this device.
  localStorage.removeItem('lebed_chats');
  location.reload();
}
window.handleLogout = handleLogout;

// ===== Wire up DOM =====
document.getElementById('authTrigger')?.addEventListener('click', () => {
  if (isAuthenticated()) {
    window.location.href = 'settings.html';
    return;
  }
  openAuth();
});
document.getElementById('authClose')?.addEventListener('click', closeAuth);
document.querySelectorAll('[data-show-view]').forEach(btn =>
  btn.addEventListener('click', () => showAuthView(btn.dataset.showView))
);
document.querySelectorAll('.password-toggle').forEach(btn => btn.addEventListener('click', () => {
  const input = document.getElementById(btn.dataset.target);
  input.type = input.type === 'password' ? 'text' : 'password';
  btn.setAttribute('aria-label', input.type === 'password' ? 'Show password' : 'Hide password');
}));
document.getElementById('forgotPassword')?.addEventListener('click', async () => {
  const errorEl = document.getElementById('loginError');
  const email = document.getElementById('loginEmail').value.trim();
  const btn = document.getElementById('forgotPassword');

  errorEl.style.color = '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errorEl.textContent = 'Enter your email address above first, then click "Forgot password?" again.';
    return;
  }
  if (!supabaseAuthClient) {
    errorEl.textContent = 'Password reset is temporarily unavailable.';
    return;
  }

  btn.disabled = true;
  errorEl.textContent = '';

  const { error } = await supabaseAuthClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/update-password.html`,
  });

  btn.disabled = false;

  // Generic message either way — Supabase's resetPasswordForEmail is
  // anti-enumeration by default, so we never reveal whether the email
  // is actually registered, matching login.php's existing approach.
  errorEl.style.color = 'var(--success)';
  errorEl.textContent = error
    ? 'If that email has an account, a reset link has been sent.'
    : `Reset link sent to ${email}. Check your inbox.`;
});
// ===== PHONE FIELD — international country-code picker =====
// A proper flag/dial-code selector (like WhatsApp/Instagram signup),
// defaulting to Tunisia. The dial code is stored separately from the
// input's local digits and only stitched together at submit time.
const PHONE_COUNTRIES = [
  { name: 'Tunisia', code: 'TN', dial: '+216' },
  { name: 'Algeria', code: 'DZ', dial: '+213' },
  { name: 'Morocco', code: 'MA', dial: '+212' },
  { name: 'Libya', code: 'LY', dial: '+218' },
  { name: 'Egypt', code: 'EG', dial: '+20' },
  { name: 'Mauritania', code: 'MR', dial: '+222' },
  { name: 'Saudi Arabia', code: 'SA', dial: '+966' },
  { name: 'United Arab Emirates', code: 'AE', dial: '+971' },
  { name: 'Qatar', code: 'QA', dial: '+974' },
  { name: 'Kuwait', code: 'KW', dial: '+965' },
  { name: 'Bahrain', code: 'BH', dial: '+973' },
  { name: 'Oman', code: 'OM', dial: '+968' },
  { name: 'Jordan', code: 'JO', dial: '+962' },
  { name: 'Lebanon', code: 'LB', dial: '+961' },
  { name: 'Iraq', code: 'IQ', dial: '+964' },
  { name: 'Syria', code: 'SY', dial: '+963' },
  { name: 'Palestine', code: 'PS', dial: '+970' },
  { name: 'Turkey', code: 'TR', dial: '+90' },
  { name: 'France', code: 'FR', dial: '+33' },
  { name: 'Germany', code: 'DE', dial: '+49' },
  { name: 'Italy', code: 'IT', dial: '+39' },
  { name: 'Spain', code: 'ES', dial: '+34' },
  { name: 'Portugal', code: 'PT', dial: '+351' },
  { name: 'United Kingdom', code: 'GB', dial: '+44' },
  { name: 'Ireland', code: 'IE', dial: '+353' },
  { name: 'Netherlands', code: 'NL', dial: '+31' },
  { name: 'Belgium', code: 'BE', dial: '+32' },
  { name: 'Switzerland', code: 'CH', dial: '+41' },
  { name: 'Austria', code: 'AT', dial: '+43' },
  { name: 'Sweden', code: 'SE', dial: '+46' },
  { name: 'Norway', code: 'NO', dial: '+47' },
  { name: 'Denmark', code: 'DK', dial: '+45' },
  { name: 'Poland', code: 'PL', dial: '+48' },
  { name: 'Greece', code: 'GR', dial: '+30' },
  { name: 'Russia', code: 'RU', dial: '+7' },
  { name: 'United States', code: 'US', dial: '+1' },
  { name: 'Canada', code: 'CA', dial: '+1' },
  { name: 'Brazil', code: 'BR', dial: '+55' },
  { name: 'Mexico', code: 'MX', dial: '+52' },
  { name: 'China', code: 'CN', dial: '+86' },
  { name: 'Japan', code: 'JP', dial: '+81' },
  { name: 'South Korea', code: 'KR', dial: '+82' },
  { name: 'India', code: 'IN', dial: '+91' },
  { name: 'Pakistan', code: 'PK', dial: '+92' },
  { name: 'Indonesia', code: 'ID', dial: '+62' },
  { name: 'Senegal', code: 'SN', dial: '+221' },
  { name: 'Ivory Coast', code: 'CI', dial: '+225' },
  { name: 'Nigeria', code: 'NG', dial: '+234' },
  { name: 'South Africa', code: 'ZA', dial: '+27' },
  { name: 'Australia', code: 'AU', dial: '+61' },
];

// Real flag ICONS (flagcdn.com), not emoji — emoji flags render as bare
// "US"/"TN" style letter pairs on Windows (no flag glyph in the system
// emoji font there), so an <img> keeps the flag looking like an actual
// flag on every OS/browser instead of falling back to plain text.
function flagIconUrl(isoCode, hiDpi = false) {
  const c = isoCode.toLowerCase();
  return hiDpi ? `https://flagcdn.com/48x36/${c}.png` : `https://flagcdn.com/24x18/${c}.png`;
}

let selectedPhoneCountry = PHONE_COUNTRIES[0]; // Tunisia default

const phoneCountryBtn = document.getElementById('phoneCountryBtn');
const phoneCountryDropdown = document.getElementById('phoneCountryDropdown');
const phoneCountryList = document.getElementById('phoneCountryList');
const phoneCountrySearch = document.getElementById('phoneCountrySearch');
const phoneFlagEl = document.getElementById('phoneFlag');
const phoneDialCodeEl = document.getElementById('phoneDialCode');
const registerPhoneInput = document.getElementById('registerPhone');

function renderPhoneCountryList(filterText = '') {
  if (!phoneCountryList) return;
  const q = filterText.trim().toLowerCase();
  const matches = q
    ? PHONE_COUNTRIES.filter(c => c.name.toLowerCase().includes(q) || c.dial.includes(q))
    : PHONE_COUNTRIES;

  phoneCountryList.innerHTML = '';
  if (matches.length === 0) {
    phoneCountryList.innerHTML = '<div class="phone-country-empty">No matching country</div>';
    return;
  }
  matches.forEach(country => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.className = country.code === selectedPhoneCountry.code ? 'active' : '';
    li.innerHTML = `<img class="flag" src="${flagIconUrl(country.code)}" width="18" height="13" alt="" loading="lazy"><span class="country-name">${country.name}</span><span class="dial-code">${country.dial}</span>`;
    li.addEventListener('click', () => selectPhoneCountry(country));
    phoneCountryList.appendChild(li);
  });
}

function selectPhoneCountry(country) {
  selectedPhoneCountry = country;
  if (phoneFlagEl) {
    phoneFlagEl.src = flagIconUrl(country.code);
    phoneFlagEl.srcset = `${flagIconUrl(country.code, true)} 2x`;
  }
  if (phoneDialCodeEl) phoneDialCodeEl.textContent = country.dial;
  closePhoneDropdown();
  registerPhoneInput?.focus();
}

function openPhoneDropdown() {
  if (!phoneCountryDropdown || !phoneCountryBtn) return;
  renderPhoneCountryList();
  phoneCountryDropdown.hidden = false;
  phoneCountryBtn.setAttribute('aria-expanded', 'true');

  // The dropdown lives inside a scrollable modal (.auth-shell has
  // overflow-y:auto), so if it's opened near the bottom it can get
  // visually clipped. Flip it to open upward instead when there isn't
  // enough room below, and make sure the field itself is in view.
  phoneCountryDropdown.classList.remove('drop-up');
  const fieldRect = document.querySelector('.phone-field')?.getBoundingClientRect();
  const dropdownHeight = 264;
  if (fieldRect && (window.innerHeight - fieldRect.bottom) < dropdownHeight + 20) {
    phoneCountryDropdown.classList.add('drop-up');
  }
  document.querySelector('.phone-field')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  setTimeout(() => phoneCountrySearch?.focus(), 30);
}

function closePhoneDropdown() {
  if (!phoneCountryDropdown || !phoneCountryBtn) return;
  phoneCountryDropdown.hidden = true;
  phoneCountryBtn.setAttribute('aria-expanded', 'false');
  if (phoneCountrySearch) phoneCountrySearch.value = '';
}

phoneCountryBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  const isOpen = phoneCountryBtn.getAttribute('aria-expanded') === 'true';
  isOpen ? closePhoneDropdown() : openPhoneDropdown();
});

phoneCountrySearch?.addEventListener('input', (e) => renderPhoneCountryList(e.target.value));
phoneCountrySearch?.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', (e) => {
  if (phoneCountryDropdown && !phoneCountryDropdown.hidden && !phoneCountryDropdown.contains(e.target) && e.target !== phoneCountryBtn) {
    closePhoneDropdown();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && phoneCountryDropdown && !phoneCountryDropdown.hidden) closePhoneDropdown();
});

// Local number: plain digits as typed, no auto-inserted grouping spaces —
// just strip anything that isn't a digit and cap to a sane max length.
function formatLocalPhoneDigits(digits) {
  return digits.slice(0, 12);
}
registerPhoneInput?.addEventListener('input', (event) => {
  const digitsOnly = event.target.value.replace(/\D/g, '');
  event.target.value = formatLocalPhoneDigits(digitsOnly);
});

document.getElementById('registerPassword')?.addEventListener('input', (event) => {
  const password = event.target.value;
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  const bar = document.getElementById('strengthBar');
  const text = document.getElementById('strengthText');
  const labels = ['Use 8+ characters', 'Weak password', 'Fair password', 'Strong password', 'Excellent password'];
  bar.style.width = `${score * 25}%`;
  bar.style.background = score < 2 ? 'var(--danger)' : score < 4 ? '#F4B400' : 'var(--success)';
  text.textContent = labels[score];
});

document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
document.getElementById('registerForm')?.addEventListener('submit', handleRegister);

/**
 * Supabase's "Confirm signup" email contains a clickable link. Clicking
 * it redirects the browser back here with the session tokens in the URL
 * hash, e.g.:
 *   https://yoursite.com/index.html#access_token=...&refresh_token=...&type=signup
 * This reads that hash (if present), completes the login, and cleans
 * the URL. This is the ONLY confirmation path now — there's no typed
 * OTP form anymore, so the "Confirm signup" email template in the
 * Supabase dashboard must stay on its default link (do NOT swap it to
 * {{ .Token }}), and "Confirm email" must stay enabled under
 * Authentication → Providers → Email.
 */
function completeAuthFromUrlHash() {
  if (!location.hash || location.hash.length < 2) return false;
  const params = new URLSearchParams(location.hash.substring(1));
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken) return false;

  // Clean the tokens out of the visible URL immediately, before any async
  // work below, so they never linger in the address bar or browser history.
  history.replaceState(null, '', location.pathname + location.search);

  // Look up the account's real name/avatar before completing sign-in, so
  // the sidebar shows the right identity right away instead of a generic
  // 'User' placeholder with no picture.
  postJSON('get-profile.php', { access_token: accessToken })
    .then(({ ok, result }) => {
      const profileUser = (ok && result.success) ? result.user : null;
      const name = profileUser?.user_metadata?.full_name || 'User';
      const email = profileUser?.email || null;
      const photo = profileUser?.user_metadata?.avatar_url || null;
      setSession({ accessToken, refreshToken, name, email, photo });
      window.location.reload();
    })
    .catch(() => {
      setSession({ accessToken, refreshToken, name: 'User', email: null, photo: null });
      window.location.reload();
    });

  return true;
}

// ===== Init on load =====
const cameFromEmailLink = completeAuthFromUrlHash();
if (!cameFromEmailLink) initAuth();
