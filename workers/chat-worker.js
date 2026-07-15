/**
 * Cloudflare Worker — Groq Chat Proxy
 *
 * DEPLOY:
 * 1. Go to https://dash.cloudflare.com/ → Workers & Pages → Create application
 * 2. Select "Create Worker", paste this code
 * 3. Go to Settings → Variables → Add env variable:
 *      Name: GROQ_API_KEY
 *      Value: gsk_xxxxxxxxxxxx (your key from console.groq.com)
 * 4. Deploy, then copy your worker URL (e.g. https://chat-proxy.xxxx.workers.dev)
 * 5. In chatbot.js, set API_URL to that URL + "/api/chat"
 */

const GROQ_API = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.1-8b-instant';

export default {
  async fetch(request, env) {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response('', { status: 200, headers });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    if (!env.GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: 'Missing GROQ_API_KEY' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    try {
      const { system, messages, max_tokens = 250 } = await request.json();
      if (!messages || !Array.isArray(messages)) {
        return new Response(JSON.stringify({ error: 'messages array required' }), {
          status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const groqRes = await fetch(GROQ_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens,
          messages: [{ role: 'system', content: system || '' }, ...messages],
        }),
      });

      if (!groqRes.ok) {
        const err = await groqRes.text();
        return new Response(JSON.stringify({ error: 'Upstream error', detail: err }), {
          status: 502, headers: { ...headers, 'Content-Type': 'application/json' },
        });
      }

      const data = await groqRes.json();
      const reply = data?.choices?.[0]?.message?.content ?? '';
      return new Response(JSON.stringify({ reply }), {
        status: 200, headers: { ...headers, 'Content-Type': 'application/json' },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: 'Internal error' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
