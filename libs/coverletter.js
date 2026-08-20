const KB = require('../libs/kb');
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

const rl = { hits: {}, last: Date.now() };
const RL_WIN = 60000, RL_MAX = 8;
function rate(key) { const now = Date.now(); if (now - rl.last > RL_WIN) { rl.hits = {}; rl.last = now; } rl.hits[key] = (rl.hits[key] || 0) + 1; return rl.hits[key]; }
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
function kv(pipe) { if (!KV_URL || !KV_TOKEN) return Promise.resolve(); return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {}); }

const FOCUS = { ppc: 'Paid Media / PPC', seo: 'SEO & Content', ai: 'AI Automation', growth: 'Full-Funnel Growth' };
const ROLE = {
  ppc: 'I own paid full-funnel — Google/LinkedIn Ads, target CPA, creative A/B — and I build creative predictors so budget spends on winners.',
  seo: 'I own technical SEO, on-page, content intent mapping and the analytics that prove organic ROI.',
  ai: 'I ship my own AI marketing tools solo (three live products), so automation is a deployed artefact, not a slide.',
  growth: 'I go strategy → build → launch → scale end-to-end with an ROI number on every move.'
};
const KPI = {
  cpl: 'cut a client cost-per-lead from Rs.1,100 to Rs.770 (-30%)',
  roas: 'lifted ROAS from ~3.2x to ~5.5x by consolidating 40+ ad groups into 8',
  traffic: 'grew organic traffic ~15% via technical SEO audits and fixes',
  leads: 'generate 70+ qualified leads a month at my current company',
  retention: 'designed buy-flow and win-back flows inside my own AI SaaS products'
};
const STAGES = { startup: 'a lean fast-moving stage where one person owns demand', scale: 'a scale-up that needs channel discipline', enterprise: 'an enterprise with GA4/Looker, approvals and heavy tooling' };

function ctxFor(q) {
  const kw = q.focus || 'growth';
  const tops = { ppc: ['experience', 'results', 'skills'], seo: ['results', 'skills', 'experience'], ai: ['products', 'skills', 'results'], growth: ['results', 'approach', 'products'] };
  const keys = tops[kw] || ['results', 'approach', 'experience'];
  return KB.filter(function (b) { return keys.indexOf(b.topic) > -1; }).map(function (b) { return '- [' + b.topic + '] ' + b.text; }).join('\n');
}
function sys(ctx) {
  return 'You copywrite as Vamshidhar Reddy M, a performance marketer who also builds AI tools. 10+ years SEO/PPC/automation, three live solo products, Hyderabad (remote-friendly), open to work.\n'
    + 'Task: from the QUESTION below produce (1) a short outreach email subject + body, max 160 words, from me to the employer, first person, confident but not desperate, ending with a low-friction ask (15-min call); (2) up to 5 specific "first 30 days" bullets.\n'
    + 'Rules: use ONLY the CONTEXT facts — never invent numbers or products.\n'
    + 'Output ONLY valid JSON with exactly: {"subject":"...","email":"...","plan":["..."]}\n'
    + 'CONTEXT:\n' + ctx;
}
function userMessage(q) {
  const lines = [];
  if (q.mode === 'jd') {
    lines.push('Employer: ' + (q.company || 'a company I am applying to'));
    lines.push('Job description pasted by the recruiter:\n' + String(q.jd || '').slice(0, 3000));
  } else {
    lines.push('Pitch-wizard answers:');
    lines.push('- Hiring for: ' + (FOCUS[q.focus] || 'digital marketing'));
    lines.push('- Stage: ' + (STAGES[q.stage] || 'a growing business'));
    lines.push('- Most-wanted KPI: ' + (KPI[q.kpi] || 'proven ROI'));
  }
  lines.push('Write the email + 30-day plan now. My value prop: ' + (ROLE[q.focus] || ROLE.growth));
  return lines.join('\n');
}
function fallback(q) {
  const fl = FOCUS[q.focus] || FOCUS.growth;
  const kp = KPI[q.kpi] || KPI.leads;
  const email = 'Hi there,\n\nI am a performance marketer who builds AI tools — 10+ years in paid media, SEO and automation, and three live products I shipped solo, so everything I do is measured.\n\nMy value prop: ' + (ROLE[q.focus] || ROLE.growth) + '\n\nOn the record: ' + kp + '. My own portfolio shows it live — an ROI model and a visitor log you can actually click.\n\nCould we find 20 minutes this week? geovamshidhar@gmail.com · +91-7981719085\n\nBest,\nVamshidhar Reddy M';
  return {
    subject: 'Vamshidhar — ' + fl + ' who ships, with a 30-day plan attached',
    email: email,
    plan: [
      'Run a free 30-minute growth audit and agree the target KPI.',
      'Stand up a live dashboard (GA4/Looker or the AI pipeline) within week one.',
      'Audit current spend: consolidate ad groups, rules for target CPA, creative A/B roadmap.',
      'Map the technical SEO backlog to the pages that matter most for converting.',
      'Automate the top repeat report before month two with one of my AI tools.'
    ]
  };
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/coverletter with {mode:"jd"|"quiz", focus, jd?, company?, stage?, kpi?}' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const q = { mode: b.mode === 'quiz' ? 'quiz' : 'jd', focus: (b.focus || 'growth').toString().slice(0, 20), jd: (b.jd || '').toString(), company: (b.company || '').toString().slice(0, 120), stage: (b.stage || '').toString(), kpi: (b.kpi || '').toString() };
  if (q.mode === 'jd' && !String(q.jd || '').trim()) return res.status(400).json({ error: 'missing job description' });
  const key = (process.env.GROQ_API_KEY || '').trim();
  const n = rate(ipOf(req) + ':cl:' + q.focus);
  if (n > RL_MAX) return res.status(429).json({ error: 'rate limited' });
  kv([['LPUSH', 'leads:recent', JSON.stringify({ type: 'cover', focus: q.focus, at: new Date().toISOString(), company: q.company })], ['LTRIM', 'leads:recent', 0, 49]]);
  const fb = fallback(q);
  if (!key) return res.json({ subject: fb.subject, email: fb.email, plan: fb.plan, mode: 'template' });
  const ctx = ctxFor(q);
  fetch(GROQ, { method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.5, max_tokens: 700, messages: [{ role: 'system', content: sys(ctx) }, { role: 'user', content: userMessage(q) }] }) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let out = null;
      try { out = JSON.parse(text); } catch (e) {
        const m = text.match(/\{[\s\S]*\}/); if (m) { try { out = JSON.parse(m[0]); } catch (e2) {} }
      }
      if (!out || !out.email) return res.json({ subject: 'Vamshiyi — ' + (FOCUS[q.focus] || 'growth') + ' who ships', email: text, plan: [], mode: 'raw' });
      res.json({ subject: out.subject, email: out.email, plan: out.plan || [], mode: 'ai' });
    })
    .catch(function (e) {
      const fb2 = fallback(q);
      res.json({ subject: fb2.subject, email: fb2.email, plan: fb2.plan, mode: 'template', error: String(e) });
    });
};