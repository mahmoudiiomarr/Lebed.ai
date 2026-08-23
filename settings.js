/**
 * settings.js — LEBED.ai Account Settings Controller (Windows-style)
 * ------------------------------------------------------------------
 * Talks to api/upload-avatar.php, api/update-name.php,
 * api/change-email.php, api/change-password.php, and api/logout.php.
 * Reuses the same localStorage session keys auth.js already sets
 * (lebed_token, lebed_auth_session) so a signed-in user landing on
 * this page is recognized automatically.
 *
 * Every account change is confirmed with the current password immediately
 * before it is applied. This includes display name, avatar, phone, email,
 * and password changes.
 * ------------------------------------------------------------------
 */

// Same Supabase Edge Function auth.js uses — see auth.js's comment for
// why this replaced the old api/*.php endpoints (GitHub Pages, which is
// what this site is actually hosted on, can't execute PHP at all).
const supabaseSettingsClient = (window.supabase && window.LEBED_SUPABASE_CONFIG)
  ? window.supabase.createClient(window.LEBED_SUPABASE_CONFIG.url, window.LEBED_SUPABASE_CONFIG.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;
const MAX_AVATAR_SIZE = 3 * 1024 * 1024;

const els = {
  avatarPreview: document.getElementById('avatarPreview'),
  avatarTrigger: document.getElementById('avatarTrigger'),
  avatarInput: document.getElementById('avatarInput'),
  navDisplayName: document.getElementById('navDisplayName'),
  navEmail: document.getElementById('navEmail'),
  displayName: document.getElementById('displayName'),
  profileForm: document.getElementById('profileForm'),
  profileAlert: document.getElementById('profileAlert'),
  saveProfileBtn: document.getElementById('saveProfileBtn'),
  currentEmailDisplay: document.getElementById('currentEmailDisplay'),
  securityAlert: document.getElementById('securityAlert'),
  changeEmailBtn: document.getElementById('changeEmailBtn'),
  changePasswordBtn: document.getElementById('changePasswordBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  confirmSignOutBtn: document.getElementById('confirmSignOutBtn'),
};

let currentEmail = '';
let currentAvatarUrl = '';
let currentPhone = '';
let pendingAvatarFile = null; // staged locally, uploaded on Save
let pendingConfirmAction = null; // { type: 'email' | 'password', payload: {...} }
let cropSourceFile = null;
let cropImage = null;
let cropZoom = 1;
let cropRotation = 0;
let cropOffsetX = 0;
let cropOffsetY = 0;
let cropDrag = null;

// ===== PHONE FIELD — international country-code picker =====
// Same list/behavior as the register form in auth.js, so a saved number
// round-trips correctly (default to Tunisia when there's no saved phone).
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

function flagIconUrl(isoCode, hiDpi = false) {
  const c = isoCode.toLowerCase();
  return hiDpi ? `https://flagcdn.com/48x36/${c}.png` : `https://flagcdn.com/24x18/${c}.png`;
}

let selectedPhoneCountry = PHONE_COUNTRIES[0]; // Tunisia default

const phoneCountryBtn = document.getElementById('settingsPhoneCountryBtn');
const phoneCountryDropdown = document.getElementById('settingsPhoneCountryDropdown');
const phoneCountryList = document.getElementById('settingsPhoneCountryList');
const phoneCountrySearch = document.getElementById('settingsPhoneCountrySearch');
const phoneFlagEl = document.getElementById('settingsPhoneFlag');
const phoneDialCodeEl = document.getElementById('settingsPhoneDialCode');
const settingsPhoneInput = document.getElementById('settingsPhone');

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
  settingsPhoneInput?.focus();
}

function openPhoneDropdown() {
  if (!phoneCountryDropdown || !phoneCountryBtn) return;
  renderPhoneCountryList();
  phoneCountryDropdown.hidden = false;
  phoneCountryBtn.setAttribute('aria-expanded', 'true');
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

settingsPhoneInput?.addEventListener('input', (event) => {
  const digitsOnly = event.target.value.replace(/\D/g, '');
  event.target.value = digitsOnly.slice(0, 12);
});

// Splits a saved "+21612345678"-style phone back into { country, local }
// by matching the longest known dial code prefix (some codes share a
// leading digit, e.g. +1 / +216, so longest-first avoids a wrong match).
function splitSavedPhone(phone) {
  if (!phone) return { country: PHONE_COUNTRIES[0], local: '' };
  const sorted = [...PHONE_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);
  for (const country of sorted) {
    if (phone.startsWith(country.dial)) {
      return { country, local: phone.slice(country.dial.length) };
    }
  }
  return { country: PHONE_COUNTRIES[0], local: phone.replace(/\D/g, '') };
}

function getAccessToken() {
  return localStorage.getItem('lebed_token') || '';
}

// path (e.g. 'change-password.php') is mapped to an "action" on the
// single 'auth' Edge Function — same convention as auth.js's postJSON,
// so no call site below had to change.
function actionForPath(path) {
  return path.replace(/\.php$/, '');
}

async function postJSON(path, body) {
  if (!supabaseSettingsClient) {
    return { ok: false, result: { success: false, message: 'AI service is unavailable. Please refresh and try again.' } };
  }
  const { data, error } = await supabaseSettingsClient.functions.invoke('auth', {
    body: { action: actionForPath(path), ...body },
  });
  if (error) {
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

function showAlert(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = `form-alert ${type}`;
  el.hidden = false;
}
function clearAlert(el) {
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

// ===== Modal helpers =====
function openModal(id) {
  document.getElementById(id)?.classList.add('active');
}
function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
}
document.querySelectorAll('[data-close-modal]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('active');
  });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.active').forEach((m) => m.classList.remove('active'));
  }
});

