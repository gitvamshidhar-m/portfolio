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

const DIAG = [
  { test: function (m) { return m.cpl > 0 && m.revPerLead > 0 ? m.cpl / (m.revPerLead || 1) : 0; }, flag: 'Your CPA eats more than {x}% of revenue per lead — margin is thin.', risk: 'cost inflation' },
  { test: function (m) { return m.ctr < 0.8; }, flag: 'CTR under 0.8% means the angle/hook is doing the heavy lifting badly — creative is the leak.', risk: 'weak creative' },
  { test: function (m) { return m.conv < 1.5; }, flag: 'Traffic converts under 1.5% — the landing page and offer flow need work, not more clicks.', risk: 'low conversion' },
  { test: function (m) { return m.dayBudget < m.cpl; }, flag: 'Daily budget below your CPL means the account can never reach learning phase cleanly.', risk: 'under-budgeted' }
];

function ctxFor(q) {
  const tops = { ppc: ['experience', 'results', 'skills'], seo: ['results', 'skills', 'experience'], ai: ['products', 'skills', 'results'], growth: ['results', 'approach', 'products'] };
  const keys = tops[q.focus] || ['results', 'approach', 'experience'];
  return KB.filter(function (b) { return keys.indexOf(b.topic) > -1; }).map(function (b) { return '- [' + b.topic + '] ' + b.text; }).join('\n');
}
function sys(ctx) {
  return 'You are Vamshidhar Reddy, an AI-augmented performance marketer (10+ years: Google/LinkedIn/Meta paid media, SEO, CRO). A visitor just gave you their campaign metrics and wants a fast, honest mini-audit.\n'
    + 'Task: produce (1) one-line "diagnosis" (what central problem the numbers suggest), (2) exactly 3 specific recommendations, each with a one-line "why".\n'
    + 'Rules: Use ONLY the metrics the visitor gave (never invent conversions or spend). Be direct, specific, action-first. No fluff, no generic "improve your ads".\n'
    + 'Output ONLY valid JSON with exactly: {"diagnosis":"...","recs":[{"rec":"...","why":"..."}]}\n'
    + 'CONTEXT about what kind of marketer is auditing you:\n' + ctx;
}
function userMessage(m) {
  return 'Campaign metrics I gave:\n'
    + 'Channel: ' + (m.channel || 'unknown') + '\n'
    + 'Monthly spend: ' + (m.spend || '?') + '\n'
    + 'CPL/CAC: ' + (m.cpl || '?') + '\n'
    + 'CTR %: ' + (m.ctr || '?') + '\n'
    + 'Conversion rate %: ' + (m.conv || '?') + '\n'
    + 'Revenue per lead: ' + (m.revPerLead || '?') + '\n'
    + (m.note ? 'Extra context: ' + m.note + '\n' : '')
    + '\nWrite the diagnosis + 3 recommendations now.';
}
function fallback(m) {
  const recs = [];
  if (num(m.ctr, 0) < 0.8) recs.push({ rec: 'Rewrite hooks and swap the creative angle — at ' + num(m.ctr, 0) + '% CTR the ad itself is the blocker, not the bid.', why: 'CTR under ~0.8% means the platform is showing a weak hook; improving the angle raises CTR and lowers effective CPM.' });
  if (num(m.conv, 0) < 1.5 && num(m.conv, 0) > 0) recs.push({ rec: 'Ship one landing-page fix this week: cut form fields, add social proof and a single CTA — don’t spend more until conversion improves.', why: 'Higher traffic on a page that converts at <1.5% multiplies waste; fixing the page first preserves spend.' });
  if (num(m.cpl, 0) === 0 && num(m.conv, 0) === 0 && num(m.ctr, 0) === 0) recs.push({ rec: 'Add conversion tracking (GA4 + platform pixels) before scaling — you are currently flying without a cost per lead.', why: 'Every decision needs a number; CPL is the single metric that decides whether the campaign can be scaled.' });
  if (!recs.length) recs.push({ rec: 'Consolidate the account: collapse overlapping ad groups under one clear structure and let one strong angle win.', why: 'Cleaner account structure (from a real case: 40+ ad groups to 8) lifts ROAS by concentrating spend on winners.' });
  return { diagnosis: 'Your numbers smell like a scaling problem more than a budget problem — the leaks are likely creative and funnel, not spend.', recs: recs };
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/audit with {channel, spend, cpl, ctr, conv, revPerLead, note, focus}' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const m = {
    channel: String(b.channel || '').slice(0, 40), spend: String(b.spend || '').slice(0, 40), cpl: String(b.cpl || '').slice(0, 40),
    ctr: String(b.ctr || '').slice(0, 40), conv: String(b.conv || '').slice(0, 40), revPerLead: String(b.revPerLead || '').slice(0, 40),
    note: String(b.note || '').slice(0, 400), focus: String(b.focus || 'growth').slice(0, 20)
  };
  const n = rate(ipOf(req) + ':audit');
  if (n > RL_MAX) return res.status(429).json({ error: 'rate limited' });
  kv([['LPUSH', 'leads:recent', JSON.stringify({ type: 'audit', at: new Date().toISOString(), channel: m.channel, spend: m.spend, cpl: m.cpl, ctr: m.ctr, conv: m.conv })], ['LTRIM', 'leads:recent', 0, 49]]);
  const key = (process.env.GROQ_API_KEY || '').trim();
  const fb = fallback(m);
  if (!key) return res.json({ diagnosis: fb.diagnosis, recs: fb.recs, mode: 'template' });
  fetch(GROQ, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 520, messages: [{ role: 'system', content: sys(ctxFor(m)) }, { role: 'user', content: userMessage(m) }] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let out = null;
      try { out = JSON.parse(text); } catch (e) { const mm = text.match(/\{[\s\S]*\}/); if (mm) { try { out = JSON.parse(mm[0]); } catch (e2) {} } }
      if (!out || !Array.isArray(out.recs)) return res.json({ diagnosis: fb.diagnosis, recs: fb.recs, mode: 'template' });
      res.json({ diagnosis: out.diagnosis || fb.diagnosis, recs: (out.recs || []).slice(0, 3), mode: 'ai' });
    })
    .catch(function () { res.json({ diagnosis: fb.diagnosis, recs: fb.recs, mode: 'template' }); });
};