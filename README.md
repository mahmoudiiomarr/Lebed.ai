LEBED.ai 🚀 — Founded by Omar Mahmoudi
LEBED.ai is an AI-powered project designed to [kammel houni: 7ott el vision mte3ek, example: revolutionize user interaction / simplify complex tasks].

🌟 About the Project
LEBED.ai is a web-based AI assistant built to provide seamless, fast, and intelligent responses. Founded by Omar Mahmoudi.

🛠 Tech Stack
Frontend: HTML5, CSS3, JavaScript.

AI Integration: Powered by advanced AI models.

Deployment: Hosted on GitHub Pages.

🚀 Features
✅ Typewriter Animation: Dynamic text rendering for a more engaging feel.

✅ Responsive Design: Optimized for both desktop and mobile screens.

✅ AI-Driven Logic: Real-time processing for instant results.

## Authentication Flow

The frontend includes a simulated authentication layer for local UX testing. In production, replace the demo handlers with these server-side flows:

1. On the first guest interaction, `POST /api/trial/start` creates a server-side trial record and returns a signed, HttpOnly guest cookie. Enforce the 15-minute expiry on every AI request; do not trust client `localStorage` for access control.
2. `POST /api/auth/register` validates name, email, DOB, phone, password policy, and Google reCAPTCHA server-side. Store a strong password hash (Argon2id or bcrypt), create a short-lived hashed OTP record, and send the 6-digit code through the email provider.
3. `POST /api/auth/verify-otp` checks the hashed OTP, attempt limit, expiry, and email. On success, mark the account verified and issue a rotated, HttpOnly, Secure, SameSite session cookie.
4. `POST /api/auth/login` validates Google reCAPTCHA and credentials with rate limiting. A `rememberMe` request can use a longer server-side refresh-session expiry; never store passwords or tokens in `localStorage`.
5. `POST /api/auth/oauth/:provider/callback` verifies the Google or Apple authorization code against the provider, validates the returned identity, links or creates the account, and issues the same session cookie.
6. Protect `POST /api/ai/query` with the session middleware. Authenticated users pass; guests pass only while the server trial record is valid. Return `401` for missing auth and `403` with a registration prompt for an expired trial.

Recommended protections: TLS everywhere, CSRF protection for cookie-authenticated mutations, strict input validation, generic login errors, OTP resend throttling, account lockout/backoff, audit logging, and CAPTCHA verification on the server.

### Google reCAPTCHA Server Verification

The browser token is only an assertion. Verify it on the backend with the secret key before accepting login or registration:

```js
async function verifyRecaptchaToken(token, remoteip) {
	const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			secret: process.env.RECAPTCHA_SECRET_KEY,
			response: token,
			remoteip
		})
	});
	if (!response.ok) throw new Error('reCAPTCHA verification request failed');
	const result = await response.json();
	return result.success === true;
}
```

Keep `RECAPTCHA_SECRET_KEY` server-only. Replace `YOUR_RECAPTCHA_SITE_KEY` in `index.html` with the public v2 checkbox site key from the Google reCAPTCHA admin console, and add your production domain plus `localhost` for local development.

The provided [verify-captcha.php](verify-captcha.php) is ready to upload to DreamHost. Send the browser's `g-recaptcha-response` token to that endpoint with a `POST` request, then accept login or registration only when its JSON response contains `success: true`. Keep the PHP file on the server and never include its secret key in frontend code.

### Supabase OTP Deployment

Set these server-only DreamHost environment variables for `api/signup.php` and `api/verify-otp.php`:

```text
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
RECAPTCHA_SECRET_KEY=your-recaptcha-secret-key
```

Enable email confirmation in Supabase Auth so `/auth/v1/signup` sends the verification email. In the Supabase Confirm signup email template, include `{{ .Token }}` as the six-digit code; the `/auth/v1/verify` `type: signup` endpoint verifies that token. The frontend never receives a Supabase secret key; it only receives the access token after `api/verify-otp.php` confirms the code.

Run this once in the Supabase SQL editor to auto-create a profile row when a user is created:

```sql
create table if not exists public.profiles (
	id uuid primary key references auth.users(id) on delete cascade,
	email text unique,
	username text,
	created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
	insert into public.profiles (id, email, username)
	values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
	on conflict (id) do update set email = excluded.email;
	return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();
```

📦 Getting Started
The project is currently live and can be accessed at: https://lebedai.online

🤝 Build in Public
I am actively developing LEBED.ai with a "Build in Public" mindset. Every commit represents a step forward in making this project the best version of itself. Feedback and contributions are always welcome!

📜 License
This project is licensed under the MIT License - see the LICENSE file for details.

Kif t-7ott hadha, e-f-rachi el page mta3 el repository mte3ek, w chouf el différence!

Nota: T-najjem t-zid screenshot (image) mta3 el interface mte3ek ta7t "Features" bch el nass t-chouf el UI mte3ek (t-najjem t-upload-i el taswira 3al GitHub w t-copy-i el link mte3ha).
