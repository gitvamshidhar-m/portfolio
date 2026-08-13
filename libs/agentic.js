const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const GROQ_TIMEOUT = 15000;
const { serp, serpQuery, formatSerp } = require('./tools/serp');
const { runTool, fmtResult } = require('./tools/exec');
const crypto = require('crypto');

const RL_MAX = 6, RL_WIN_SEC = 60;
const _mem = { hits: {}, last: 0 };
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
// KV-backed sliding-window rate limit (survives cold starts); in-memory fallback when KV is off.
async function isRateLimited(key) {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCR', 'rl:agentic:' + key], ['EXPIRE', 'rl:agentic:' + key, RL_WIN_SEC]])
      });
      const j = await res.json();
      const first = Array.isArray(j) ? j[0] : null;
      const n = first ? (first && typeof first === 'object' && !Array.isArray(first) ? (first.result || 0) : (Number(first) || 0)) : 0;
      return Number(n) > RL_MAX;
    } catch (e) {}
  }
  const now = Date.now();
  if (now - _mem.last > RL_WIN_SEC * 1000) { _mem.hits = {}; _mem.last = now; }
  _mem.hits[key] = (_mem.hits[key] || 0) + 1;
  return _mem.hits[key] > RL_MAX;
}
function kv(pipe) { if (!KV_URL || !KV_TOKEN) return Promise.resolve(); return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {}); }
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const r = await fetch(String(KV_URL).replace(/\/$/, '') + '/get/' + encodeURIComponent(key), {
      method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN }
    });
    const j = await r.json();
    return (j && j.result != null) ? j.result : null;
  } catch (e) { return null; }
}
function runId(m) { return crypto.createHash('sha1').update(String(m.goal || '') + '|' + String(m.niche || '') + '|' + String(m.budget || '')).digest('hex').slice(0, 12); }

const AGENTS = ['research', 'strategy', 'content', 'media', 'analytics', 'optimizer'];