// ===== Sidebar tabs =====
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.settings-panel').forEach((p) => { p.hidden = true; });
    btn.classList.add('active');
    const panel = document.getElementById(btn.dataset.tab);
    if (panel) panel.hidden = false;
  });
});

// ===== Load the current session's profile into the page =====
async function loadProfile() {
  const token = getAccessToken();
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  const { ok, result } = await postJSON('get-profile.php', { access_token: token });
  if (!ok || !result.success) {
    showAlert(els.profileAlert, result.message || 'Could not load your profile. Please sign in again.', 'error');
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
    return;
  }

  currentEmail = result.user.email || '';
  currentAvatarUrl = result.user.user_metadata?.avatar_url || '';
  currentPhone = result.user.user_metadata?.phone || '';
  const name = result.user.user_metadata?.full_name || '';

  els.displayName.value = name;
  els.avatarPreview.src = currentAvatarUrl || 'logo%20pref.png';
  els.navDisplayName.textContent = name || 'User';
  els.navEmail.textContent = currentEmail;
  els.currentEmailDisplay.textContent = currentEmail;

  const { country, local } = splitSavedPhone(currentPhone);
  selectPhoneCountryOnLoad(country);
  if (settingsPhoneInput) settingsPhoneInput.value = local;
}

// Same effect as selectPhoneCountry() but without closing a dropdown or
// stealing focus — used once on initial load.
function selectPhoneCountryOnLoad(country) {
  selectedPhoneCountry = country;
  if (phoneFlagEl) {
    phoneFlagEl.src = flagIconUrl(country.code);
    phoneFlagEl.srcset = `${flagIconUrl(country.code, true)} 2x`;
  }
  if (phoneDialCodeEl) phoneDialCodeEl.textContent = country.dial;
}
loadProfile();

// ===== Avatar picker and crop editor (staged locally, uploaded on Save) =====
els.avatarTrigger.addEventListener('click', () => els.avatarInput.click());

