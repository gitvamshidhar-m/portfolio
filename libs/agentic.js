const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_STT = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TTS = 'https://api.groq.com/openai/v1/audio/speech';
const STT_MODEL = process.env.GROQ_STT_MODEL || 'whisper-large-v3-turbo';
const TTS_MODEL = process.env.GROQ_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const TTS_VOICE = process.env.GROQ_TTS_VOICE || 'austin';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const GROQ_TIMEOUT = 15000;
const { serp, serpQuery, formatSerp } = require('./tools/serp');
const { runTool, fmtResult } = require('./tools/exec');
const crypto = require('crypto');

// Regional languages (IN): plan fields are generated in the chosen language.
const LANGS = {
  en: { name: 'English', stt: 'en' },
  hi: { name: 'Hindi', stt: 'hi' },
  te: { name: 'Telugu', stt: 'te' },
  ta: { name: 'Tamil', stt: 'ta' }
};
function langName(lang) { const x = LANGS[String(lang || 'en').slice(0, 2)]; return x ? x.name : 'English'; }

const RL_MAX = 20, RL_WIN_SEC = 60;
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

const REFLECT_START = { at: 0 };
// Telemetry accumulator: every LLM call + tool execution contributes real numbers
// (tokens, ms, estimated USD) so the run can report its actual cost & latency.
const PRICE = { inPerM: 0.59, outPerM: 0.79 }; // Llama-3.3-70B on Groq, approx USD per 1M tokens
let telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
function telAdd(report, usage, ms, rateMult) {
  if (!report) report = {};
  const p = (usage && usage.prompt_tokens) || 0, c = (usage && usage.completion_tokens) || 0;
  report.calls = (report.calls || 0) + 1;
  report.prompt = (report.prompt || 0) + p;
  report.completion = (report.completion || 0) + c;
  report.ms = (report.ms || 0) + (ms || 0);
  report.cost = (report.cost || 0) + ((p * PRICE.inPerM + c * PRICE.outPerM) / 1e6) * (rateMult || 1);
  return report;
}

// Is a reflected output good enough to ship, or should the agent reflect again?
function quality(o, exec) {
  const s = String((o && o.output) || '').trim();
  if (s.length < 24) return false;
  if (!/\d|₹|\$|%|https|example\.com|\.in/.test(s)) return false;
  if (exec && exec.ok && /^[A-Z]{2,10}\s+/.test(s)) return false;
  return true;
}

// Iterative reflection: 1..3 tight LLM passes. Each pass rewrites the handoff grounded
// in the REAL tool return; we keep going only while the output fails the quality gate.
async function reflectAgent(agent, exec, goal, key, telemetry) {
  if (!key || !exec || !exec.ok) return;
  if ((Date.now() - REFLECT_START.at) > 22000) return; // keep well under serverless cap
  const sys = 'You are ' + (agent.name || 'an agent') + ' in an autonomous marketing team. A tool you invoked just returned real output. Write your handoff "output" (1-2 sentences) grounded strictly in that real return: name the actual numbers/domains/results. Sound specific and human, no hype, no emojis. Return ONLY JSON: {"output":"..."}.';
  const base = 'GOAL: ' + String(goal || '').slice(0, 300) + '\nTOOL: ' + exec.tool + '\nREAL RESULT:\n' + fmtResult(exec);
  let passes = 0;
  while (passes < 3 && (Date.now() - REFLECT_START.at) <= 22000) {
    passes++;
    const prev = String(agent.output || '');
    const user = base + (passes > 1 ? '\n\nYour previous handoff was too vague or empty: "' + prev.slice(0, 160) + '". Rewrite it to name concrete numbers/sources from the REAL RESULT above.' : '');
    try {
      const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 8000);
      const t0 = Date.now();
      const r = await fetch(GROQ, {
        method: 'POST', signal: c.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 120, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })
      });
      clearTimeout(t);
      const j = await r.json();
      telAdd(telemetry, (j.usage) || null, Date.now() - t0);
      const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      let o = null; try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
      if (o && o.output) agent.output = String(o.output).slice(0, 400);
      if (quality(o, exec)) break;
    } catch (e) { break; }
  }
  agent.reflection = { passes: passes, iterated: passes > 1 };
}

const AGENTS = ['research', 'strategy', 'content', 'media', 'analytics', 'optimizer'];

