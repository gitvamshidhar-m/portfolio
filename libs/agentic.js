const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const { serp, serpQuery, formatSerp } = require('./tools/serp');

const rl = { hits: {}, last: Date.now() };
const RL_WIN = 60000, RL_MAX = 6;
function rate(key) { const now = Date.now(); if (now - rl.last > RL_WIN) { rl.hits = {}; rl.last = now; } rl.hits[key] = (rl.hits[key] || 0) + 1; return rl.hits[key]; }
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
function kv(pipe) { if (!KV_URL || !KV_TOKEN) return Promise.resolve(); return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {}); }

const AGENTS = ['research', 'strategy', 'content', 'media', 'analytics', 'optimizer'];

function sys() {
  return 'You are the ORCHESTRATOR of a multi-agent digital-marketing system. Given a marketing GOAL you must plan and "run" a team of autonomous agents. Each agent independently thinks, picks tools, takes an action, and produces an output. Later agents must build on earlier agents\' outputs (handoffs), so the plan reads like a real autonomous workflow, not 6 disconnected blurbs.\n'
    + 'Return ONLY valid minified JSON (no markdown, no commentary) with exactly this shape:\n'
    + '{\n'
    + '  "goal":"<echo the goal, trimmed>",\n'
    + '  "orchestrator":"<one-line plan: how the agents will split the work>",\n'
    + '  "agents":[\n'
    + '    {"id":"research","name":"Research Agent","persona":"The Scout","role":"Market & audience intelligence","tools":["web_search","analytics"],"thinking":"<1 sentence: what it reasons about, skeptical of assumptions>","action":"<1 sentence: the concrete step it takes>","output":"<1-2 sentences: the specific finding it hands to the next agent>","status":"done"},\n'
    + '    {"id":"strategy","name":"Strategy Agent","persona":"The Architect","role":"Positioning, channels & budget","tools":["planner"],"thinking":"...","action":"...","output":"... references the research agent\'s finding","status":"done"},\n'
    + '    {"id":"content","name":"Content Agent","persona":"The Wordsmith","role":"Copy, creative & brand voice","tools":["llm_writer","brand_voice"],"thinking":"...","action":"...","output":"... references the strategy","status":"done"},\n'
    + '    {"id":"media","name":"Media Buying Agent","persona":"The Operator","role":"Campaign build & targeting","tools":["ad_platform","audience_sync"],"thinking":"...","action":"...","output":"... references the content + strategy","status":"done"},\n'
    + '    {"id":"analytics","name":"Analytics Agent","persona":"The Truth-Teller","role":"Tracking, KPIs & dashboards","tools":["ga4","pixel"],"thinking":"...","action":"...","output":"... defines how success is measured","status":"done"},\n'
    + '    {"id":"optimizer","name":"Optimizer Agent","persona":"The Tinkerer","role":"Always-on improvement loop","tools":["experiment","alert"],"thinking":"...","action":"...","output":"... closes the loop back to research","status":"done"}\n'
    + '  ],\n'
    + '  "campaignPlan":{\n'
    + '    "channels":["<channel>","<channel>"],\n'
    + '    "budget":{"total":"<amount>","split":"<how it is split across channels>"},\n'
    + '    "kpis":["<kpi>","<kpi>"],\n'
    + '    "timeline":["Week 1: <milestone>","Week 2-4: <milestone>","Week 5-8: <milestone>","Week 9-12: <milestone>"]\n'
    + '  },\n'
    + '  "summary":"<2-3 sentence wrap-up a client would read>"\n'
    + '}\n'
    + 'You have a LIVE SERP tool — real search results are passed in the user message under "LIVE SEARCH CONTEXT". The Research Agent MUST ground its output in them (reference real domains/sources), and later agents must build on that research.\n'
    + 'Rules: be concrete and specific to the GOAL (name real channels, real numbers, real tactics). Keep every field tight (1-2 sentences). Never invent a separate JSON block. Output MUST be parseable JSON.';
}
function userMessage(m, serpBlock) {
  return 'GOAL: ' + (m.goal || '') + '\n'
    + (m.niche ? 'NICHE / PRODUCT: ' + m.niche + '\n' : '')
    + (m.budget ? 'MONTHLY BUDGET: ' + m.budget + '\n' : '')
    + (m.channels ? 'PREFERRED CHANNELS: ' + m.channels + '\n' : '')
    + (serpBlock ? '\nLIVE SEARCH CONTEXT (real SERP results for "' + (serpBlock.query || '') + '"):\n' + serpBlock.text + '\n' : '')
    + '\nRun Hive and return the JSON plan now.';
}

