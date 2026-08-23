/**
 * supabase/functions/auth/index.ts
 * ------------------------------------------------------------------
 * Replaces every api/*.php endpoint (login, signup, verify-otp,
 * logout, resend, get-profile, change-email, change-password,
 * update-name, upload-avatar) with a single Supabase Edge Function.
 *
 * Why one function instead of ten: Supabase auto-injects SUPABASE_URL,
 * SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY as environment
 * variables inside every Edge Function automatically — no manual
 * "add an env var on the host" step like DreamHost needed. One
 * function also means one `supabase functions deploy` instead of ten.
 *
 * The frontend calls this with:
 *   supabaseClient.functions.invoke('auth', { body: { action: '...', ...payload } })
 *
 * Every action mirrors the exact security logic the PHP files had —
 * in particular, change-email / change-password / update-name still
 * re-authenticate with the current password BEFORE applying any
 * change, exactly like change-email.php / change-password.php /
 * update-name.php did.
 * ------------------------------------------------------------------
 */

const ALLOWED_ORIGINS = new Set([
  'https://lebedai.online', 'https://www.lebedai.online',
  'https://lebed.ai', 'https://www.lebed.ai',
  'http://localhost', 'http://localhost:3000', 'http://127.0.0.1:5500',
]);

function headersFor(request: Request): HeadersInit {
  const origin = request.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://lebedai.online',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
}
function respond(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(request) });
}