function sys(domainList, lang) {
  const langInstruction = (lang && lang !== 'en')
    ? 'Critical: the user requested the plan in ' + lang + '. Write every user-facing field — GOAL echo, orchestrator, each agent\'s thinking/action/output/live/result, campaignPlan channels/budget/kpis/timeline, and summary — in ' + lang + '. Keep tool names, agent IDs and the JSON keys in English. Only the prose values change language.\n'
    : '';
  return 'You are the ORCHESTRATOR of a multi-agent digital-marketing system. Given a marketing GOAL you must plan and "run" a team of autonomous agents. Each agent independently thinks, picks tools, takes an action, and produces an output. Later agents must build on earlier agents\' outputs (handoffs), so the plan reads like a real autonomous workflow, not 6 disconnected blurbs.\n'
    + langInstruction
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
    + '\nRun Hive and return the JSON plan now.'
    + ((m.lang && m.lang !== 'en') ? ' IMPORTANT: write all prose in ' + m.lang + '.' : '');
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

// Merge a model-revised plan back onto the ORIGINAL so an edit/follow-up never
// wipes fields the model omitted (empty channels/budget/KPIs/timeline) or drops
// whole agents/tool proofs. Only values the model actually returned override the
// originals; everything else is carried forward from `base`.
function mergePlan(base, revised) {
  if (!revised || !Array.isArray(revised.agents) || !revised.agents.length) return base;
  const out = JSON.parse(JSON.stringify(base || {}));
  // Overlay the model's agent prose onto the original full agent list so no agent
  // (or its live tool-exec proof) disappears when the model returns fewer entries.
  const baseById = {};
  (base && Array.isArray(base.agents) ? base.agents : []).forEach(function (a) { baseById[(a.id || '').toLowerCase()] = a; });
  const revisedById = {};
  revised.agents.forEach(function (a) { revisedById[(a.id || '').toLowerCase()] = a; });
  out.agents = (base && Array.isArray(base.agents) ? base.agents : []).map(function (a) {
    const r = revisedById[(a.id || '').toLowerCase()];
    if (r) {
      const copy = JSON.parse(JSON.stringify(a));
      ['thinking', 'action', 'output', 'live', 'result', 'name'].forEach(function (k) {
        if (String(r[k] || '').trim() && String(copy[k] || '') !== String(r[k])) copy[k] = String(r[k]).slice(0, k === 'output' ? 400 : k === 'result' ? 200 : 300);
      });
      return copy;
    }
    return a;
  });
  const revisedOnly = revised.agents.filter(function (r) { return !baseById[(r.id || '').toLowerCase()]; }).map(normalizeAgent).filter(Boolean);
  if (revisedOnly.length) out.agents = out.agents.concat(revisedOnly);
  if (!out.agents.length) out.agents = revised.agents;
  const oc = revised.campaignPlan && typeof revised.campaignPlan === 'object' ? revised.campaignPlan : {};
  const bc = out.campaignPlan && typeof out.campaignPlan === 'object' ? out.campaignPlan : {};
  const mergeField = function (k) {
    if (Array.isArray(oc[k]) && oc[k].length) bc[k] = oc[k].slice();
  };
  mergeField('channels');
  mergeField('kpis');
  mergeField('timeline');
  if (oc.budget && typeof oc.budget === 'object' && (oc.budget.total || oc.budget.split)) bc.budget = oc.budget;
  if (typeof oc === 'object' && oc.spendSplit) bc.spendSplit = oc.spendSplit;
  out.campaignPlan = bc;
  ['orchestrator', 'summary', 'goal'].forEach(function (k) {
    if (String(revised[k] || '').trim()) out[k] = String(revised[k]).slice(0, k === 'summary' ? 600 : 400);
  });
  if (String(revised.followAnswer || '').trim()) out.followAnswer = String(revised.followAnswer).slice(0, 800);
  return out;
}

// ---- Voice (multimodal): speech-to-text input + text-to-speech output ----
const GROQ_AUDIO_TIMEOUT = 20000;
function audioB64(body) { return String((body && body.audio) || '').slice(0, 3000000); }

// Speech-to-text: the page records the mic, sends base64 audio, and we transcribe via Groq Whisper.
async function handleStt(req, res, key) {
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const b64 = audioB64(b);
  if (!key) return res.status(400).json({ error: 'GROQ_API_KEY not set' });
  if (!b64) return res.status(400).json({ error: 'audio is required' });
  if (await isRateLimited(ipOf(req) + ':agentic-stt')) return res.status(429).json({ error: 'rate limited' });
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch (e) { return res.status(400).json({ error: 'bad base64' }); }
  if (!buf || buf.length < 200) return res.status(400).json({ error: 'audio too small' });
  try {
    const mime = String(b.mime || 'audio/webm').slice(0, 60);
    const ext = (mime.indexOf('mp4') >= 0 || mime.indexOf('m4a') >= 0) ? 'm4a' : (mime.indexOf('ogg') >= 0 ? 'ogg' : 'webm');
    const fd = new FormData();
    fd.append('model', STT_MODEL);
    fd.append('file', new Blob([buf], { type: mime }), 'hive-voice.' + ext);
    if (b.lang) fd.append('language', String(b.lang).slice(0, 8));
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_AUDIO_TIMEOUT);
    let r;
    try {
      r = await fetch(GROQ_STT, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key }, body: fd });
    } finally { clearTimeout(t); }
    const j = await r.json();
    const text = (j && j.text) ? String(j.text).trim() : '';
    if (!r.ok || !text) return res.status(502).json({ error: (j && j.error && j.error.message) || 'transcription failed' });
    return res.json({ text: text.slice(0, 600) });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || 'transcription failed') });
  }
}

