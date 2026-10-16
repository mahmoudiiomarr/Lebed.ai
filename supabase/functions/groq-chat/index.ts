// supabase/functions/groq-chat/index.ts
// Server-side proxy to Groq. The key is read from the GROQ_API_KEY secret only.

const ALLOWED_ORIGINS = new Set([
  'https://lebedai.online', 'https://www.lebedai.online',
  'https://lebed.ai', 'https://www.lebed.ai',
  'http://localhost', 'http://localhost:3000', 'http://127.0.0.1:5500',
]);

// Models are tried in order. If Groq says a model does not exist / no access,
// the next one is tried automatically, so a retired model ID never breaks chat.
const TEXT_MODELS = [
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'llama-3.1-8b-instant',
];
const VISION_MODELS = [
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'qwen/qwen3.8-27b',
  'qwen/qwen3.6-27b',
];

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

function isModelUnavailable(status: number, data: any): boolean {
  const msg = String(data?.error?.message ?? '').toLowerCase();
  const code = String(data?.error?.code ?? '').toLowerCase();
  return (
    code === 'model_not_found' ||
    msg.includes('does not exist') ||
    msg.includes('do not have access') ||
    msg.includes('decommissioned') ||
    (status === 404)
  );
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headersFor(request) });
  if (request.method !== 'POST') return respond(request, { error: 'POST requests only' }, 405);

  const apiKey = Deno.env.get('GROQ_API_KEY');
  if (!apiKey) return respond(request, { error: 'AI service is not configured.' }, 500);

  let payload: any;
  try { payload = await request.json(); }
  catch { return respond(request, { error: 'Invalid JSON body' }, 400); }

  const messages = Array.isArray(payload?.messages) ? payload.messages : null;
  if (!messages || messages.length === 0 || messages.length > 40) {
    return respond(request, { error: 'Invalid messages' }, 400);
  }

  const candidates = payload.hasImages ? VISION_MODELS : TEXT_MODELS;

  try {
    let lastError = 'AI service error.';

    for (const model of candidates) {
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048 }),
      });
      const data = await groqRes.json().catch(() => ({}));

      if (groqRes.ok) {
        let text: string = data?.choices?.[0]?.message?.content ?? '';
        text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        return respond(request, { response: text || 'No response generated.' });
      }

      lastError = data?.error?.message ?? lastError;
      console.error(`groq-chat: model ${model} failed (${groqRes.status}):`, lastError);

      // Model missing / no access -> try the next candidate.
      if (isModelUnavailable(groqRes.status, data)) continue;

      // Any other error (rate limit, bad request...) -> return it as-is so
      // script.js's rate-limit parsing still works.
      return respond(request, { error: { message: lastError } });
    }

    return respond(request, { error: { message: lastError } });
  } catch (err) {
    console.error('groq-chat error:', err);
    return respond(request, { error: { message: 'Unable to reach the AI service.' } }, 502);
  }
});