els.avatarInput.addEventListener('change', () => {
  const file = els.avatarInput.files[0];
  if (!file) return;

  if (file.size > MAX_AVATAR_SIZE) {
    showAlert(els.profileAlert, 'Image is too large. Max 3MB.', 'error');
    els.avatarInput.value = '';
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showAlert(els.profileAlert, 'Please choose a JPG, PNG, or WEBP image.', 'error');
    els.avatarInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    cropSourceFile = file;
    cropImage = new Image();
    cropImage.onload = () => {
      resetCropEditor();
      openModal('avatarCropModal');
    };
    cropImage.src = e.target.result;
  };
  reader.readAsDataURL(file);
  els.avatarInput.value = '';
  clearAlert(els.profileAlert);
});

const cropCanvas = document.getElementById('avatarCropCanvas');
const cropContext = cropCanvas.getContext('2d');
const cropZoomInput = document.getElementById('avatarZoom');

function drawCropPreview() {
  if (!cropImage) return;
  const size = cropCanvas.width;
  const baseScale = Math.max(size / cropImage.naturalWidth, size / cropImage.naturalHeight);
  const scale = baseScale * cropZoom;
  cropContext.clearRect(0, 0, size, size);
  cropContext.save();
  cropContext.translate(size / 2 + cropOffsetX, size / 2 + cropOffsetY);
  cropContext.rotate(cropRotation * Math.PI / 180);
  cropContext.drawImage(cropImage, -(cropImage.naturalWidth * scale) / 2, -(cropImage.naturalHeight * scale) / 2, cropImage.naturalWidth * scale, cropImage.naturalHeight * scale);
  cropContext.restore();
}

function resetCropEditor() {
  cropZoom = 1;
  cropRotation = 0;
  cropOffsetX = 0;
  cropOffsetY = 0;
  cropZoomInput.value = '1';
  drawCropPreview();
}

cropZoomInput.addEventListener('input', () => {
  cropZoom = Number(cropZoomInput.value);
  drawCropPreview();
});
document.getElementById('avatarRotateBtn').addEventListener('click', () => {
  cropRotation = (cropRotation + 90) % 360;
  drawCropPreview();
});
document.getElementById('avatarResetBtn').addEventListener('click', resetCropEditor);

cropCanvas.addEventListener('pointerdown', (event) => {
  cropCanvas.setPointerCapture(event.pointerId);
  cropDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
});
cropCanvas.addEventListener('pointermove', (event) => {
  if (!cropDrag || cropDrag.pointerId !== event.pointerId) return;
  cropOffsetX += event.clientX - cropDrag.x;
  cropOffsetY += event.clientY - cropDrag.y;
  cropDrag.x = event.clientX;
  cropDrag.y = event.clientY;
  drawCropPreview();
});
cropCanvas.addEventListener('pointerup', () => { cropDrag = null; });
cropCanvas.addEventListener('pointercancel', () => { cropDrag = null; });

document.getElementById('avatarCropApplyBtn').addEventListener('click', () => {
  cropCanvas.toBlob((blob) => {
    if (!blob || !cropSourceFile) {
      showAlert(document.getElementById('avatarCropAlert'), 'Could not prepare this image. Please try another one.', 'error');
      return;
    }
    pendingAvatarFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    els.avatarPreview.src = URL.createObjectURL(pendingAvatarFile);
    closeModal('avatarCropModal');
  }, 'image/jpeg', 0.9);
});

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ===== Save display name / avatar / phone — password required =====
els.profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearAlert(els.profileAlert);

  const token = getAccessToken();
  if (!token) { window.location.href = 'index.html'; return; }

  const newDisplayName = els.displayName.value.trim();
  if (!newDisplayName) {
    showAlert(els.profileAlert, 'Display name cannot be empty.', 'error');
    return;
  }

  const phoneLocalDigits = (settingsPhoneInput?.value ?? '').replace(/\D/g, '');
  const phone = phoneLocalDigits ? `${selectedPhoneCountry.dial}${phoneLocalDigits}` : '';
  pendingConfirmAction = {
    type: 'profile',
    payload: { new_name: newDisplayName, phone },
  };
  openConfirmPasswordModal();
});