// Text-to-speech: turns the plan summary into an mp3 the page plays back. The
// bundled voice is English-only, so non-English requests are first translated
// (cheap LLM call) so the audio never garbles Devanagari/Telugu/Tamil text.
async function handleTts(req, res, key) {
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  let text = String(b.text || '').slice(0, 1200).trim();
  const lang = langName(b.lang);
  if (!key) return res.status(400).json({ error: 'GROQ_API_KEY not set' });
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (await isRateLimited(ipOf(req) + ':agentic-tts')) return res.status(429).json({ error: 'rate limited' });
  if (lang && lang !== 'English') {
    try {
      const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 8000);
      const tr = await fetch(GROQ, {
        method: 'POST', signal: c.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 400, messages: [{ role: 'system', content: 'Translate the following ' + lang + ' text to natural English for a text-to-speech voiceover. Keep numbers and brand names. Output ONLY the English translation, no quotes, no commentary.' }, { role: 'user', content: text }] })
      });
      clearTimeout(t);
      const tj = await tr.json();
      const en = (tj.choices && tj.choices[0] && tj.choices[0].message && tj.choices[0].message.content) || '';
      if (en.trim()) text = en.trim().slice(0, 1200);
    } catch (e) {}
  }
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_AUDIO_TIMEOUT);
    let r;
    try {
      r = await fetch(GROQ_TTS, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: TTS_MODEL, input: text, voice: String(b.voice || TTS_VOICE).slice(0, 40), response_format: 'mp3' }) });
    } finally { clearTimeout(t); }
    if (!r.ok) {
      const t2 = await r.text().catch(function () { return ''; });
      return res.status(502).json({ error: 'tts failed: ' + t2.slice(0, 120) });
    }
    const ab = await r.arrayBuffer();
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.end(Buffer.from(ab));
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || 'tts failed') });
  }
}

// ---- Follow-up chat: refine/expand an EXISTING run's plan via natural language ----
// POST /api/agentic/follow  {runId, question, lang?}  → {answer, plan}
async function handleFollow(req, res, key) {
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const runId = String(b.runId || '').slice(0, 64);
  const question = String(b.question || '').slice(0, 600).trim();
  if (!key) return res.status(400).json({ error: 'GROQ_API_KEY not set' });
  if (!runId || !question) return res.status(400).json({ error: 'runId and question are required' });
  if (await isRateLimited(ipOf(req) + ':' + runId + ':follow')) return res.status(429).json({ error: 'rate limited' });
  const raw = await kvGet('agentic:run:' + runId);
  if (!raw) return res.status(404).json({ error: 'run not found' });
  let plan = null;
  try { plan = JSON.parse(raw).plan; } catch (e) {}
  if (!plan) return res.status(404).json({ error: 'run not found' });
  const lang = langName(b.lang);
  const langInstr = (lang !== 'English') ? ' Write the reply prose and any updated field values in ' + lang + ' (keys/ids stay English).' : '';
  const sysMsg = 'You are the ORCHESTRATOR of a multi-agent marketing system. The user is following up on an existing campaign plan. Read the plan JSON, answer their question, and REVISE the plan if the question asks for any change (budget, channels, KPI, timeline, summary, or agent outputs). Be faithful to the existing plan: keep all unchanged fields exactly as they are. Return ONLY JSON: {"answer":"<2-4 sentence reply to the user, referencing the plan>","plan":{<the full revised plan JSON — identical structure to the input, only fields that must change changed; if nothing changes, echo the input plan unchanged>}}.' + langInstr;
  const userMsg = 'QUESTION: ' + question + '\n\nCURRENT PLAN (JSON):\n' + JSON.stringify(plan).slice(0, 16000);
  const stream = !!(b.stream);
  const t0 = Date.now();
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_TIMEOUT);
    const r = await fetch(GROQ, {
      method: 'POST', signal: c.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 2200, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: userMsg }] })
    });
    clearTimeout(t);
    const j = await r.json();
    const tel = { calls: 1, prompt: (j.usage && j.usage.prompt_tokens) || 0, completion: (j.usage && j.usage.completion_tokens) || 0, ms: Date.now() - t0 };
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null, out = null;
    try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (o) {
      out = safePlan(o.plan) ? mergePlan(plan, o.plan) : plan;
      if (o.answer) out.followAnswer = String(o.answer).slice(0, 800);
      // Persist the revised plan so share links + chat thread keep using it.
      try { await kv([['SET', 'agentic:run:' + runId, JSON.stringify({ at: Date.now(), plan: out })], ['EXPIRE', 'agentic:run:' + runId, 604800]]); } catch (e) {}
    }
    if (!out) { send({ event: 'error', error: 'model returned no plan' }); return stream ? res.end() : res.status(502).json({ error: 'model returned no plan' }); }
    const answer = (o && o.answer) ? String(o.answer).slice(0, 800) : '';
    if (stream) {
      send({ event: 'answer', text: answer, telemetry: tel });
      send({ event: 'plan', data: out });
      res.end();
    } else {
      return res.json({ answer: answer, plan: out, runId: runId, telemetry: tel });
    }
  } catch (e) {
    if (stream) { send({ event: 'error', error: String((e && e.message) || 'follow-up failed') }); res.end(); }
    else return res.status(502).json({ error: String((e && e.message) || 'follow-up failed') });
  }
}