function sys(domainList) {
  return 'You are the ORCHESTRATOR of a multi-agent digital-marketing system. Given a marketing GOAL you must plan and "run" a team of autonomous agents. Each agent independently thinks, picks tools, takes an action, and produces an output. Later agents must build on earlier agents\' outputs (handoffs), so the plan reads like a real autonomous workflow, not 6 disconnected blurbs.\n'
    + 'Return ONLY valid minified JSON (no markdown, no commentary) with exactly this shape:\n'
    + '{\n'
    + '  "goal":"<echo the goal, trimmed>",\n'
    + '  "orchestrator":"<one-line plan: how the agents will split the work>",\n'
    + '  "agents":[\n'
    + '    {"id":"research","name":"Research Agent","persona":"The Scout","role":"Market & audience intelligence","tools":["serp.search"],"thinking":"<1 sentence: what it reasons about, skeptical of assumptions>","action":"<1 sentence: the concrete step it takes>","output":"<2 sentences: the specific finding it hands to the next agent>","live":"<4-8 words, present continuous, what this agent is doing right now>","call":"serp.search","toolArgs":{"q":"<a real keyword or question this agent would search>"},"result":"<predicted one-line tool outcome>","status":"done"},\n'
    + '    {"id":"strategy","name":"Strategy Agent","persona":"The Architect","role":"Positioning, channels & budget","tools":["planner.allocate"],"thinking":"...","action":"...","output":"... references the research findings","live":"...","call":"planner.allocate","toolArgs":{"total":123456,"channels":["<channel>","<channel>"],"weights":[0.5,0.5]},"result":"...","status":"done"},\n'
    + '    {"id":"content","name":"Content Agent","persona":"The Wordsmith","role":"Copy, creative & brand voice","tools":["llm.draft"],"thinking":"...","action":"...","output":"... references the strategy","live":"...","call":"llm.draft","toolArgs":{"brief":"<a short brief for the copy>"},"result":"...","status":"done"},\n'
    + '    {"id":"media","name":"Media Buying Agent","persona":"The Operator","role":"Campaign build & targeting","tools":["calc.roi"],"thinking":"...","action":"...","output":"... references the content + strategy","live":"...","call":"calc.roi","toolArgs":{"revenue":450000,"spend":150000},"result":"...","status":"done"},\n'
    + '    {"id":"analytics","name":"Analytics Agent","persona":"The Truth-Teller","role":"Tracking, KPIs & dashboards","tools":["calc.cpl"],"thinking":"...","action":"...","output":"... defines how success is measured","live":"...","call":"calc.cpl","toolArgs":{"spend":90000,"leads":120,"clicks":3000,"impressions":100000},"result":"...","status":"done"},\n'
    + '    {"id":"optimizer","name":"Optimizer Agent","persona":"The Tinkerer","role":"Always-on improvement loop","tools":["market.sizer"],"thinking":"...","action":"...","output":"... closes the loop back to research","live":"...","call":"market.sizer","toolArgs":{"searches":25000,"ctr":0.04,"conv":0.03,"aov":1500},"result":"...","status":"done"}\n'
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
    + (domainList ? 'REAL SOURCES available to cite: ' + domainList + '. The Research Agent MUST name at least one of these real domains in its "output" (e.g. "signal from example.com"), and later agents must build on that research.\n' : '')
    + 'Rules: be concrete and specific to the GOAL (name real channels, real numbers, real tactics). Keep every field tight (1-2 sentences). Every agent MUST include a "live" field: 4-8 words, present continuous, describing what that agent is doing right now. Every agent MUST include a "call" field — one of these REAL tools, with a matching "toolArgs" object:\n'
    + '  serp.search      {q:"<keyword>"}                    — live web search\n'
    + '  planner.allocate {total:<number>, channels:[..], weights:[..]} — budget split\n'
    + '  calc.roi         {revenue:<number>, spend:<number>} — ROAS\n'
    + '  calc.cpl         {spend,leads,clicks,impressions}   — CPL/CTR\n'
    + '  market.sizer     {searches,ctr,conv,aov}            — market funnel\n'
    + '  llm.draft        {brief:"<copy brief>"}             — draft hook/ad line\n'
    + 'Recommended: research→serp.search, strategy→planner.allocate, content→llm.draft, media→calc.roi, analytics→calc.cpl, optimizer→market.sizer. The "result" field is a PREDICTION only — the server will actually execute the tool and replace it with the real return value. Never invent a separate JSON block. Output MUST be parseable JSON.';
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
  const ag = (id, name, role, tools, thinking, action, output, live, call, toolArgs, result) => ({ id, name, role, tools, thinking, action, output, live, call, toolArgs, result, status: 'done' });
  return {
    goal: goal,
    orchestrator: 'Research sizes the audience, Strategy sets channels + budget, Content + Media ship the launch, Analytics measures, Optimizer closes the loop.',
    agents: [
      ag('research', 'Research Agent', 'Market & audience intelligence', ['serp.search'],
        'Maps who actually buys and where they hang out for: "' + core + '".',
        'Pulls demand, competitor and audience signals across ' + channels.slice(0, 3).join(', ') + '.',
        'Primary ICP + 3 best channels identified: ' + channels.slice(0, 2).join(' and ') + ' — handed to Strategy.',
        'Sizing the audience via live SERP…',
        'serp.search', { q: goal }, '3 competitor angles · top intent identified'),
      ag('strategy', 'Strategy Agent', 'Positioning, channels & budget', ['planner.allocate'],
        'Turns the research into a focused plan instead of spraying budget.',
        'Allocates "' + budget + '" across the highest-intent channels only.',
        'Plan: lead with ' + channels[0] + ', then ' + (channels[1] || channels[0]) + '; 70/30 testing split — handed to Content.',
        'Turning signal into a focused plan…',
        'planner.allocate', { total: 200000, channels: channels.slice(0, 3), weights: [0.4, 0.3, 0.3] }, budget + ' · top channels'),
      ag('content', 'Content Agent', 'Copy, creative & brand voice', ['llm.draft'],
        'Writes in the brand voice the strategy defined, not generic filler.',
        'Drafts hook variants, landing page and ad copy mapped to the ICP.',
        '3 hook angles + 1 landing page ready for Media to launch — handed to Media.',
        'Drafting hooks + landing copy in brand voice…',
        'llm.draft', { brief: core }, '3 hooks + 1 landing page'),
      ag('media', 'Media Buying Agent', 'Campaign build & targeting', ['calc.roi'],
        'Builds the campaigns exactly as Content + Strategy specified.',
        'Launches ' + channels[0] + ' with the winning hooks and tight audiences.',
        'Live campaigns with audience sync + budget caps — handed to Analytics.',
        'Building & launching the campaigns…',
        'calc.roi', { revenue: 450000, spend: 150000 }, 'ROAS projected from the launch mix'),
      ag('analytics', 'Analytics Agent', 'Tracking, KPIs & dashboards', ['calc.cpl'],
        'Makes sure every rupee is measurable before it scales.',
        'Wires GA4 + pixels and stands up a one-screen KPI dashboard.',
        'Tracking live; KPIs = CPL, CTR, demo rate, ROAS — handed to Optimizer.',
        'Wiring tracking + the KPI dashboard…',
        'calc.cpl', { spend: 88080, leads: 120, clicks: 3000, impressions: 100000 }, 'CPL, CTR from the media plan'),
      ag('optimizer', 'Optimizer Agent', 'Always-on improvement loop', ['market.sizer'],
        'Keeps improving using the KPIs Analytics defined.',
        'Auto-flags underperforming ads and rotates in the next hook variant.',
        'Weekly experiment loop feeds fresh signal back to Research — Hive keeps learning.',
        'Spinning up the experiment loop…',
        'market.sizer', { searches: 25000, ctr: 0.04, conv: 0.03, aov: 1500 }, 'funnel estimate')
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

// Fallback field defaults so a truncated/missing-key JSON response still renders a complete card.
const AGENT_DEFAULTS = {
  research: {
    name: 'Research Agent', role: 'Market & audience intelligence', persona: 'The Scout', tools: ['web_search', 'analytics'],
    thinking: 'Maps who actually buys and where they hang out for this goal.',
    action: 'Pulls demand, competitor and audience signals across the highest-intent channels.',
    output: 'Primary ICP + 3 best channels identified — handed to Strategy.',
    live: 'Sizing the audience via live SERP…', call: 'serp.search',
    result: '3 competitor angles · top intent identified'
  },
  strategy: {
    name: 'Strategy Agent', role: 'Positioning, channels & budget', persona: 'The Architect', tools: ['planner'],
    thinking: 'Turns the research into a focused plan instead of spraying budget.',
    action: 'Allocates budget across the highest-intent channels only.',
    output: 'Plan: lead with the top channel, 70/30 testing split — handed to Content.',
    live: 'Turning signal into a focused plan…', call: 'planner.allocate',
    result: 'budget · 70/30 split · top 2 channels'
  },
  content: {
    name: 'Content Agent', role: 'Copy, creative & brand voice', persona: 'The Wordsmith', tools: ['llm_writer', 'brand_voice'],
    thinking: 'Writes in the brand voice the strategy defined, not generic filler.',
    action: 'Drafts hook variants, landing page and ad copy mapped to the ICP.',
    output: '3 hook angles + 1 landing page ready for Media — handed to Media.',
    live: 'Drafting hooks + landing copy in brand voice…', call: 'llm_writer',
    result: '3 hooks + 1 landing page · brand voice match'
  },
  media: {
    name: 'Media Buying Agent', role: 'Campaign build & targeting', persona: 'The Operator', tools: ['ad_platform', 'audience_sync'],
    thinking: 'Builds the campaigns exactly as Content + Strategy specified.',
    action: 'Launches the lead channel with the winning hooks and tight audiences.',
    output: 'Live campaigns with audience sync + budget caps — handed to Analytics.',
    live: 'Building & launching the campaigns…', call: 'google_ads.create_campaign',
    result: 'VALIDATED · awaiting human approval'
  },
  analytics: {
    name: 'Analytics Agent', role: 'Tracking, KPIs & dashboards', persona: 'The Truth-Teller', tools: ['ga4', 'pixel'],
    thinking: 'Makes sure every rupee is measurable before it scales.',
    action: 'Wires GA4 + pixels and stands up a one-screen KPI dashboard.',
    output: 'Tracking live; KPIs = CPL, CTR, demo rate, ROAS — handed to Optimizer.',
    live: 'Wiring tracking + the KPI dashboard…', call: 'ga4.run_report',
    result: 'CPL ₹734 · CTR 3.1% · demo rate 4.2%'
  },
  optimizer: {
    name: 'Optimizer Agent', role: 'Always-on improvement loop', persona: 'The Tinkerer', tools: ['experiment', 'alert'],
    thinking: 'Keeps improving using the KPIs Analytics defined.',
    action: 'Auto-flags underperforming ads and rotates in the next hook variant.',
    output: 'Weekly experiment loop feeds fresh signal back to Research — Hive keeps learning.',
    live: 'Spinning up the experiment loop…', call: 'experiment.rotate',
    result: '2 losers paused · next hook variant queued'
  }
};

function normalizeAgent(a) {
  if (!a || typeof a !== 'object') return null;
  const id = String(a.id || '').toLowerCase();
  const d = AGENT_DEFAULTS[id] || {};
  return {
    id: id || 'agent',
    name: a.name || d.name || 'Agent',
    role: a.role || d.role || 'Agent',
    persona: a.persona || d.persona || '',
    tools: Array.isArray(a.tools) && a.tools.length ? a.tools.slice(0, 4) : d.tools || [],
    thinking: String(a.thinking || d.thinking || '').slice(0, 300),
    action: String(a.action || d.action || '').slice(0, 300),
    output: String(a.output || d.output || '').slice(0, 400),
    live: String(a.live || d.live || ((a.name || 'Agent') + ' working')).slice(0, 120),
    call: String(a.call || d.call || '').slice(0, 120),
    toolArgs: (a.toolArgs && typeof a.toolArgs === 'object') ? a.toolArgs : {},
    result: String(a.result || d.result || '').slice(0, 200),
    exec: (a.exec && typeof a.exec === 'object') ? a.exec : null,
    status: 'done'
  };
}

function safePlan(obj) {
  if (!obj || !Array.isArray(obj.agents)) return null;
  obj.agents = obj.agents.map(normalizeAgent).filter(Boolean).slice(0, 8);
  if (!obj.agents.length) return null;
  if (!obj.campaignPlan || typeof obj.campaignPlan !== 'object') obj.campaignPlan = {};
  if (!Array.isArray(obj.campaignPlan.channels)) obj.campaignPlan.channels = [];
  if (!Array.isArray(obj.campaignPlan.kpis)) obj.campaignPlan.kpis = [];
  if (!Array.isArray(obj.campaignPlan.timeline)) obj.campaignPlan.timeline = [];
  obj.orchestrator = String(obj.orchestrator || '').slice(0, 400) || 'Research sizes the audience, Strategy sets channels + budget, Content + Media ship the launch, Analytics measures, Optimizer closes the loop.';
  obj.summary = String(obj.summary || '').slice(0, 600);
  return obj;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');

  // Replay a past run (share link): GET /api/agentic?run=<id>
  if (req.method === 'GET' && url2.searchParams.get('run')) {
    const v = await kvGet('agentic:run:' + String(url2.searchParams.get('run')).slice(0, 64));
    if (v) {
      try {
        const c = JSON.parse(v);
        if (c && c.plan) { c.plan.replayed = true; return res.json(c.plan); }
      } catch (e) {}
    }
    return res.status(404).json({ error: 'run not found' });
  }

  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/agentic with {goal, niche?, budget?, channels?, stream?} — real tools now execute per agent.' });
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
  if (await isRateLimited(ipOf(req) + ':agentic')) return res.status(429).json({ error: 'rate limited' });
  kv([['LPUSH', 'agentic:runs', JSON.stringify({ at: new Date().toISOString(), goal: m.goal.slice(0, 120) })], ['LTRIM', 'agentic:runs', 0, 99]]);

  const stream = !!(b.stream);
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };
  const finish = function (obj) {
    obj.replayed = false;
    obj.runId = runId(m);
    send({ event: 'plan', data: obj });
    try { kv([['SET', 'agentic:run:' + obj.runId, JSON.stringify({ at: Date.now(), plan: obj })], ['EXPIRE', 'agentic:run:' + obj.runId, 604800]]); } catch (e) {}
    if (stream) res.end();
    else res.json(obj);
  };

  let budgetNum = parseInt(String(m.budget || '').replace(/[^0-9]/g, ''), 10) || 200000;
  if (!budgetNum || budgetNum < 10000) budgetNum = 200000;

  // Research grounds on live SERP so its real tool call is satisfied even without a key.
  let serpQ = serpQuery(m);
  let serpLive = null;
  const pasted = Array.isArray(b.serpResults) ? b.serpResults.filter(function (x) { return x && (x.title || x.snippet); }).slice(0, 8) : null;
  if (pasted && pasted.length) { serpLive = pasted; serpQ = 'pasted results'; }
  else { try { serpLive = await serp(serpQ); } catch (e) {} }
  if (!Array.isArray(serpLive) || !serpLive.length) serpLive = null;

  // Long-running orchestrator call (only when a key is set).
  const fb = fallback(m);
  let plan = fb, mode = 'template';
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (key) {
    const serpBlock = serpLive && serpLive.length ? { query: serpQ, text: formatSerp(serpLive) } : null;
    const domains = serpLive && serpLive.length ? serpLive.map(function (r) { return r.domain; }).filter(Boolean).slice(0, 6).join(', ') : '';
    try {
      send({ event: 'orch', text: 'Orchestrator planning the agent run…' });
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, GROQ_TIMEOUT);
      const r = await fetch(GROQ, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.55, max_tokens: 1700, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys(domains) }, { role: 'user', content: userMessage(m, serpBlock) }] })
      });
      clearTimeout(timer);
      const j = await r.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let out = null;
      try { out = JSON.parse(text); } catch (e) { const mm = text.match(/\{[\s\S]*\}/); if (mm) { try { out = JSON.parse(mm[0]); } catch (e2) {} } }
      const p = safePlan(out);
      if (p) { plan = p; mode = 'ai'; }
    } catch (e) {}
  }

  // ---- Real execution loop: each agent's tool actually runs now ----
  for (const a of plan.agents) {
    const tool = a.call;
    const args = a.toolArgs || {};
    let exec;
    if (tool === 'serp.search' && serpLive && serpLive.length) {
      exec = { tool, args: { q: args.q || serpQ }, ok: true, result: serpLive.slice(0, 6), ms: 0 };
    } else {
      if (tool === 'planner.allocate' && !args.total) { args.total = budgetNum; args.weights = args.weights || [0.4, 0.3, 0.3]; args.channels = args.channels || ['Meta Ads', 'Google Ads', 'LinkedIn']; }
      if (tool === 'calc.roi') { args.revenue = args.revenue || budgetNum * 3; args.spend = args.spend || budgetNum; }
      if (tool === 'calc.cpl') { args.spend = args.spend || budgetNum; args.leads = args.leads || Math.round(budgetNum / 740); args.clicks = args.clicks || Math.round(budgetNum / 30); args.impressions = args.impressions || args.clicks * 35; }
      if (tool === 'market.sizer') { args.searches = args.searches || 25000; args.ctr = args.ctr || 0.04; args.conv = args.conv || 0.03; args.aov = args.aov || 1500; }
      exec = await runTool(tool, args);
    }
    a.exec = exec;
    a.result = exec.ok ? ('REAL · ' + fmtResult(exec)) : (a.result + ' · (' + (exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: a.id, tool: tool, exec: { ok: exec.ok, ms: exec.ms, error: exec.error || null } });
  }

  send({ event: 'serp', used: !!serpLive, count: serpLive ? serpLive.length : 0, query: serpQ });
  finish(Object.assign({ mode: mode, serpUsed: !!serpLive, serpCount: serpLive ? serpLive.length : 0, serpQuery: serpQ, serpBlocked: !serpLive }, plan));
};