// ===== Change email — opens a dialog, then a password-confirm popup =====
els.changeEmailBtn.addEventListener('click', () => {
  document.getElementById('newEmailInput').value = '';
  clearAlert(document.getElementById('changeEmailAlert'));
  openModal('changeEmailModal');
  setTimeout(() => document.getElementById('newEmailInput')?.focus(), 50);
});

document.getElementById('changeEmailSubmitBtn').addEventListener('click', () => {
  const alertEl = document.getElementById('changeEmailAlert');
  clearAlert(alertEl);

  const newEmail = document.getElementById('newEmailInput').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    showAlert(alertEl, 'Enter a valid email address.', 'error');
    return;
  }
  if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
    showAlert(alertEl, 'That is already your current email.', 'error');
    return;
  }

  pendingConfirmAction = { type: 'email', payload: { new_email: newEmail } };
  closeModal('changeEmailModal');
  openConfirmPasswordModal();
});

// ===== Change password — opens a dialog, then the same password-confirm popup =====
els.changePasswordBtn.addEventListener('click', () => {
  document.getElementById('newPasswordInput').value = '';
  document.getElementById('confirmNewPasswordInput').value = '';
  clearAlert(document.getElementById('changePasswordAlert'));
  openModal('changePasswordModal');
  setTimeout(() => document.getElementById('newPasswordInput')?.focus(), 50);
});

document.getElementById('changePasswordSubmitBtn').addEventListener('click', () => {
  const alertEl = document.getElementById('changePasswordAlert');
  clearAlert(alertEl);

  const newPassword = document.getElementById('newPasswordInput').value;
  const confirmNewPassword = document.getElementById('confirmNewPasswordInput').value;

  if (newPassword.length < 8) {
    showAlert(alertEl, 'Use at least 8 characters for your new password.', 'error');
    return;
  }
  if (newPassword !== confirmNewPassword) {
    showAlert(alertEl, 'Passwords do not match.', 'error');
    return;
  }

  pendingConfirmAction = { type: 'password', payload: { new_password: newPassword } };
  closeModal('changePasswordModal');
  openConfirmPasswordModal();
});

// ===== Generic "confirm your current password" popup =====
function openConfirmPasswordModal() {
  document.getElementById('confirmPasswordInput').value = '';
  clearAlert(document.getElementById('confirmPasswordAlert'));
  openModal('confirmPasswordModal');
  setTimeout(() => document.getElementById('confirmPasswordInput')?.focus(), 50);
}