// ---- Editable sections: regenerate just ONE part of an existing plan ----
// POST /api/agentic/section  {runId, field, value} → {plan, field}
// field ∈ budget | channels | kpis | timeline | summary
async function handleSection(req, res, key) {
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const runId = String(b.runId || '').slice(0, 64);
  const field = String(b.field || '');
  const value = String(b.value || '').slice(0, 600).trim();
  if (!key) return res.status(400).json({ error: 'GROQ_API_KEY not set' });
  if (!runId || !field) return res.status(400).json({ error: 'runId and field are required' });
  if (!/^(budget|channels|kpis|timeline|summary)$/.test(field)) return res.status(400).json({ error: 'invalid field' });
  if (!value) return res.status(400).json({ error: 'value is required' });
  if (await isRateLimited(ipOf(req) + ':' + runId + ':section')) return res.status(429).json({ error: 'rate limited' });
  const raw = await kvGet('agentic:run:' + runId);
  if (!raw) return res.status(404).json({ error: 'run not found' });
  let plan = null;
  try { plan = JSON.parse(raw).plan; } catch (e) {}
  if (!plan) return res.status(404).json({ error: 'run not found' });
  const lang = langName(b.lang);
  const sysMsg = 'You are the ORCHESTRATOR editing one section of an existing campaign plan. The user changed the "' + field + '" section to: "' + value + '". Revise the plan and RETURN ONLY JSON: {"plan":{<full revised plan — same JSON structure; update the ' + field + ' section per the new value and, where it materially affects them, the agents outputs, summary and timeline>}}. Be faithful: keep every unchanged field byte-identical to the input. Write user-facing prose in ' + lang + ' unless English is requested.';
  const t0 = Date.now();
  const stream = !!(b.stream);
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_TIMEOUT);
    const r = await fetch(GROQ, {
      method: 'POST', signal: c.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 2200, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: JSON.stringify(plan).slice(0, 16000) }] })
    });
    clearTimeout(t);
    const j = await r.json();
    const tel = { calls: 1, prompt: (j.usage && j.usage.prompt_tokens) || 0, completion: (j.usage && j.usage.completion_tokens) || 0, ms: Date.now() - t0 };
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null, out = null;
    try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (o) { out = safePlan(o.plan) ? mergePlan(plan, o.plan) : plan; }
    if (!out) return res.status(502).json({ error: 'model returned no plan' });
    // The user's typed value is authoritative for the edited section — always
    // apply it, even if the model echoed the plan unchanged.
    const before = {
      channels: Array.isArray(plan.campaignPlan.channels) ? plan.campaignPlan.channels.slice() : [],
      kpis: Array.isArray(plan.campaignPlan.kpis) ? plan.campaignPlan.kpis.slice() : [],
      timeline: Array.isArray(plan.campaignPlan.timeline) ? plan.campaignPlan.timeline.slice() : [],
      budget: plan.campaignPlan.budget ? plan.campaignPlan.budget.total : '',
      summary: plan.summary || ''
    };
    const cp = out.campaignPlan && typeof out.campaignPlan === 'object' ? out.campaignPlan : {};
    if (field === 'channels') cp.channels = value.split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8);
    if (field === 'kpis') cp.kpis = value.split(/\n+|;/).map(function (s) { return s.trim().replace(/^[-•*]\s*/, ''); }).filter(Boolean).slice(0, 8);
    if (field === 'timeline') cp.timeline = value.split(/\n+|;/).map(function (s) { return s.trim().replace(/^[-•*]\s*/, ''); }).filter(Boolean).slice(0, 10);
    if (field === 'budget') cp.budget = splitBudget(value, (cp.budget && cp.budget.split) || '');
    if (field === 'summary') out.summary = value.slice(0, 600);
    out.campaignPlan = cp;
    const after = {
      channels: Array.isArray(cp.channels) ? cp.channels.slice() : [],
      kpis: Array.isArray(cp.kpis) ? cp.kpis.slice() : [],
      timeline: Array.isArray(cp.timeline) ? cp.timeline.slice() : [],
      budget: cp.budget ? cp.budget.total : '',
      summary: out.summary || ''
    };
    const diff = fieldLabels().filter(function (f) { return JSON.stringify(before[f]) !== JSON.stringify(after[f]); });
    try { await kv([['SET', 'agentic:run:' + runId, JSON.stringify({ at: Date.now(), plan: out })], ['EXPIRE', 'agentic:run:' + runId, 604800]]); } catch (e) {}
    if (stream) {
      send({ event: 'diff', fields: diff, telemetry: tel });
      send({ event: 'plan', data: out });
      res.end();
      return;
    }
    return res.json({ plan: out, field: field, runId: runId, diff: diff, telemetry: tel });
  } catch (e) {
    if (stream) { send({ event: 'error', error: String((e && e.message) || 'edit failed') }); res.end(); return; }
    return res.status(502).json({ error: String((e && e.message) || 'edit failed') });
  }
}