const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, '');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function supabaseFetch(
  method: string,
  path: string,
  body: Record<string, unknown> | null,
  useServiceRole = false,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const apiKey = useServiceRole ? SERVICE_ROLE_KEY : ANON_KEY;
  const response = await fetch(SUPABASE_URL + path, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: any = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  return { status: response.status, body: parsed };
}

/** Resolves the real current email + verifies the access_token is live. */
async function resolveCurrentUser(accessToken: string) {
  const lookup = await supabaseFetch('GET', '/auth/v1/user', null, false, {
    Authorization: `Bearer ${accessToken}`,
  });
  if (lookup.status >= 400 || !lookup.body?.id) return null;
  return lookup.body as { id: string; email: string; user_metadata?: Record<string, unknown> };
}

/** Re-authenticates with email + password — this IS the "confirm your password" check. */
async function reauth(email: string, password: string) {
  const result = await supabaseFetch('POST', '/auth/v1/token?grant_type=password', { email, password });
  return result.status < 400 && result.body?.access_token;
}

// ===== Action handlers =====

async function actionLogin(payload: any) {
  const email = String(payload.email ?? '').trim();
  const password = String(payload.password ?? '');
  if (!validEmail(email) || password === '') {
    return { status: 400, body: { success: false, message: 'Enter a valid email and password.' } };
  }
  const result = await supabaseFetch('POST', '/auth/v1/token?grant_type=password', { email, password });
  if (result.status >= 400 || !result.body?.access_token) {
    // Generic message on purpose — never reveal whether the email exists.
    return { status: 401, body: { success: false, message: 'Invalid email or password.' } };
  }
  return {
    status: 200,
    body: {
      success: true,
      access_token: result.body.access_token,
      refresh_token: result.body.refresh_token ?? null,
      user: result.body.user ?? null,
    },
  };
}

async function actionSignup(payload: any, request: Request) {
  const email = String(payload.email ?? '').trim();
  const password = String(payload.password ?? '');
  const name = String(payload.name ?? '').trim();
  const dob = String(payload.dob ?? '').trim();
  const phone = String(payload.phone ?? '').trim();

  if (!validEmail(email) || password.length < 8) {
    return { status: 400, body: { success: false, message: 'Invalid registration data' } };
  }

  // Optional pre-check: does this email already have an account?
  // Supabase's /auth/v1/signup is anti-enumeration by default (silently
  // no-ops for an existing email), which is good security but bad UX —
  // this uses the service_role key to tell the difference.
  if (SERVICE_ROLE_KEY) {
    const lookup = await supabaseFetch(
      'GET',
      `/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      null,
      true,
    );
    if (lookup.status < 400) {
      const users = lookup.body?.users ?? (Array.isArray(lookup.body) ? lookup.body : []);
      for (const existing of users) {
        if (!existing?.email || existing.email.toLowerCase() !== email.toLowerCase()) continue;
        if (existing.email_confirmed_at || existing.confirmed_at) {
          return { status: 409, body: { success: false, message: 'This email is already registered. Please sign in instead.' } };
        }
        return {
          status: 409,
          body: {
            success: false,
            unconfirmed: true,
            message: 'This email already has a pending registration. Check your inbox for the confirmation link, or resend it below.',
          },
        };
      }
    }
  }

  const referer = request.headers.get('referer') || request.headers.get('origin') || '';
  const signupPath = referer ? `/auth/v1/signup?redirect_to=${encodeURIComponent(referer)}` : '/auth/v1/signup';

  const result = await supabaseFetch('POST', signupPath, {
    email,
    password,
    data: { full_name: name, date_of_birth: dob, phone },
  });
  if (result.status >= 400) {
    return {
      status: result.status || 502,
      body: { success: false, message: result.body?.msg ?? result.body?.error_description ?? 'Registration failed' },
    };
  }
  return { status: 200, body: { success: true, message: 'Verification code sent', email, user: result.body?.user ?? null } };
}

async function actionResend(payload: any, request: Request) {
  const email = String(payload.email ?? '').trim();
  if (!validEmail(email)) {
    return { status: 400, body: { success: false, message: 'A valid email is required.' } };
  }
  const referer = request.headers.get('referer') || request.headers.get('origin') || '';
  const resendPath = referer ? `/auth/v1/resend?redirect_to=${encodeURIComponent(referer)}` : '/auth/v1/resend';
  const result = await supabaseFetch('POST', resendPath, { type: 'signup', email });
  if (result.status >= 400) {
    return {
      status: result.status || 502,
      body: { success: false, message: result.body?.msg ?? result.body?.error_description ?? 'Could not resend the email.' },
    };
  }
  return { status: 200, body: { success: true, message: `Verification email resent to ${email}` } };
}

async function actionVerifyOtp(payload: any) {
  const email = String(payload.email ?? '').trim();
  const otpCode = String(payload.otp_code ?? '').trim();
  if (!validEmail(email) || !/^\d{6}$/.test(otpCode)) {
    return { status: 400, body: { success: false, message: 'Email and a 6-digit code are required' } };
  }
  const result = await supabaseFetch('POST', '/auth/v1/verify', { type: 'signup', email, token: otpCode });
  if (result.status >= 400 || !result.body?.access_token) {
    return { status: result.status || 502, body: { success: false, message: result.body?.msg ?? 'OTP verification failed' } };
  }
  return {
    status: 200,
    body: { success: true, access_token: result.body.access_token, refresh_token: result.body.refresh_token ?? null, user: result.body.user ?? null },
  };
}

async function actionLogout(payload: any) {
  const accessToken = String(payload.access_token ?? '');
  if (accessToken !== '') {
    await supabaseFetch('POST', '/auth/v1/logout', null, false, { Authorization: `Bearer ${accessToken}` });
  }
  return { status: 200, body: { success: true } };
}

async function actionGetProfile(payload: any) {
  const accessToken = String(payload.access_token ?? '');
  if (accessToken === '') return { status: 401, body: { success: false, message: 'Not authenticated.' } };
  const user = await resolveCurrentUser(accessToken);
  if (!user) return { status: 401, body: { success: false, message: 'Session expired. Please sign in again.' } };
  return {
    status: 200,
    body: { success: true, user: { id: user.id, email: user.email ?? '', user_metadata: user.user_metadata ?? {} } },
  };
}

async function actionChangeEmail(payload: any) {
  const accessToken = String(payload.access_token ?? '');
  const currentPassword = String(payload.current_password ?? '');
  const newEmail = String(payload.new_email ?? '').trim();

  if (accessToken === '') return { status: 401, body: { success: false, message: 'Not authenticated.' } };
  if (currentPassword === '') return { status: 400, body: { success: false, message: 'Enter your current password to confirm.' } };
  if (!validEmail(newEmail)) return { status: 400, body: { success: false, message: 'Enter a valid email address.' } };

  const user = await resolveCurrentUser(accessToken);
  if (!user) return { status: 401, body: { success: false, message: 'Session expired. Please sign in again.' } };
  if (newEmail.toLowerCase() === (user.email ?? '').toLowerCase()) {
    return { status: 400, body: { success: false, message: 'That is already your current email.' } };
  }
  if (!(await reauth(user.email, currentPassword))) {
    return { status: 401, body: { success: false, message: 'Current password is incorrect.' } };
  }

  const update = await supabaseFetch('PUT', '/auth/v1/user', { email: newEmail }, false, {
    Authorization: `Bearer ${accessToken}`,
  });
  if (update.status >= 400) {
    return { status: update.status, body: { success: false, message: update.body?.msg ?? update.body?.error_description ?? 'Could not update your email.' } };
  }
  return { status: 200, body: { success: true, message: `Confirmation link sent to ${newEmail}. The change takes effect once you click it.` } };
}

async function actionChangePassword(payload: any) {
  const accessToken = String(payload.access_token ?? '');
  const currentPassword = String(payload.current_password ?? '');
  const newPassword = String(payload.new_password ?? '');

  if (accessToken === '') return { status: 401, body: { success: false, message: 'Not authenticated.' } };
  if (currentPassword === '') return { status: 400, body: { success: false, message: 'Enter your current password to confirm.' } };
  if (newPassword.length < 8) return { status: 400, body: { success: false, message: 'New password must be at least 8 characters.' } };

  const user = await resolveCurrentUser(accessToken);
  if (!user) return { status: 401, body: { success: false, message: 'Session expired. Please sign in again.' } };
  if (!(await reauth(user.email, currentPassword))) {
    return { status: 401, body: { success: false, message: 'Current password is incorrect.' } };
  }
  if (newPassword === currentPassword) {
    return { status: 400, body: { success: false, message: 'New password must be different from the current one.' } };
  }

  const update = await supabaseFetch('PUT', '/auth/v1/user', { password: newPassword }, false, {
    Authorization: `Bearer ${accessToken}`,
  });
  if (update.status >= 400) {
    return { status: update.status, body: { success: false, message: update.body?.msg ?? update.body?.error_description ?? 'Could not update your password.' } };
  }
  return { status: 200, body: { success: true, message: 'Password changed successfully.' } };
}

async function actionUpdateName(payload: any) {
  const accessToken = String(payload.access_token ?? '');
  const currentPassword = String(payload.current_password ?? '');
  const newName = String(payload.new_name ?? '').trim();
  const avatarUrl = String(payload.avatar_url ?? '').trim();
  const phone = String(payload.phone ?? '').trim();

  if (accessToken === '') return { status: 401, body: { success: false, message: 'Not authenticated.' } };
  if (currentPassword === '') return { status: 400, body: { success: false, message: 'Enter your current password to confirm.' } };
  if (newName === '') return { status: 400, body: { success: false, message: 'Display name cannot be empty.' } };

  const user = await resolveCurrentUser(accessToken);
  if (!user) return { status: 401, body: { success: false, message: 'Session expired. Please sign in again.' } };
  if (!(await reauth(user.email, currentPassword))) {
    return { status: 401, body: { success: false, message: 'Current password is incorrect.' } };
  }

  const update = await supabaseFetch(
    'PUT',
    '/auth/v1/user',
    { data: { full_name: newName, avatar_url: avatarUrl, phone } },
    false,
    { Authorization: `Bearer ${accessToken}` },
  );
  if (update.status >= 400) {
    return { status: update.status, body: { success: false, message: update.body?.msg ?? update.body?.error_description ?? 'Could not update your profile.' } };
  }

  // Best-effort sync of the public profiles table — non-fatal if it fails.
  if (SERVICE_ROLE_KEY && update.body?.id) {
    await supabaseFetch(
      'PATCH',
      `/rest/v1/profiles?id=eq.${encodeURIComponent(update.body.id)}`,
      { username: newName, avatar_url: avatarUrl },
      true,
      { Prefer: 'return=minimal' },
    );
  }

  return { status: 200, body: { success: true, message: 'Profile updated.' } };
}

async function actionUploadAvatar(payload: any) {
  const accessToken = String(payload.access_token ?? '');
  const fileType = String(payload.file_type ?? '');
  let fileData = String(payload.file_data ?? '');

  if (accessToken === '' || fileData === '') {
    return { status: 400, body: { success: false, message: 'Missing access token or file data.' } };
  }
  const ALLOWED: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
  if (!(fileType in ALLOWED)) {
    return { status: 400, body: { success: false, message: 'Unsupported image type. Use JPG, PNG, or WEBP.' } };
  }
  if (fileData.includes(',')) fileData = fileData.slice(fileData.indexOf(',') + 1);

  let binary: Uint8Array;
  try {
    binary = Uint8Array.from(atob(fileData), (c) => c.charCodeAt(0));
  } catch {
    return { status: 400, body: { success: false, message: 'Invalid image data.' } };
  }
  const MAX_SIZE = 3 * 1024 * 1024;
  if (binary.byteLength > MAX_SIZE) {
    return { status: 400, body: { success: false, message: 'Image is too large. Max 3MB.' } };
  }
  if (!SERVICE_ROLE_KEY) {
    return { status: 500, body: { success: false, message: 'Server authentication configuration is missing' } };
  }

  const user = await resolveCurrentUser(accessToken);
  if (!user) return { status: 401, body: { success: false, message: 'Session expired. Please sign in again.' } };

  const ext = ALLOWED[fileType];
  const objectPath = `${user.id}/avatar_${Date.now()}.${ext}`;

  const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/avatars/${objectPath}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': fileType,
      'x-upsert': 'true',
    },
    body: binary,
  });
  if (!uploadResponse.ok) {
    const errBody = await uploadResponse.json().catch(() => ({}));
    return { status: uploadResponse.status, body: { success: false, message: errBody?.message ?? 'Avatar upload to storage failed.' } };
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/avatars/${objectPath}`;
  return { status: 200, body: { success: true, avatar_url: publicUrl } };
}

// ===== Router =====

const ACTIONS: Record<string, (payload: any, request: Request) => Promise<{ status: number; body: unknown }>> = {
  login: actionLogin,
  signup: actionSignup,
  resend: actionResend,
  'verify-otp': actionVerifyOtp,
  logout: actionLogout,
  'get-profile': actionGetProfile,
  'change-email': actionChangeEmail,
  'change-password': actionChangePassword,
  'update-name': actionUpdateName,
  'upload-avatar': actionUploadAvatar,
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headersFor(request) });
  if (request.method !== 'POST') return respond(request, { success: false, message: 'POST requests only' }, 405);

  if (!SUPABASE_URL || !ANON_KEY) {
    return respond(request, { success: false, message: 'Server authentication configuration is missing' }, 500);
  }

  let payload: any;
  try {
    payload = await request.json();
  } catch {
    return respond(request, { success: false, message: 'Invalid JSON body' }, 400);
  }

  const action = String(payload?.action ?? '');
  const handler = ACTIONS[action];
  if (!handler) {
    return respond(request, { success: false, message: `Unknown action: ${action}` }, 400);
  }

  try {
    const { status, body } = await handler(payload, request);
    return respond(request, body, status);
  } catch (error) {
    console.error(`auth/${action} error:`, error);
    return respond(request, { success: false, message: 'Invalid request or server error.' }, 500);
  }
});
