/**
 * update-password.js — LEBED.ai "Set new password" page controller
 * ------------------------------------------------------------------
 * Runs on update-password.html, which is the page Supabase's password
 * reset email link points to (redirectTo, set in auth.js's
 * resetPasswordForEmail call).
 *
 * supabase-js v2 automatically detects the recovery token in the URL
 * (hash fragment or ?code=) on page load, exchanges it for a session,
 * and fires a PASSWORD_RECOVERY auth event once that's done — we just
 * listen for it and reveal the form.
 * ------------------------------------------------------------------
 */

const supabaseClient = window.supabase.createClient(
  window.LEBED_SUPABASE_CONFIG.url,
  window.LEBED_SUPABASE_CONFIG.anonKey
);

const form = document.getElementById('updatePasswordForm');
const statusEl = document.getElementById('updatePasswordStatus');
const errorEl = document.getElementById('updatePasswordError');
let recoveryReady = false;

supabaseClient.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    recoveryReady = true;
    statusEl.textContent = 'Your identity is confirmed. Set a new password below.';
    form.hidden = false;
    setTimeout(() => document.getElementById('newPassword')?.focus(), 50);
  }
});

// If the recovery event never fires, the link was invalid, already
// used, or expired — give the user a clear next step instead of a
// silently stuck spinner-less page.
setTimeout(() => {
  if (!recoveryReady) {
    statusEl.textContent = 'This link is invalid or has expired. Please request a new password reset from the sign-in screen.';
  }
}, 2500);

// Live password-strength meter, matching the register form's behavior.
document.getElementById('newPassword')?.addEventListener('input', (event) => {
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

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';

  if (!recoveryReady) {
    errorEl.textContent = 'Your reset link has not been verified yet. Please wait a moment or request a new link.';
    return;
  }

  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (newPassword.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters.';
    return;
  }
  if (newPassword !== confirmPassword) {
    errorEl.textContent = 'Passwords do not match.';
    return;
  }

  const submitBtn = form.querySelector('.auth-submit');
  submitBtn.disabled = true;

  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });

  submitBtn.disabled = false;

  if (error) {
    errorEl.textContent = error.message || 'Could not update your password. Please try again.';
    return;
  }

  form.hidden = true;
  statusEl.style.color = 'var(--success)';
  statusEl.textContent = 'Password updated! Redirecting to sign in\u2026';

  // Recovery sessions shouldn't linger — sign out so the user lands back
  // on index.html in the normal signed-out state and signs in fresh with
  // the new password.
  await supabaseClient.auth.signOut();
  setTimeout(() => { window.location.href = 'index.html'; }, 2000);
});