// "₹3,00,000" or "₹3L — 60/40" or "300000/200000" → { total, split }
function splitBudget(value, fallbackSplit) {
  const v = String(value || '').trim();
  const dashMatch = v.match(/^(.*?)(?:\s*[-–—]\s*|\s+split[:]\s*)(.*)$/);
  if (dashMatch) {
    const total = dashMatch[1].trim().slice(0, 80);
    const split = dashMatch[2].replace(/^[\s:]+/, '').slice(0, 80);
    return { total: total, split: split };
  }
  const slash = v.split('/');
  if (slash.length >= 2 && slash[0].trim() && slash[1].trim()) return { total: v.slice(0, 80), split: v.slice(0, 80) };
  return { total: v.slice(0, 80), split: fallbackSplit || '' };
}
function fieldLabels() { return ['channels', 'kpis', 'timeline', 'budget', 'summary']; }

// ---- Regenerate ONE agent: redo a single agent's thinking/action/output given
// the rest of the plan's current state (and its real tool result, if executed).
// POST /api/agentic/regenerate {runId, agentId} → {plan, agentId}
async function handleRegenerate(req, res, key) {
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const runId = String(b.runId || '').slice(0, 64);
  const agentId = String(b.agentId || '').toLowerCase().slice(0, 40);
  if (!key) return res.status(400).json({ error: 'GROQ_API_KEY not set' });
  if (!runId || !agentId) return res.status(400).json({ error: 'runId and agentId are required' });
  if (await isRateLimited(ipOf(req) + ':' + runId + ':regenerate')) return res.status(429).json({ error: 'rate limited' });
  const raw = await kvGet('agentic:run:' + runId);
  if (!raw) return res.status(404).json({ error: 'run not found' });
  let plan = null;
  try { plan = JSON.parse(raw).plan; } catch (e) {}
  if (!plan) return res.status(404).json({ error: 'run not found' });
  const idx = (Array.isArray(plan.agents) ? plan.agents : []).findIndex(function (a) { return (a.id || '').toLowerCase() === agentId; });
  if (idx < 0) return res.status(404).json({ error: 'agent not found in plan' });
  const agent = plan.agents[idx];
  const t0 = Date.now();
  try {
    const sysMsg = 'You are "' + (agent.name || agentId) + '" (the ' + (agent.role || 'agent') + ') in an autonomous marketing team. Regenerate ONLY your own thinking/action/output for the campaign, building on the CURRENT state of the other agents and the campaign plan. Stay faithful to your tool call; do not change your id, tools, persona, or other agents. Return ONLY JSON: {"thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences grounded in the plan and, if given, your REAL tool result>","live":"<4-8 words present continuous>"}.';
    const userMsg = 'GOAL: ' + (plan.goal || '') + '\nYOU: ' + JSON.stringify({ id: agent.id, tools: agent.tools, call: agent.call, toolArgs: agent.toolArgs, exec: agent.exec }, null, 1) + '\nOTHER AGENTS + PLAN (JSON):\n' + JSON.stringify({ agents: (plan.agents || []).filter(function (a) { return (a.id || '').toLowerCase() !== agentId; }), campaignPlan: plan.campaignPlan, orchestrator: plan.orchestrator, summary: plan.summary }).slice(0, 16000);
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_TIMEOUT);
    const r = await fetch(GROQ, {
      method: 'POST', signal: c.signal,
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 400, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sysMsg }, { role: 'user', content: userMsg }] })
    });
    clearTimeout(t);
    const j = await r.json();
    const tel = { calls: 1, prompt: (j.usage && j.usage.prompt_tokens) || 0, completion: (j.usage && j.usage.completion_tokens) || 0, ms: Date.now() - t0 };
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null;
    try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (!o || (!o.output && !o.thinking)) return res.status(502).json({ error: 'model returned nothing usable' });
    const out = JSON.parse(JSON.stringify(plan));
    const upd = out.agents[idx];
    if (o.thinking) upd.thinking = String(o.thinking).slice(0, 300);
    if (o.action) upd.action = String(o.action).slice(0, 300);
    if (o.output) upd.output = String(o.output).slice(0, 400);
    if (o.live) upd.live = String(o.live).slice(0, 120);
    out.agents[idx] = upd;
    try { await kv([['SET', 'agentic:run:' + runId, JSON.stringify({ at: Date.now(), plan: out })], ['EXPIRE', 'agentic:run:' + runId, 604800]]); } catch (e) {}
    return res.json({ plan: out, agentId: agentId, telemetry: tel });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || 'regenerate failed') });
  }
}

