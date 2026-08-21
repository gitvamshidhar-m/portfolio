const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-11b-vision-preview';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

const rl = { hits: {}, last: Date.now() };
const RL_WIN = 60000, RL_MAX = 8;
function rate(key) { const now = Date.now(); if (now - rl.last > RL_WIN) { rl.hits = {}; rl.last = now; } rl.hits[key] = (rl.hits[key] || 0) + 1; return rl.hits[key]; }
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
function kv(pipe) { if (!KV_URL || !KV_TOKEN) return Promise.resolve(); return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {}); }

const MIME_EXT = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/jpg': 'jpg' };

function cleanText(t) {
  return String(t || '')
    .replace(/\r\n/g, '\n')
    .split('\n').map(function (l) { return l.trim(); }).filter(Boolean).join('\n')
    .slice(0, 4000);
}

function promptFor() {
  return 'You are reading a screenshot for a recruiter. Extract the JOB DESCRIPTION faithfully:\n'
    + '- Output the job title, company (if visible), location, and the FULL requirements/responsibilities as a clean markdown list.\n'
    + '- Keep every concrete detail (tools, metrics, years of experience, budget) verbatim.\n'
    + '- If the image is a resume or a marketing creative instead of a job post, say what it is and extract its key text.\n'
    + '- Output ONLY the extracted text. No commentary, no "here is the text" preamble.';
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'offline', message: 'POST /api/vision with {image:"<base64>", mime:"image/png"} to extract text from a screenshot.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const b64 = String(b.image || b.data || '').slice(0, 4000000);
  const mime = String(b.mime || 'image/png').slice(0, 40);
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) return res.status(400).json({ error: 'GROQ_API_KEY not set' });
  if (!b64) return res.status(400).json({ error: 'image is required' });
  if (rate(ipOf(req) + ':vision') > RL_MAX) return res.status(429).json({ error: 'rate limited' });

  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'bad base64' }); }
  if (!buf || buf.length < 1000) return res.status(400).json({ error: 'image too small' });
  const dataUrl = 'data:' + mime + ';base64,' + b64;

  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 20000);
    const r = await fetch(GROQ, {
      method: 'POST', signal: c.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [{ role: 'user', content: [{ type: 'text', text: promptFor() }, { type: 'image_url', image_url: { url: dataUrl } }] }]
      })
    });
    clearTimeout(t);
    const j = await r.json();
    const text = cleanText((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '');
    if (!r.ok || !text) return res.status(502).json({ error: (j && j.error && j.error.message) || 'vision extraction failed' });
    const title = text.split('\n')[0].slice(0, 120) || 'Extracted text';
    kv([['LPUSH', 'leads:recent', JSON.stringify({ type: 'vision', title: title, at: new Date().toISOString() })], ['LTRIM', 'leads:recent', 0, 49]]);
    return res.json({ ok: true, text: text, title: title });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || 'vision extraction failed') });
  }
};