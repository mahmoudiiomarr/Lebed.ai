// supabase/functions/groq-chat/index.ts
// Server-side proxy to Groq. The key is read from the GROQ_API_KEY secret only.

const ALLOWED_ORIGINS = new Set([
  'https://lebedai.online', 'https://www.lebedai.online',
  'https://lebed.ai', 'https://www.lebed.ai',
  'http://localhost', 'http://localhost:3000', 'http://127.0.0.1:5500',
]);

// Check console.groq.com/docs/models and edit if these IDs differ.
const TEXT_MODEL = 'llama-3.3-70b-versatile';
const VISION_MODEL = 'qwen/qwen3.8-27b';

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

  const model = payload.hasImages ? VISION_MODEL : TEXT_MODEL;

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, temperature: 0.7, max_tokens: 2048 }),
    });
    const data = await groqRes.json().catch(() => ({}));

    // Returned with 200 so script.js's data.error.message handling
    // (rate-limit parsing) works instead of invoke() throwing.
    if (!groqRes.ok) {
      return respond(request, { error: { message: data?.error?.message ?? 'AI service error.' } });
    }

    let text: string = data?.choices?.[0]?.message?.content ?? '';
    text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    return respond(request, { response: text || 'No response generated.' });
  } catch (err) {
    console.error('groq-chat error:', err);
    return respond(request, { error: { message: 'Unable to reach the AI service.' } }, 502);
  }
});