function inferNiche(goal) {
  const g = String(goal || '').toLowerCase();
  if (/b2b|saas|software|enterprise|api|platform|crm|workflow/.test(g)) return 'b2b_saas';
  if (/ecommerce|shopify|d2c|dtc|store|retail|product|skincare|apparel/.test(g)) return 'ecommerce';
  if (/local|restaurant|clinic|salon|dentist|agency|lawyer|real estate|realtor|near me|gym/.test(g)) return 'local_service';
  if (/course|coach|coaching|infoproduct|membership|creator|youtube|creator/.test(g)) return 'creator';
  return 'general';
}
function channelSet(niche) {
  switch (niche) {
    case 'b2b_saas': return ['LinkedIn Ads', 'Google Search', 'Cold email + Apollo', 'G2 / review sites', 'Webinars'];
    case 'ecommerce': return ['Meta (FB/IG) Ads', 'Google Shopping', 'TikTok Ads', 'Influencer seeding', 'Email + SMS'];
    case 'local_service': return ['Google Local Services', 'Meta geo Ads', 'Local SEO', 'Google Maps', 'Reviews'];
    case 'creator': return ['YouTube', 'Instagram', 'TikTok', 'Email newsletter', 'Community'];
    default: return ['Meta Ads', 'Google Ads', 'LinkedIn', 'Email / CRM', 'Content + SEO'];
  }
}
function fallback(m) {
  const goal = String(m.goal || 'a new growth campaign').trim();
  const niche = inferNiche(goal);
  const channels = channelSet(niche);
  const budget = (m.budget && String(m.budget).trim()) || (niche === 'b2b_saas' ? '₹2.5L–₹4L / mo' : niche === 'local_service' ? '₹60k–₹1.2L / mo' : '₹1.5L–₹3L / mo');
  const core = goal.charAt(0).toUpperCase() + goal.slice(1);
  const ag = (id, name, role, tools, thinking, action, output) => ({ id, name, role, tools, thinking, action, output, status: 'done' });
  return {
    goal: goal,
    orchestrator: 'Research sizes the audience, Strategy sets channels + budget, Content + Media ship the launch, Analytics measures, Optimizer closes the loop.',
    agents: [
      ag('research', 'Research Agent', 'Market & audience intelligence', ['web_search', 'analytics'],
        'Maps who actually buys and where they hang out for: "' + core + '".',
        'Pulls demand, competitor and audience signals across ' + channels.slice(0, 3).join(', ') + '.',
        'Primary ICP + 3 best channels identified: ' + channels.slice(0, 2).join(' and ') + ' — handed to Strategy.'),
      ag('strategy', 'Strategy Agent', 'Positioning, channels & budget', ['planner'],
        'Turns the research into a focused plan instead of spraying budget.',
        'Allocates "' + budget + '" across the highest-intent channels only.',
        'Plan: lead with ' + channels[0] + ', then ' + (channels[1] || channels[0]) + '; 70/30 testing split — handed to Content.'),
      ag('content', 'Content Agent', 'Copy, creative & brand voice', ['llm_writer', 'brand_voice'],
        'Writes in the brand voice the strategy defined, not generic filler.',
        'Drafts hook variants, landing page and ad copy mapped to the ICP.',
        '3 hook angles + 1 landing page ready for Media to launch — handed to Media.'),
      ag('media', 'Media Buying Agent', 'Campaign build & targeting', ['ad_platform', 'audience_sync'],
        'Builds the campaigns exactly as Content + Strategy specified.',
        'Launches ' + channels[0] + ' with the winning hooks and tight audiences.',
        'Live campaigns with audience sync + budget caps — handed to Analytics.'),
      ag('analytics', 'Analytics Agent', 'Tracking, KPIs & dashboards', ['ga4', 'pixel'],
        'Makes sure every rupee is measurable before it scales.',
        'Wires GA4 + pixels and stands up a one-screen KPI dashboard.',
        'Tracking live; KPIs = CPL, CTR, demo rate, ROAS — handed to Optimizer.'),
      ag('optimizer', 'Optimizer Agent', 'Always-on improvement loop', ['experiment', 'alert'],
        'Keeps improving using the KPIs Analytics defined.',
        'Auto-flags underperforming ads and rotates in the next hook variant.',
        'Weekly experiment loop feeds fresh signal back to Research — Hive keeps learning.')
    ],
    campaignPlan: {
      channels: channels,
      budget: { total: budget, split: '70% to top channel, 30% to experiments' },
      kpis: ['CPL / CAC', 'CTR & hook win-rate', 'Demo / lead rate', 'ROAS'],
      timeline: ['Week 1: Research + tracking live', 'Week 2-4: Launch ' + channels[0] + ' + content', 'Week 5-8: Scale winners, cut losers', 'Week 9-12: Automate the optimizer loop']
    },
    summary: 'A 6-agent Hive takes "' + core + '" from blank page to a measured, self-optimizing campaign — research to reporting handled without a meeting. That is agentic marketing: autonomous agents that plan, act and improve, with you approving the big calls.'
  };
}