document.getElementById('confirmPasswordSubmitBtn').addEventListener('click', async () => {
  const alertEl = document.getElementById('confirmPasswordAlert');
  clearAlert(alertEl);

  const password = document.getElementById('confirmPasswordInput').value;
  if (!password) {
    showAlert(alertEl, 'Enter your current password.', 'error');
    return;
  }
  if (!pendingConfirmAction) {
    closeModal('confirmPasswordModal');
    return;
  }

  const token = getAccessToken();
  const submitBtn = document.getElementById('confirmPasswordSubmitBtn');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Confirming...';

  try {
    let endpoint;
    let body;
    if (pendingConfirmAction.type === 'email') {
      endpoint = 'change-email.php';
      body = {
        access_token: token,
        current_password: password,
        new_email: pendingConfirmAction.payload.new_email,
      };
    } else if (pendingConfirmAction.type === 'password') {
      endpoint = 'change-password.php';
      body = {
        access_token: token,
        current_password: password,
        new_password: pendingConfirmAction.payload.new_password,
      };
    } else {
      endpoint = 'update-name.php';
      let avatarUrl = currentAvatarUrl;
      if (pendingAvatarFile) {
        const dataUrl = await readFileAsDataUrl(pendingAvatarFile);
        const upload = await postJSON('upload-avatar.php', {
          access_token: token,
          file_name: pendingAvatarFile.name,
          file_type: pendingAvatarFile.type,
          file_data: dataUrl,
        });
        if (!upload.ok || !upload.result.success) {
          throw new Error(upload.result.message || 'Avatar upload failed.');
        }
        avatarUrl = upload.result.avatar_url;
      }
      pendingConfirmAction.payload.avatar_url = avatarUrl;
      body = {
        access_token: token,
        current_password: password,
        new_name: pendingConfirmAction.payload.new_name,
        avatar_url: avatarUrl,
        phone: pendingConfirmAction.payload.phone,
      };
    }

    const { ok, result } = await postJSON(endpoint, body);
    if (!ok || !result.success) {
      throw new Error(result.message || 'That did not work. Please try again.');
    }

    closeModal('confirmPasswordModal');
    if (pendingConfirmAction.type === 'email') {
      showAlert(els.securityAlert, result.message || `Confirmation link sent to ${pendingConfirmAction.payload.new_email}.`, 'success');
    } else if (pendingConfirmAction.type === 'password') {
      showAlert(els.securityAlert, 'Password changed successfully.', 'success');
    } else {
      const { new_name: newName, phone } = pendingConfirmAction.payload;
      currentAvatarUrl = pendingConfirmAction.payload.avatar_url || currentAvatarUrl;
      currentPhone = phone;
      pendingAvatarFile = null;
      els.displayName.value = newName;
      els.navDisplayName.textContent = newName;
      const cachedProfile = JSON.parse(localStorage.getItem('lebed_profile') || '{}');
      localStorage.setItem('lebed_profile', JSON.stringify({
        ...cachedProfile,
        name: newName,
        photo: currentAvatarUrl || cachedProfile.photo || null,
      }));
      // script.js prefers lebed_auth_session's name/photo over
      // lebed_profile on load (see its userProfile init) — keep it in
      // sync here too, or a stale session-cached name/avatar from login
      // time would override this edit on the next page load.
      try {
        const cachedSession = JSON.parse(localStorage.getItem('lebed_auth_session') || '{}');
        localStorage.setItem('lebed_auth_session', JSON.stringify({
          ...cachedSession,
          name: newName,
          photo: currentAvatarUrl || cachedSession.photo || null,
        }));
      } catch (err) {
        // Non-fatal — worst case the sidebar shows last-login's name/photo
        // until the next sign-in refreshes lebed_auth_session.
      }
      showAlert(els.profileAlert, 'Profile updated successfully.', 'success');
    }
    pendingConfirmAction = null;
  } catch (err) {
    showAlert(alertEl, err.message || 'Current password is incorrect.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirm';
  }
});

// ===== Sign out =====
els.signOutBtn.addEventListener('click', () => openModal('signOutConfirmModal'));

els.confirmSignOutBtn.addEventListener('click', async () => {
  const token = getAccessToken();
  els.confirmSignOutBtn.disabled = true;
  els.confirmSignOutBtn.textContent = 'Signing out…';

  try {
    await postJSON('logout.php', { access_token: token });
  } catch (err) {
    // Non-fatal — we still clear the local session below regardless.
  }

  // Same keys auth.js's clearSession() removes, so the main app also
  // treats this as fully signed out on next load.
  localStorage.removeItem('lebed_token');
  localStorage.removeItem('lebed_refresh_token');
  localStorage.removeItem('lebed_user_logged');
  localStorage.removeItem('lebed_auth_session');
  localStorage.removeItem('lebed_trial_started');
  // Drop any locally-cached chat history so it can't leak into the next
  // guest session or a different account signing in on this device — see
  // script.js's saveChats()/chats init for where this is normally avoided.
  localStorage.removeItem('lebed_chats');

  window.location.href = 'index.html';
});

// ===== Show/hide password (works for every .toggle-pw button, across all modals) =====
document.querySelectorAll('.toggle-pw').forEach((btn) => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const isPw = input.type === 'password';
    input.type = isPw ? 'text' : 'password';
    btn.setAttribute('aria-label', isPw ? 'Hide password' : 'Show password');
  });
});