function pdfSafe(s) {
  return String(s || '')
    .replace(/\u20B9/g, 'Rs.')                 // ₹ → Rs. (Helvetica/WinAnsi can't render it)
    .replace(/[^\x00-\xFF]/g, '')              // drop other non-Latin glyphs Helvetica lacks
    .trim();
}

// ---- Plan → PDF export ----
// POST /api/agentic/pdf {runId} → application/pdf
async function handlePdf(req, res) {
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const runId = String(b.runId || '').slice(0, 64);
  if (!runId) return res.status(400).json({ error: 'runId is required' });
  const raw = await kvGet('agentic:run:' + runId);
  if (!raw) return res.status(404).json({ error: 'run not found' });
  let plan = null;
  try { plan = JSON.parse(raw).plan; } catch (e) {}
  if (!plan) return res.status(404).json({ error: 'run not found' });
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
  const chunks = [];
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="hive-plan-' + runId + '.pdf"');
  doc.on('data', function (c) { chunks.push(c); });
  doc.on('end', function () { res.end(Buffer.concat(chunks)); });
  try {
    const cp = plan.campaignPlan || {};
    doc.fontSize(20).fillColor('#111').text('Hive Campaign Plan', { align: 'center' });
    doc.moveDown(0.6);
    doc.fontSize(12).fillColor('#555').text('Goal: ' + pdfSafe(plan.goal || ''), { align: 'center' });
    doc.moveDown(1.2);
    if (plan.orchestrator) { doc.fontSize(11).fillColor('#222').text(pdfSafe(plan.orchestrator)); doc.moveDown(0.8); }
    doc.fontSize(13).fillColor('#444').text('The Agents'); doc.moveDown(0.3);
    (plan.agents || []).forEach(function (a) {
      doc.fontSize(11).fillColor('#111').text('• ' + pdfSafe(a.name || 'Agent') + (a.role ? ' (' + pdfSafe(a.role) + ')' : ''));
      doc.fontSize(10).fillColor('#444').text('  Thinking: ' + pdfSafe(a.thinking || ''));
      doc.fontSize(10).fillColor('#444').text('  Action:   ' + pdfSafe(a.action || ''));
      doc.fontSize(10).fillColor('#444').text('  Output:   ' + pdfSafe(a.output || ''));
      doc.fontSize(10).fillColor('#666').text('  Tool:     ' + pdfSafe(a.call || '') + (a.result ? ' → ' + pdfSafe(a.result) : ''));
      doc.moveDown(0.4);
    });
    doc.fontSize(13).fillColor('#444').text('Campaign Plan'); doc.moveDown(0.3);
    if (cp.channels) doc.fontSize(10).fillColor('#111').text('Channels: ' + pdfSafe(cp.channels.join(', ')));
    if (cp.budget) doc.fontSize(10).fillColor('#111').text('Budget: ' + pdfSafe(cp.budget.total || '') + (cp.budget.split ? ' — ' + pdfSafe(cp.budget.split) : ''));
    if (cp.kpis && cp.kpis.length) doc.fontSize(10).fillColor('#111').text('KPIs: ' + pdfSafe(cp.kpis.join(' · ')));
    if (cp.timeline && cp.timeline.length) { doc.fontSize(10).fillColor('#111').text('Timeline:'); cp.timeline.forEach(function (t) { doc.fontSize(10).fillColor('#111').text('      • ' + pdfSafe(t)); }); }
    if (plan.summary) { doc.moveDown(0.6); doc.fontSize(10.5).fillColor('#333').text('Summary: ' + pdfSafe(plan.summary)); }
    if (plan.telemetry) { doc.moveDown(0.8); doc.fontSize(9).fillColor('#999').text('Telemetry: ' + pdfSafe(JSON.stringify(plan.telemetry))); }
    doc.end();
  } catch (e) {
    if (process.env.AGENTIC_PDF_DEBUG) console.error('hive-pdf:', e && (e.stack || e.message));
    doc.end();
    try { res.end(Buffer.from('')) } catch (e2) {}
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');

  // Sub-routes: /api/agentic/stt and /api/agentic/tts (voice in/out).
  // Vercel filesystem functions only match single-segment paths, so vercel.json
  // rewrites collapse /api/agentic/{stt,tts} into /api/agentic?sub=...
  const sub = url2.searchParams.get('sub');
  if (sub === 'stt' || (sub === null && url2.pathname.split('/').filter(Boolean).pop() === 'stt')) {
    return handleStt(req, res, String(process.env.GROQ_API_KEY || '').trim());
  }
  if (sub === 'tts' || (sub === null && url2.pathname.split('/').filter(Boolean).pop() === 'tts')) {
    return handleTts(req, res, String(process.env.GROQ_API_KEY || '').trim());
  }
  if (sub === 'follow' || (sub === null && url2.pathname.split('/').filter(Boolean).pop() === 'follow')) {
    return handleFollow(req, res, String(process.env.GROQ_API_KEY || '').trim());
  }
  if (sub === 'section' || (sub === null && url2.pathname.split('/').filter(Boolean).pop() === 'section')) {
    return handleSection(req, res, String(process.env.GROQ_API_KEY || '').trim());
  }
  if (sub === 'pdf' || (sub === null && url2.pathname.split('/').filter(Boolean).pop() === 'pdf')) {
    return handlePdf(req, res);
  }
  if (sub === 'regenerate' || (sub === null && url2.pathname.split('/').filter(Boolean).pop() === 'regenerate')) {
    return handleRegenerate(req, res, String(process.env.GROQ_API_KEY || '').trim());
  }

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
    channels: String(b.channels || '').slice(0, 200).trim(),
    lang: langName(b.lang)
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

  // Long-running orchestrator call (only when a key is set). Streamed so the plan appears to compose live.
  telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
  const fb = fallback(m);
  let plan = fb, mode = 'template', cached = false, cacheMs = 0;
  const key = (process.env.GROQ_API_KEY || '').trim();
  const compKey = 'agentic:comp:' + runId(m) + ':' + String(m.niche || '').slice(0, 20);
  if (key && b.cache !== false) {
    // Cache hit: reuse the composed plan, skip the LLM call (tools still re-execute live below).
    const c0 = Date.now();
    const v = await kvGet(compKey);
    if (v) {
      try {
        const p0 = safePlan(JSON.parse(v));
        if (p0) { plan = p0; mode = 'ai'; cached = true; cacheMs = Date.now() - c0; send({ event: 'cache', hit: true, ms: cacheMs }); }
      } catch (e) {}
    }
  }
  if (key && !cached) {
    const serpBlock = serpLive && serpLive.length ? { query: serpQ, text: formatSerp(serpLive) } : null;
    const domains = serpLive && serpLive.length ? serpLive.map(function (r) { return r.domain; }).filter(Boolean).slice(0, 6).join(', ') : '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, GROQ_TIMEOUT);
      const r = await fetch(GROQ, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.55, max_tokens: 1700, stream: true, stream_options: { include_usage: true }, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys(domains, m.lang) }, { role: 'user', content: userMessage(m, serpBlock) }] })
      });
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = '', sse = '', lastEmit = 0, orchMs = Date.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sse += dec.decode(value, { stream: true });
        let lineEnd;
        while ((lineEnd = sse.indexOf('\n')) >= 0) {
          const line = sse.slice(0, lineEnd); sse = sse.slice(lineEnd + 1);
          if (line.slice(0, 6) !== 'data: ') continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;
          try {
            const j = JSON.parse(payload);
            const d = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
            if (d) {
              acc += d;
              // Word-level streaming: emit small slices so the UI types out the composition.
              if (acc.length - lastEmit >= 12) { send({ event: 'orch', text: acc }); lastEmit = acc.length; }
            }
            if (j.usage) telAdd(telemetry, j.usage, Date.now() - orchMs);
          } catch (e2) {}
        }
      }
      clearTimeout(timer);
      if (acc.length) send({ event: 'orch', text: acc });
      let out = null;
      try { out = JSON.parse(acc); } catch (e) { const mm = acc.match(/\{[\s\S]*\}/); if (mm) { try { out = JSON.parse(mm[0]); } catch (e2) {} } }
      const p = safePlan(out);
      if (p) {
        plan = p; mode = 'ai';
        // Cache the composed plan (tools still re-execute live on every run).
        try { await kv([['SET', compKey, JSON.stringify(plan)], ['EXPIRE', compKey, 1800]]); } catch (e) {}
      }
    } catch (e) {}
  }

  // ---- Real execution loop: each agent's tool actually runs now ----
  // DAG schedule: 'research' must land first (its SERP enriches everyone's context),
  // the remaining agents' tools are independent and run in PARALLEL.
  REFLECT_START.at = Date.now();
  let toolsTel = { calls: 0, ms: 0 };
  const runOne = async (a) => {
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
      const t0 = Date.now();
      exec = await runTool(tool, args);
      toolsTel.calls++; toolsTel.ms += exec.ms; 
      const u = exec.tokens && (exec.tokens.prompt_tokens || exec.tokens.completion_tokens) ? { prompt_tokens: exec.tokens.prompt_tokens || 0, completion_tokens: exec.tokens.completion_tokens || 0 } : null;
      if (u) telAdd(telemetry, u, exec.ms);
      exec.ms = Date.now() - t0;
    }
    return { a, exec };
  };

  // Serialize 'research' first so its live SERP grounding is visible before the burst.
  const research = plan.agents.find((x) => x.id === 'research');
  let first = null;
  const rest = plan.agents.filter((x) => x.id !== 'research');
  if (research) {
    first = await runOne(research);
    first.a.exec = first.exec;
    first.a.realText = first.exec.ok ? fmtResult(first.exec) : '';
    first.a.result = first.exec.ok ? first.a.realText : (first.a.result + ' · (' + (first.exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: first.a.id, tool: first.exec.tool, exec: { ok: first.exec.ok, ms: first.exec.ms, error: first.exec.error || null } });
    await reflectAgent(first.a, first.exec, m.goal, key, telemetry);
    if (first.a.exec && first.a.exec.ok) send({ event: 'reflect', id: first.a.id, output: first.a.output, passes: first.a.reflection ? first.a.reflection.passes : 1 });
  }

  const results = await Promise.all(rest.map(runOne));
  for (const { a, exec } of results) {
    a.exec = exec;
    a.realText = exec.ok ? fmtResult(exec) : '';
    a.result = exec.ok ? a.realText : (a.result + ' · (' + (exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: a.id, tool: exec.tool, exec: { ok: exec.ok, ms: exec.ms, error: exec.error || null } });
    await reflectAgent(a, exec, m.goal, key, telemetry);
    if (a.exec && a.exec.ok) send({ event: 'reflect', id: a.id, output: a.output, passes: a.reflection ? a.reflection.passes : 1 });
  }
  telemetry.tools = toolsTel;

  send({ event: 'serp', used: !!serpLive, count: serpLive ? serpLive.length : 0, query: serpQ });
  send({ event: 'metrics', telemetry: telemetry, cached: cached, cacheMs: cacheMs });
  const payloadP = Object.assign({ mode: mode, telemetry: telemetry, cached: cached, cacheMs: cacheMs, serpUsed: !!serpLive, serpCount: serpLive ? serpLive.length : 0, serpQuery: serpQ, serpBlocked: !serpLive }, plan);
  if (b.compare) payloadP.fallback = fb; // LLM plan vs rule-based baseline, side by side
  finish(payloadP);
};
