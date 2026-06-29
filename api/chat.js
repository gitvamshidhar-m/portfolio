/**
 * Vercel Serverless Function — /api/chat
 * Powered by Groq AI (Free & Fast)
 *
 * DEPLOY STEPS:
 * 1. npm i -g vercel
 * 2. In your portfolio root run: vercel
 * 3. Add env variable in Vercel dashboard:
 *      Name:  GROQ_API_KEY
 *      Value: gsk_xxxxxxxxxxxxxxxx   ← from groq.com → Console → API Keys
 * 4. In enhancements.js set:
 *      AI_PROXY_URL: 'https://YOUR-VERCEL-APP.vercel.app/api/chat'
 */

export default async function handler(req, res) {
  // CORS — allow your GitHub Pages domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { system, messages, max_tokens = 200 } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array required' });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: 'Server misconfigured: missing GROQ_API_KEY' });
  }

  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens,
        messages: [
          { role: 'system', content: system || '' },
          ...messages
        ],
      }),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      console.error('Groq error:', err);
      return res.status(502).json({ error: 'Upstream error', detail: err });
    }

    const data = await groqRes.json();
    const reply = data?.choices?.[0]?.message?.content ?? '';
    return res.status(200).json({ reply });

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
