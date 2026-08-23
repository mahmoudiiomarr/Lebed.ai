# LEBED.ai Auth Integration Guide

## Folder layout to upload to DreamHost

```
/ (site root)
├── index.html
├── styles.css
├── script.js
├── auth.js                 ← new
└── api/
    ├── config.php          ← new, fill in your real values
    ├── _helpers.php        ← new
    ├── register.php        ← new
    ├── verify-otp.php      ← new
    ├── login.php           ← new
    └── logout.php          ← new
```

`sql/profiles_trigger.sql` is not uploaded anywhere — run it once in the
Supabase SQL editor.

## Setup steps

1. **Supabase project**
   - Create a project at supabase.com, then copy the Project URL, anon
     key, and service_role key into `api/config.php` (or set them as
     DreamHost environment variables — preferred).
   - Auth → Providers → Email: enable "Confirm email".
   - Auth → Email Templates → "Confirm signup": replace the default
     link with `{{ .Token }}` so the email contains a 6-digit code.
   - Run `sql/profiles_trigger.sql` in the SQL editor once.
   - Run `chat_history.sql` in the SQL editor once to create the `chats`
     and `messages` tables and their owner-only RLS policies.
   - Keep `supabase-config.js` configured with the project URL and anon key.
     The anon key is intended for browser use; never put the service-role key
     in that file.

2. **reCAPTCHA**
   - `api/config.php` already has the secret key from your existing
     `verify-captcha.php`. If you rotate it, update both files (or,
     better, delete `verify-captcha.php` now that `login.php` /
     `register.php` do their own server-side captcha check).
   - The site key in `index.html`'s `g-recaptcha` divs
     (`6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI`) must correspond to
     that same secret key in the Google reCAPTCHA admin console, with
     your production domain (and `localhost` for local dev) added.

3. **index.html**
   - The 3-view auth modal (`#authOverlay` with `loginView` /
     `registerView` / `otpView`) already exists in your current
     `index.html` — no structural changes needed there.
   - Add `auth.js` **before** `script.js`:
     ```html
     <script src="auth.js"></script>
     <script src="script.js"></script>
     ```

4. **script.js — remove the duplicate block**
   - Your current `script.js` has its own
     `===== AUTHENTICATION + GUEST TRIAL =====` section that
     simulates login/register entirely client-side (no backend calls)
     and calls `api/signup.php` for registration. Delete that whole
     block (from the `TRIAL_DURATION_MS` declaration through the
     `otpForm` submit handler and the `initAuth()`/trial-interval
     bootstrap at the bottom) so it doesn't attach a second, competing
     set of listeners to the same forms as `auth.js`.
   - Everything else in `script.js` (chat, file upload, Codec Mode,
     etc.) is untouched.

## Security notes

- `SUPABASE_SERVICE_ROLE_KEY` must never appear in any file served to
  the browser (`index.html`, `auth.js`, `styles.css`, etc.) — it only
  belongs in `api/config.php`.
- `login.php` returns a generic "Invalid email or password" message on
  any failure, on purpose, so failed attempts can't be used to check
  which emails are registered.
- Consider adding basic rate limiting (e.g. a small DreamHost-side
  counter keyed by IP) in front of `register.php` and `login.php` —
  this implementation doesn't include one.
- Groq API keys are handled only by the `groq-chat` Supabase Edge Function.
  Set `GROQ_API_KEY` as an Edge Function secret; never place it in frontend
  files or in a committed environment file.
