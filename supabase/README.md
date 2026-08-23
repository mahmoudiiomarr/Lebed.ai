# LEBED.ai Edge Functions

## Configure and test locally

1. Copy `.env.example` to `.env.local` and put a newly generated Groq key in
   `GROQ_API_KEY`. Do not commit `.env.local`.
2. From the project root, run `supabase init` (only if the CLI has not already
   initialized this project), then run `supabase start`.
3. Serve the function with:

   ```bash
   supabase functions serve groq-chat --env-file supabase/.env.local
   ```

## Deploy

Authenticate and link the production project once:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Upload the secret and deploy the function:

```bash
supabase secrets set --env-file supabase/.env.local
supabase functions deploy groq-chat
```

`groq-chat` supports guest chat, so it is intentionally deployed with JWT
verification disabled in `config.toml`. The Groq key remains server-only.
Add a production rate limit before opening the app to large public traffic.