function safePlan(obj) {
  if (!obj || !Array.isArray(obj.agents)) return null;
  obj.agents = obj.agents.filter(function (a) { return a && a.id && a.name; }).slice(0, 8);
  if (!obj.agents.length) return null;
  if (!obj.campaignPlan || typeof obj.campaignPlan !== 'object') obj.campaignPlan = {};
  if (!Array.isArray(obj.campaignPlan.channels)) obj.campaignPlan.channels = [];
  if (!Array.isArray(obj.campaignPlan.kpis)) obj.campaignPlan.kpis = [];
  if (!Array.isArray(obj.campaignPlan.timeline)) obj.campaignPlan.timeline = [];
  return obj;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/agentic with {goal, niche?, budget?, channels?}' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const m = {
    goal: String(b.goal || '').slice(0, 600).trim(),
    niche: String(b.niche || '').slice(0, 120).trim(),
    budget: String(b.budget || '').slice(0, 120).trim(),
    channels: String(b.channels || '').slice(0, 200).trim()
  };
  if (!m.goal) return res.status(400).json({ error: 'goal is required' });
  const n = rate(ipOf(req) + ':agentic');
  if (n > RL_MAX) return res.status(429).json({ error: 'rate limited' });
  kv([['LPUSH', 'agentic:runs', JSON.stringify({ at: new Date().toISOString(), goal: m.goal.slice(0, 120) })], ['LTRIM', 'agentic:runs', 0, 99]]);

  const key = (process.env.GROQ_API_KEY || '').trim();
  const fb = fallback(m);
  if (!key) return res.json(Object.assign({ mode: 'template', serpUsed: false, serpCount: 0 }, fb));

  let serpResults = null, serpQ = '';
  try { serpQ = serpQuery(m); serpResults = await serp(serpQ); } catch (e) { serpResults = null; }
  const serpCount = Array.isArray(serpResults) ? serpResults.length : 0;
  const serpBlock = serpCount ? { query: serpQ, text: formatSerp(serpResults) } : null;

  fetch(GROQ, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0.55, max_tokens: 1500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys() }, { role: 'user', content: userMessage(m, serpBlock) }] })
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let out = null;
      try { out = JSON.parse(text); } catch (e) { const mm = text.match(/\{[\s\S]*\}/); if (mm) { try { out = JSON.parse(mm[0]); } catch (e2) {} } }
      const plan = safePlan(out);
      if (!plan) return res.json(Object.assign({ mode: 'template', serpUsed: false, serpCount: 0 }, fb));
      res.json(Object.assign({ mode: 'ai', serpUsed: serpCount > 0, serpCount: serpCount, serpQuery: serpQ }, plan));
    })
    .catch(function () { res.json(Object.assign({ mode: 'template', serpUsed: false, serpCount: 0 }, fb)); });
};
