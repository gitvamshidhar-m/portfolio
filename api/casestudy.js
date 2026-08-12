const KB = require('../libs/kb');
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

const rl = { hits: {}, last: Date.now() };
const RL_WIN = 60000, RL_MAX = 8;
function rate(key) { const now = Date.now(); if (now - rl.last > RL_WIN) { rl.hits = {}; rl.last = now; } rl.hits[key] = (rl.hits[key] || 0) + 1; return rl.hits[key]; }
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
function kv(pipe) { if (!KV_URL || !KV_TOKEN) return Promise.resolve(); return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {}); }
function num(v, d) { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? d : n; }

function sys(ctx) {
  return 'You are Vamshidhar Reddy, a performance marketer who writes rigorous case studies (10+ years, three solo AI products, real numbers like ROAS 3.2x->5.5x and CPL -30%).\n'
    + 'Task: turn the campaign inputs below into a structured, honest case study draft that another marketer can learn from.\n'
    + 'Rules: use ONLY the numbers the visitor gives; never invent them. Frame the structure clearly. No fluff.\n'
    + 'Output ONLY valid JSON with exactly: {"title":"...","summary":"...","situation":"...","action":"...","results":["...","..."],"lesson":"..."}\n'
    + 'CONTEXT about the writer:\n' + ctx;
}
function userMessage(m) {
  return 'Campaign inputs:\n'
    + 'Channel: ' + (m.channel || '?') + '\n'
    + 'Company/industry: ' + (m.company || '?') + '\n'
    + 'Goal: ' + (m.goal || '?') + '\n'
    + 'Before (e.g. spend/CPL/ROAS/conversions): ' + (m.before || '?') + '\n'
    + 'After: ' + (m.after || '?') + '\n'
    + 'What you did (actions taken): ' + (m.action || '?') + '\n'
    + (m.note ? 'Extra: ' + m.note : '')
    + '\n\nWrite the case study draft now.';
}
function fallback(m) {
  const bef = String(m.before || '').trim(), aft = String(m.after || '').trim();
  return {
    title: 'Case study: ' + (String(m.company || m.channel || 'campaign').slice(0, 40)) + ' — ' + (String(m.goal || 'performance turnaround')),
    summary: 'A ' + (String(m.channel || 'paid media') + ' effort to ' + String(m.goal || 'improve efficiency') + '. ' + (bef ? 'Before: ' + bef + '. ' : '') + (aft ? 'After: ' + aft + '.' : ''),
    situation: 'The business needed a measurable improvement in ' + String(m.goal || 'campaign efficiency') + ', with tight budget discipline.',
    action: 'Structured the account, tightened targeting to the highest-intent segments, and shifted budget toward the creative + landing page fixes that convert.',
    results: [aft ? 'After: ' + aft : 'Improved core KPIs while keeping spend controlled', 'Ran every change through a live dashboard so nothing moved on a hunch'],
    lesson: 'Most ' + (String(m.channel || 'campaign') + ' problems are structural, not a budget problem — clean account structure and one strong angle beat more spend.')
  };
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/casestudy with {channel, company, goal, before, after, action, note}' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const m = {
    channel: String(b.channel || '').slice(0, 60), company: String(b.company || '').slice(0, 80), goal: String(b.goal || '').slice(0, 80),
    before: String(b.before || '').slice(0, 300), after: String(b.after || '').slice(0, 300), action: String(b.action || '').slice(0, 400), note: String(b.note || '').slice(0, 300)
  };
  const n = rate(ipOf(req) + ':cs');
  if (n > RL_MAX) return res.status(429).json({ error: 'rate limited' });
  kv([['LPUSH', 'leads:recent', JSON.stringify({ type: 'casestudy', at: new Date().toISOString(), channel: m.channel, company: m.company })], ['LTRIM', 'leads:recent', 0, 49]]);
  const key = (process.env.GROQ_API_KEY || '').trim();
  const fb = fallback(m);
  if (!key) return res.json(Object.assign({ mode: 'template' }, fb));
  const ctx = KB.filter(function (b) { return ['results', 'experience', 'approach'].indexOf(b.topic) > -1; }).map(function (b) { return '- [' + b.topic + '] ' + b.text; }).join('\n');
  fetch(GROQ, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.5, max_tokens: 640, messages: [{ role: 'system', content: sys(ctx) }, { role: 'user', content: userMessage(m) }] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let out = null;
      try { out = JSON.parse(text); } catch (e) { const mm = text.match(/\{[\s\S]*\}/); if (mm) { try { out = JSON.parse(mm[0]); } catch (e2) {} } }
      if (!out || !out.results) return res.json(Object.assign({ mode: 'template' }, fb));
      res.json({ mode: 'ai', title: out.title || fb.title, summary: out.summary || fb.summary, situation: out.situation || fb.situation, action: out.action || fb.action, results: (out.results || []).slice(0, 5), lesson: out.lesson || fb.lesson });
    })
    .catch(function () { res.json(Object.assign({ mode: 'template' }, fb)); });
};