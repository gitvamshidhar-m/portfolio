// Grapevine — an autonomous reputation & social-listening team.
// Given a brand, Grapevine's agents monitor live SERP for mentions, classify
// sentiment + urgency, score the crisis level, draft on-brand replies, and build
// a human escalation queue. Each agent's tool really executes (live search,
// lexicon sentiment, arithmetic crisis score) and the page shows the real values.
//
// POST /api/grapevine  {brand, platform?, stream?} → NDJSON stream or JSON
//   events: orch | tool | reflect | serp | metrics | plan
// GET  /api/grapevine?run=<id> → replay a stored briefing
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const GROQ_TIMEOUT = 15000;
const { serp, formatSerp } = require('./tools/serp');
const { runTool, fmtResult } = require('./tools/exec');
const crypto = require('crypto');

const RL_MAX = 20, RL_WIN_SEC = 60;
const _mem = { hits: {}, last: 0 };
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
async function isRateLimited(key) {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify([['INCR', 'rl:grapevine:' + key], ['EXPIRE', 'rl:grapevine:' + key, RL_WIN_SEC]])
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
    const r = await fetch(String(KV_URL).replace(/\/$/, '') + '/get/' + encodeURIComponent(key), { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN } });
    const j = await r.json();
    return (j && j.result != null) ? j.result : null;
  } catch (e) { return null; }
}
function runId(brand) { return crypto.createHash('sha1').update('grapevine|' + String(brand || '')).digest('hex').slice(0, 12); }
function brandKey(brand) { return crypto.createHash('sha1').update('grapevine:brand|' + String(brand || '')).digest('hex').slice(0, 16); }
// Read-modify-write a capped per-brand series (history points or run list) in KV, with TTL.
async function trackSeries(kind, key, item, cap, ttl) {
  if (!KV_URL || !KV_TOKEN) return [item];
  let arr = [];
  const raw = await kvGet('grapevine:' + kind + ':' + key);
  if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch (e) {} }
  arr.push(item);
  if (arr.length > cap) arr = arr.slice(-cap);
  try { kv([['SET', 'grapevine:' + kind + ':' + key, JSON.stringify(arr)], ['EXPIRE', 'grapevine:' + kind + ':' + key, ttl]]); } catch (e) {}
  return arr;
}

const PRICE = { inPerM: 0.59, outPerM: 0.79 };
let telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
function telAdd(report, usage, ms) {
  if (!report) return;
  const p = (usage && usage.prompt_tokens) || 0, c = (usage && usage.completion_tokens) || 0;
  report.calls = (report.calls || 0) + 1;
  report.prompt = (report.prompt || 0) + p;
  report.completion = (report.completion || 0) + c;
  report.ms = (report.ms || 0) + (ms || 0);
  report.cost = (report.cost || 0) + ((p * PRICE.inPerM + c * PRICE.outPerM) / 1e6);
  return report;
}

// The Grapevine team: monitor → classify → crisis → respond → escalate → concierge → prophet.
const AGENTS = ['monitor', 'classify', 'crisis', 'respond', 'escalate', 'concierge', 'prophet'];
const PERSONAS = {
  monitor: { name: 'Monitor Agent', persona: 'The Eavesdropper', role: 'Scans live search + social for brand mentions' },
  classify: { name: 'Classify Agent', persona: 'The Judge', role: 'Sentiment, urgency & topic per mention' },
  crisis: { name: 'Crisis Agent', persona: 'The Firefighter', role: 'Detects a storm early, scores the risk' },
  respond: { name: 'Respond Agent', persona: 'The Voice', role: 'Drafts warm, on-brand public replies' },
  escalate: { name: 'Escalate Agent', persona: 'The Captain', role: 'Decides what a human must see first' },
  concierge: { name: 'Concierge Agent', persona: 'The De-escalator', role: 'Drafts private rescue messages + response SLAs for heavy escalations' },
  prophet: { name: 'Prophet Agent', persona: 'The Forecaster', role: 'Projects the crisis trajectory from real watch history' }
};

function sysPrompt(brand, platforms, serpText, mem) {
  return 'You are the ORCHESTRATOR of Grapevine, an autonomous reputation & social-listening team. Given a BRAND you must plan and "run" a team of agents that monitor mentions, classify sentiment, detect crises, draft replies, decide what to escalate, move the heaviest escalations to DM, and forecast the crisis trajectory. Later agents build on earlier agents\' outputs.\n'
    + 'LIVE SEARCH CONTEXT (real mentions for "' + brand + '"):\n' + (serpText || 'No live results — the Monitor Agent will still run a real scan.') + '\n\n'
    + 'MEMORY — PRIOR WATCHES FOR THE SAME BRAND:\n' + (mem || 'No prior history for this brand — first watch.') + '\n\n'
    + 'Use the MEMORY block to sound like a continued conversation: acknowledge what changed since last watch (rising/falling crisis score, new negative spike, resolved topic) when the data supports it.\n\n'
    + 'Return ONLY valid minified JSON (no markdown) with exactly this shape:\n'
    + '{\n'
    + '  "brand":"<echo the brand>",\n'
    + '  "orchestrator":"<one line: how the team splits the watch>",\n'
    + '  "agents":[\n'
    + '    {"id":"monitor","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: what mentions it found, grounded in the LIVE SEARCH CONTEXT — name real platforms/domains>","live":"<4-8 words present continuous>","call":"grapevine.scan","toolArgs":{"q":"<the exact brand or query>"},"result":"<predicted one-line outcome>"},\n'
    + '    {"id":"classify","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: sentiment split it expects>","live":"<4-8 words>","call":"grapevine.sentiment","toolArgs":{"mentions":[{"text":"<sample mention text>","platform":"<platform>"}]},"result":"<predicted tally>"},\n'
    + '    {"id":"crisis","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: how risky the situation looks>","live":"<4-8 words>","call":"grapevine.crisis","toolArgs":{},"result":"<predicted score/level>"},\n'
    + '    {"id":"respond","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: how it will answer the loudest mentions>","live":"<4-8 words>","call":"grapevine.respond","toolArgs":{"text":"<a sample mention>","sentiment":"negative"},"result":"<predicted reply>"},\n'
    + '    {"id":"escalate","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: what needs a human first>","live":"<4-8 words>","call":"grapevine.escalate","toolArgs":{},"result":"<predicted queue>"},\n'
    + '    {"id":"concierge","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: which escalations it will move to a private channel and how fast>","live":"<4-8 words>","call":"grapevine.rescue","toolArgs":{"text":"<the loudest negative mention>"},"result":"<predicted DM rescue + SLA>"},\n'
    + '    {"id":"prophet","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: where the crisis score is heading and the closest past pattern>","live":"<4-8 words>","call":"grapevine.predict","toolArgs":{},"result":"<predicted trajectory + confidence>"}\n'
    + '  ],\n'
    + '  "briefing":"<2-3 sentence client-ready wrap-up: overall sentiment, top platform, crisis level, recommended next step>",\n'
    + '  "nextSteps":["<step 1>","<step 2>","<step 3>"]\n'
    + '}\n'
    + 'Rules: be concrete and specific to the BRAND. Ground the Monitor\'s output in the LIVE SEARCH CONTEXT (name real platforms/domains you see there). Every agent MUST include "live" (4-8 words, present continuous) and a "call" with matching "toolArgs". The "result" field is a PREDICTION only — the server executes the real tool and replaces it. Never invent a separate JSON block. Output MUST be parseable JSON.';
}

function fallback(brand, platforms) {
  const b = String(brand || 'the brand').trim();
  const core = b.charAt(0).toUpperCase() + b.slice(1);
  const plats = platforms && platforms.length ? platforms.join(', ') : 'X, Reddit, Trustpilot, Web';
  const ag = (id, thinking, action, output, live, call, toolArgs, result) => ({ id: id, name: PERSONAS[id].name, persona: PERSONAS[id].persona, role: PERSONAS[id].role, tools: [call], thinking: thinking, action: action, output: output, live: live, call: call, toolArgs: toolArgs, result: result, status: 'done' });
  return {
    brand: b,
    orchestrator: 'Monitor sweeps live search + social for "' + core + '", Classify tags every mention, Crisis scores the risk, Respond drafts replies, Escalate builds the human queue, Concierge moves the heavy escalations to DM, Prophet forecasts the trajectory.',
    agents: [
      ag('monitor', 'Sweeps live search and social for every mention of "' + core + '".', 'Queries SERP for brand + review/complaint variants across ' + plats + '.', 'Mentions surfaced across ' + plats + ' — handed to Classify.', 'Scanning live mentions…', 'grapevine.scan', { q: b }, 'live mentions across platforms'),
      ag('classify', 'Tags each mention by sentiment, urgency and platform.', 'Runs the lexicon classifier over every scanned mention.', 'Sentiment split + urgent items tallied — handed to Crisis.', 'Tagging sentiment + urgency…', 'grapevine.sentiment', { mentions: [{ text: 'sample mention', platform: 'web' }] }, 'positive/negative/neutral split'),
      ag('crisis', 'Watches for a negative spike before it compounds.', 'Scores negative share, volume and severity into a 0-100 risk.', 'Risk level computed from the tally — handed to Respond.', 'Scoring the crisis level…', 'grapevine.crisis', {}, 'risk score + level'),
      ag('respond', 'Answers the loudest mentions in the brand voice.', 'Drafts a warm public reply for the top positive + negative mentions.', 'Drafted replies queued for the top mentions — handed to Escalate.', 'Drafting on-brand replies…', 'grapevine.respond', { text: 'example mention', sentiment: 'negative' }, 'drafted replies'),
      ag('escalate', 'Decides what only a human should touch.', 'Ranks negatives into a P0/P1/P2 action queue by urgency.', 'Escalation queue built for the team — handed to Concierge.', 'Building the human queue…', 'grapevine.escalate', {}, 'P0/P1/P2 escalation queue'),
      ag('concierge', 'Moves the heaviest escalations off the public thread.', 'Drafts a private DM rescue for each P0/P1 with an SLA deadline.', 'Private rescue messages drafted with SLAs — Grapevine stands by.', 'Drafting DM rescues…', 'grapevine.rescue', { text: 'the loudest negative mention', sla: '15 min' }, 'DM rescue + SLA'),
      ag('prophet', 'Projects where this situation is heading.', 'Runs a regression over the real watch history to forecast the crisis score.', 'Forecast issued with confidence + closest past pattern.', 'Forecasting the trajectory…', 'grapevine.predict', {}, 'crisis trajectory + confidence')
    ],
    briefing: 'Grapevine is now watching "' + core + '". It scanned mentions across ' + plats + ', classified sentiment, scored the crisis level, drafted replies, built a human escalation queue, moved the heaviest escalations to DM with SLAs, and forecast where the crisis is heading — so a brand-team can react in minutes, not days.',
    nextSteps: ['Approve the drafted replies for the top mentions', 'Shift the P0/P1 escalations to DM within their SLA windows', 'Watch the Prophet forecast across the next few watches']
  };
}

const AGENT_DEFAULTS = {};
// Guarantee every team member runs even if the LLM omits one: append a stub that the
// real execution loop still resolves against the actual tool call (call is replaced below).
function ensureAgents(plan) {
  if (!plan || !Array.isArray(plan.agents)) return plan;
  const present = plan.agents.map((a) => String((a && a.id) || '').toLowerCase());
  AGENTS.forEach(function (id) {
    if (present.indexOf(id) < 0) {
      const role = PERSONAS[id];
      const CALL = { monitor: 'grapevine.scan', classify: 'grapevine.sentiment', crisis: 'grapevine.crisis', respond: 'grapevine.respond', escalate: 'grapevine.escalate', concierge: 'grapevine.rescue', prophet: 'grapevine.predict' };
      plan.agents.push({ id: id, name: role.name, persona: role.persona, role: role.role, thinking: 'Coordinating with the team.', action: 'Runs the ' + id + ' tool on real data.', output: id + ' pass complete.', live: id + ' working…', call: CALL[id] || '', toolArgs: {}, result: '' });
    }
  });
  return plan;
}
function normalizeAgent(a) {
  if (!a || typeof a !== 'object') return null;
  const id = String(a.id || '').toLowerCase();
  const d = AGENT_DEFAULTS[id] || {};
  return {
    id: id || 'agent',
    name: a.name || PERSONAS[id].name || d.name || 'Agent',
    persona: a.persona || PERSONAS[id].persona || d.persona || '',
    role: a.role || PERSONAS[id].role || d.role || 'Agent',
    tools: Array.isArray(a.tools) && a.tools.length ? a.tools.slice(0, 4) : [a.call || ''],
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

function safeBriefing(obj) {
  if (!obj || !Array.isArray(obj.agents)) return null;
  obj.agents = obj.agents.map(normalizeAgent).filter(Boolean).slice(0, 8);
  if (!obj.agents.length) return null;
  obj.brand = String(obj.brand || '').slice(0, 120);
  obj.orchestrator = String(obj.orchestrator || '').slice(0, 400);
  obj.briefing = String(obj.briefing || '').slice(0, 800);
  if (!Array.isArray(obj.nextSteps)) obj.nextSteps = [];
  obj.nextSteps = obj.nextSteps.map(function (s) { return String(s).slice(0, 200); }).filter(Boolean).slice(0, 6);
  return obj;
}

// Lightweight reflection: one LLM pass grounding each agent's output in its real tool result.
async function reflectAgent(agent, exec, brand, key) {
  if (!key || !exec || !exec.ok) return;
  const sys = 'You are ' + (agent.name || 'an agent') + ' in Grapevine, an autonomous reputation team. Your tool just returned REAL output. Rewrite your handoff "output" (1-2 sentences) grounded strictly in that real return — name the actual numbers/platforms/sentiment. No hype, no emojis. Return ONLY JSON: {"output":"..."}.';
  const user = 'BRAND: ' + String(brand || '').slice(0, 300) + '\nTOOL: ' + exec.tool + '\nREAL RESULT:\n' + fmtResult(exec);
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 8000);
    const t0 = Date.now();
    const r = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 120, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    clearTimeout(t);
    const j = await r.json();
    telAdd(telemetry, (j.usage) || null, Date.now() - t0);
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null; try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (o && o.output) agent.output = String(o.output).slice(0, 400);
    agent.reflection = { passes: 1 };
  } catch (e) {}
}

// ---- AI upgrades: memory (RAG over history), topic tagging, reply critic ----

// Load the pre-run history + last stored briefing for a brand (RAG memory).
async function lastMemory(brand) {
  const bk = brandKey(brand);
  const hist = [];
  const hRaw = await kvGet('grapevine:hist:' + bk);
  if (hRaw) { try { const p = JSON.parse(hRaw); if (Array.isArray(p)) hist.push.apply(hist, p); } catch (e) {} }
  let lastBrief = '';
  const runsRaw = await kvGet('grapevine:runs:' + bk);
  if (runsRaw) {
    try {
      const runs = JSON.parse(runsRaw);
      const lastId = Array.isArray(runs) && runs.length ? runs[runs.length - 1].runId : null;
      if (lastId) { const bRaw = await kvGet('grapevine:run:' + lastId); if (bRaw) { try { const p = JSON.parse(bRaw); if (p && p.briefing) lastBrief = String(p.briefing.briefing || '').slice(0, 400); } catch (e2) {} } }
    } catch (e) {}
  }
  return { hist: hist.slice(-6), lastPoint: hist.length ? hist[hist.length - 1] : null, lastBrief: lastBrief };
}

function memoryText(mem) {
  const L = [];
  if (mem.lastPoint || mem.hist.length) {
    L.push('WATCH HISTORY (previous runs for this brand, oldest → newest):');
    mem.hist.forEach(function (p, i) {
      L.push('  watch ' + (i + 1) + ' → crisis ' + (p.score != null ? p.score + '/100' : 'n/a') + ' · ' + (p.level || 'normal') + ' · pos ' + (p.pos || 0) + ' neg ' + (p.neg || 0) + ' neu ' + (p.neu || 0) + (p.briefing ? ' · ' + String(p.briefing).slice(0, 120) : ''));
    });
  }
  if (mem.lastBrief) L.push('LAST BRIEFING: ' + mem.lastBrief);
  if (mem.lastPoint && mem.lastPoint.score != null) L.push('LAST CRISIS SCORE: ' + mem.lastPoint.score + '/100 (' + (mem.lastPoint.level || 'normal') + ')');
  return L.length ? L.join('\n') : 'No prior history for this brand — this is the first watch.';
}

// Rule-based "what changed since last watch" delta used to frame the briefing.
function deltaBriefing(mem, snapshot) {
  if (!mem.lastPoint || snapshot.score == null) return null;
  const lp = mem.lastPoint;
  const cur = snapshot;
  const parts = [];
  const dScore = cur.score - (lp.score != null ? lp.score : cur.score);
  if (lp.score != null && dScore !== 0) parts.push('crisis ' + (dScore > 0 ? '+' : '') + dScore + ' pts to ' + cur.score + '/100');
  const dNeg = (cur.neg || 0) - (lp.neg || 0);
  if (dNeg !== 0) parts.push((dNeg > 0 ? '+' : '') + dNeg + ' negative mention' + (Math.abs(dNeg) === 1 ? '' : 's'));
  const dPos = (cur.pos || 0) - (lp.pos || 0);
  if (dPos !== 0) parts.push((dPos > 0 ? '+' : '') + dPos + ' positive mention' + (Math.abs(dPos) === 1 ? '' : 's'));
  if (lp.level && cur.level && lp.level !== cur.level) parts.push('level ' + lp.level + ' → ' + cur.level);
  if (!parts.length) return null;
  return 'vs last watch: ' + parts.join(', ') + '.';
}

// LLM topic tagging: label each mention's intent (refund, shipping, bug, praise…).
async function tagTopics(mentions, brand, key) {
  if (!key || !Array.isArray(mentions) || !mentions.length) return null;
  const batch = mentions.filter(function (m) { return m.text; }).slice(0, 8).map(function (m, i) { return (i + 1) + ') ' + String(m.text).slice(0, 150); });
  if (!batch.length) return null;
  const sys = 'You tag brand-mention topics for sentiment triage. Read the numbered mentions and return ONLY JSON: {"topics":["topic for 1","topic for 2",…]} using concise labels like refund, shipping, bug/crash, price, praise, question, feature-request, cs-reply, spam, other.';
  const user = 'BRAND: ' + String(brand || '').slice(0, 120) + '\n' + batch.join('\n');
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 8000);
    const t0 = Date.now();
    const r = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: 300, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    clearTimeout(t);
    const j = await r.json();
    telAdd(telemetry, (j.usage) || null, Date.now() - t0);
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null; try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (o && Array.isArray(o.topics)) {
      const tops = o.topics.slice(0, mentions.length).map(function (x) { return String(x).slice(0, 30); });
      const tally = {};
      mentions.forEach(function (m, i) { if (tops[i]) { m.topic = tops[i]; tally[tops[i]] = (tally[tops[i]] || 0) + 1; } });
      return { tally: tally, top: Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; }).slice(0, 5).map(function (t) { return { topic: t, n: tally[t] }; }) };
    }
  } catch (e) {}
  return null;
}

// Brand-safety critic: one LLM pass per draft replying "to post / review / flagged".
async function criticDraft(draft, brand, key) {
  if (!key || !draft || !draft.reply) return null;
  const sys = 'You are the Grapevine brand-safety reviewer. A human may post this reply on social media under the brand\'s handle. Flag anything tone-deaf, legally risky, overly defensive, or that names private data. Return ONLY JSON: {"ready":"post|review|flagged","risk":"high|med|low","reason":"<short>"}';
  const user = 'BRAND: ' + String(brand || '').slice(0, 120) + '\nMENTION: ' + String(draft.text || '').slice(0, 160) + '\nDRAFT REPLY: ' + String(draft.reply || '').slice(0, 220);
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 8000);
    const t0 = Date.now();
    const r = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.3, max_tokens: 120, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    clearTimeout(t);
    const j = await r.json();
    telAdd(telemetry, (j.usage) || null, Date.now() - t0);
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null; try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (o) return { ready: String(o.ready || 'post').slice(0, 12), risk: String(o.risk || 'low').slice(0, 8), reason: String(o.reason || '').slice(0, 120) };
  } catch (e) {}
  return null;
}

// ---- Feature additions: platform sweep, competitor vs mode, alerts, approvals, scheduling ----

const PLATFORM_SITE = {
  reddit: 'site:reddit.com',
  twitter: 'site:twitter.com OR site:x.com',
  facebook: 'site:facebook.com',
  instagram: 'site:instagram.com',
  youtube: 'site:youtube.com',
  trustpilot: 'site:trustpilot.com',
  glassdoor: 'site:glassdoor.com',
  'x / twitter': 'site:twitter.com OR site:x.com'
};
function normPlatform(p) {
  const s = String(p || '').toLowerCase().trim();
  if (s.indexOf('twitter') >= 0 || s === 'x') return 'twitter';
  if (s.indexOf('reddit') >= 0) return 'reddit';
  if (s.indexOf('facebook') >= 0) return 'facebook';
  if (s.indexOf('instagram') >= 0) return 'instagram';
  if (s.indexOf('youtube') >= 0) return 'youtube';
  if (s.indexOf('trustpilot') >= 0) return 'trustpilot';
  if (s.indexOf('glassdoor') >= 0) return 'glassdoor';
  return s;
}

// Per-platform SERP sweep: a general query plus a site-scoped query per platform so
// the platform breakdown in the briefing is grounded in real review-site results.
async function sweepScan(brand, platforms) {
  const b = String(brand || '').slice(0, 120).trim();
  const queries = ['"' + b + '" review', '"' + b + '" review complaints'];
  (platforms || []).slice(0, 3).forEach(function (p) {
    const site = PLATFORM_SITE[normPlatform(p)];
    if (site) queries.push('"' + b + '" ' + site);
  });
  const unique = [], seen = {};
  const lists = await Promise.all(queries.slice(0, 5).map(function (q) {
    return serp(q, { num: 8 }).then(function (r) { return Array.isArray(r) ? r : []; }).catch(function () { return []; });
  }));
  lists.forEach(function (list) {
    (list || []).forEach(function (r) {
      const k = r.link || ((r.title || '') + (r.snippet || ''));
      if (seen[k]) return;
      seen[k] = 1;
      unique.push(r);
    });
  });
  return { query: queries[0], queries: queries, queryCount: queries.length, live: unique.slice(0, 14), count: unique.length };
}

async function classifyMentions(mentions) {
  const s = await runTool('grapevine.sentiment', { mentions: mentions });
  return { mentions: (s.ok && s.result && s.result.classified) || [], tally: (s.ok && s.result && s.result.tally) || null };
}

// Threshold alerting: Telegram bot + optional webhook (same pattern as libs/watch.js).
const ALERT_SCORE = (parseInt(process.env.GRAPEVINE_ALERT_SCORE || '60', 10)) || 60;
async function sendAlert(message) {
  const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const webhook = (process.env.CONTACT_WEBHOOK || '').trim();
  const parts = [];
  if (TG_TOKEN && TG_CHAT) parts.push(fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: String(TG_CHAT), text: message.slice(0, 3900) }) }).catch(function () {}));
  if (webhook) parts.push(fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '[Grapevine] ' + message }) }).catch(function () {}));
  return Promise.all(parts);
}
async function maybeAlert(payload, brand) {
  const crisis = payload.crisis || {};
  const flagged = (payload.drafts || []).filter(function (d) { return d.critic && d.critic.ready === 'flagged'; });
  const score = crisis.score != null ? crisis.score : 0;
  const should = score >= ALERT_SCORE || flagged.length > 0;
  if (!should) return false;
  const bk = brandKey(brand);
  const lastRaw = await kvGet('grapevine:alert:' + bk);
  let last = 0;
  try { const p = JSON.parse(lastRaw); last = p && p.at ? Number(p.at) : 0; } catch (e) {}
  if (Date.now() - last < 6 * 3600 * 1000) return false; // at most once per 6h
  const msg = '🚨 Grapevine alert: "' + brand + '"\nCrisis: ' + score + '/100 (' + (crisis.level || 'normal') + ')' +
    (flagged.length ? '\nFlagged drafts: ' + flagged.length + ' need human review before posting.' : '') +
    '\nEscalations: ' + ((payload.queue || []).length) + ' in the human queue.';
  await sendAlert(msg);
  await kv([['SET', 'grapevine:alert:' + bk, JSON.stringify({ at: Date.now() })], ['EXPIRE', 'grapevine:alert:' + bk, 86400 * 30]]);
  return true;
}

// Human-approval flow stub: persist per-draft verdicts (approved / rejected / edited) to KV.
async function approveReply(brand, runId, index, reply, verdict) {
  const bk = brandKey(brand);
  const raw = await kvGet('grapevine:approvals:' + bk);
  let list = [];
  try { const a = JSON.parse(raw); if (Array.isArray(a)) list = a; } catch (e) {}
  const item = { at: Date.now(), runId: String(runId || '').slice(0, 64), index: Number(index) || 0, verdict: String(verdict || 'approved').slice(0, 12), reply: String(reply || '').slice(0, 400), brand: String(brand || '').slice(0, 120) };
  const i = list.findIndex(function (x) { return x.runId === item.runId && x.index === item.index; });
  if (i >= 0) list[i] = item; else list.push(item);
  await kv([['SET', 'grapevine:approvals:' + bk, JSON.stringify(list.slice(-40))], ['EXPIRE', 'grapevine:approvals:' + bk, 86400 * 30]]);
  return item;
}

// Scheduled daily watch queue (KV-backed, driven by Vercel Cron GET ?cron=1).
async function getWatches() {
  const raw = await kvGet('grapevine:watches');
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
async function setWatches(list) { await kv([['SET', 'grapevine:watches', JSON.stringify(list.slice(0, 20))], ['EXPIRE', 'grapevine:watches', 31536000]]); }
async function runScheduled() {
  const list = await getWatches();
  const due = list.filter(function (w) { return !w.nextAt || w.nextAt <= Date.now(); });
  const results = [];
  for (const w of due.slice(0, 5)) {
    try {
      const rep = await buildReport(w.brand, [], null, null);
      await persistReport(rep.payload, rep.snapshot, w.brand, rep.mem);
      await maybeAlert(rep.payload, w.brand);
      w.lastAt = Date.now();
      w.nextAt = Date.now() + ((w.hours || 24) * 3600 * 1000);
      results.push({ brand: w.brand, ok: true, score: rep.payload.crisis && rep.payload.crisis.score });
    } catch (e) {
      w.nextAt = Date.now() + 3600 * 1000;
      results.push({ brand: w.brand, ok: false, error: String((e && e.message) || 'failed') });
    }
  }
  await setWatches(list);
  return results;
}

// Core pipeline: scan → orchestrator (LLM) → real tools → report. Reused by both the
// interactive POST handler (streams events via emit) and the scheduled cron runner.
async function buildReport(brand, platforms, emit, vs) {
  const e = function (obj) { if (typeof emit === 'function') emit(obj); };
  const key = (process.env.GROQ_API_KEY || '').trim();
  const sweep = await sweepScan(brand, platforms);
  const scanQ = sweep.query, serpLive = sweep.live.length ? sweep.live : null;
  const mem = await lastMemory(brand);

  telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
  let briefing = fallback(brand, platforms), mode = 'template';
  if (key) {
    const serpBlock = serpLive && serpLive.length ? { query: scanQ, text: formatSerp(serpLive) } : null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, GROQ_TIMEOUT);
      const r = await fetch(GROQ, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.55, max_tokens: 1600, stream: true, stream_options: { include_usage: true }, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sysPrompt(brand, platforms, serpBlock && serpBlock.text, memoryText(mem)) }, { role: 'user', content: 'BRAND: ' + brand + (vs ? '\nCOMPETITOR TO COMPARE: ' + vs : '') + '\nRun Grapevine and return the JSON briefing now.' }] })
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
              if (acc.length - lastEmit >= 12) { e({ event: 'orch', text: acc }); lastEmit = acc.length; }
            }
            if (j.usage) telAdd(telemetry, j.usage, Date.now() - orchMs);
          } catch (e2) {}
        }
      }
      clearTimeout(timer);
      if (acc.length) e({ event: 'orch', text: acc });
      let out = null;
      try { out = JSON.parse(acc); } catch (e3) { const mm = acc.match(/\{[\s\S]*\}/); if (mm) { try { out = JSON.parse(mm[0]); } catch (e4) {} } }
      const p = safeBriefing(out);
      if (p) { ensureAgents(p); p.agents = p.agents.map(normalizeAgent).filter(Boolean).slice(0, 8); briefing = p; mode = 'ai'; }
    } catch (e5) {}
  }

  // ---- Real execution loop: every agent's tool actually runs now ----
  let toolsTel = { calls: 0, ms: 0 };
  let mentions = []; let tally = null; let crisis = null; let queue = [];
  const runOne = async (a) => {
    const tool = a.call;
    const args = a.toolArgs || {};
    let exec;
    if (tool === 'grapevine.scan') {
      exec = { tool, args: { q: args.q || scanQ }, ok: !!serpLive, result: { mentions: (serpLive || []).map(function (r) { return { text: ((r.title || '') + '. ' + (r.snippet || '')).slice(0, 220), platform: 'web', domain: r.domain || '', link: r.link || '' }; }) }, ms: 0 };
      if (!exec.ok) exec.error = 'no mentions found';
    } else {
      const t0 = Date.now();
      exec = await runTool(tool, args);
      toolsTel.calls++; toolsTel.ms += exec.ms;
      const u = exec.tokens && (exec.tokens.prompt_tokens || exec.tokens.completion_tokens) ? { prompt_tokens: exec.tokens.prompt_tokens || 0, completion_tokens: exec.tokens.completion_tokens || 0 } : null;
      if (u) telAdd(telemetry, u, exec.ms);
      exec.ms = Date.now() - t0;
    }
    return { a, exec };
  };

  const monitor = briefing.agents.find((x) => x.id === 'monitor');
  if (monitor) {
    const m = await runOne(monitor);
    monitor.exec = m.exec;
    monitor.realText = m.exec.ok ? fmtResult(m.exec) : '';
    monitor.result = m.exec.ok ? monitor.realText : (monitor.result + ' · (' + (m.exec.error || 'tool failed') + ')');
    e({ event: 'tool', id: 'monitor', tool: m.exec.tool, exec: { ok: m.exec.ok, ms: m.exec.ms, error: m.exec.error || null } });
    if (m.exec.ok && m.exec.result && Array.isArray(m.exec.result.mentions)) mentions = m.exec.result.mentions;
    await reflectAgent(monitor, m.exec, brand, key);
    if (m.exec.ok) e({ event: 'reflect', id: 'monitor', output: monitor.output, passes: monitor.reflection ? monitor.reflection.passes : 1 });
  }

  const classify = briefing.agents.find((x) => x.id === 'classify');
  if (classify) {
    classify.toolArgs = Object.assign({}, classify.toolArgs, { mentions: mentions.length ? mentions : classify.toolArgs.mentions });
    const c = await runOne(classify);
    classify.exec = c.exec;
    classify.realText = c.exec.ok ? fmtResult(c.exec) : '';
    classify.result = c.exec.ok ? classify.realText : (classify.result + ' · (' + (c.exec.error || 'tool failed') + ')');
    e({ event: 'tool', id: 'classify', tool: c.exec.tool, exec: { ok: c.exec.ok, ms: c.exec.ms, error: c.exec.error || null } });
    if (c.exec.ok && Array.isArray(c.exec.result.classified)) mentions = c.exec.result.classified;
    if (c.exec.ok && c.exec.result.tally) tally = c.exec.result.tally;
    await reflectAgent(classify, c.exec, brand, key);
    if (c.exec.ok) e({ event: 'reflect', id: 'classify', output: classify.output, passes: classify.reflection ? classify.reflection.passes : 1 });
    if (c.exec.ok) {
      const tags = await tagTopics(mentions, brand, key);
      if (tags) { classify.topics = tags; classify.output = (classify.output || '') + ' Topics: ' + tags.top.map((t) => t.topic + ' ×' + t.n).join(', '); }
    }
  }

  const crisisAgent = briefing.agents.find((x) => x.id === 'crisis');
  if (crisisAgent) {
    crisisAgent.toolArgs = Object.assign({}, crisisAgent.toolArgs, { mentions: mentions.length ? mentions : crisisAgent.toolArgs.mentions, tally: tally || crisisAgent.toolArgs.tally });
    const c = await runOne(crisisAgent);
    crisisAgent.exec = c.exec;
    crisisAgent.realText = c.exec.ok ? fmtResult(c.exec) : '';
    crisisAgent.result = c.exec.ok ? crisisAgent.realText : (crisisAgent.result + ' · (' + (c.exec.error || 'tool failed') + ')');
    e({ event: 'tool', id: 'crisis', tool: c.exec.tool, exec: { ok: c.exec.ok, ms: c.exec.ms, error: c.exec.error || null } });
    if (c.exec.ok && c.exec.result) crisis = c.exec.result;
    await reflectAgent(crisisAgent, c.exec, brand, key);
    if (c.exec.ok) e({ event: 'reflect', id: 'crisis', output: crisisAgent.output, passes: crisisAgent.reflection ? crisisAgent.reflection.passes : 1 });
  }

  const respond = briefing.agents.find((x) => x.id === 'respond');
  if (respond) {
    const targets = (mentions.slice(0, 6)).length ? mentions.slice(0, 6) : [{ text: 'sample mention', platform: 'web', sentiment: 'neutral' }];
    const r = await runOne(respond);
    respond.exec = r.exec;
    respond.result = 'reply drafted for ' + targets.length + ' mention(s)';
    e({ event: 'tool', id: 'respond', tool: r.exec.tool, exec: { ok: r.exec.ok, ms: r.exec.ms, error: r.exec.error || null } });
    const drafts = [];
    for (const mt of targets) {
      const dr = await runTool('grapevine.respond', { text: mt.text, sentiment: mt.sentiment || 'neutral' });
      toolsTel.calls++; toolsTel.ms += dr.ms;
      drafts.push({ text: String(mt.text || '').slice(0, 180), platform: mt.platform || 'web', sentiment: mt.sentiment || 'neutral', reply: (dr.ok && dr.result && dr.result.reply) || '' });
    }
    respond.exec.result = { drafts: drafts };
    respond.realText = drafts.map(function (d) { return d.reply; }).filter(Boolean).join(' · ').slice(0, 220);
    respond.result = respond.realText || 'replies drafted';
    await reflectAgent(respond, respond.exec, brand, key);
    e({ event: 'reflect', id: 'respond', output: respond.output, passes: respond.reflection ? respond.reflection.passes : 1 });
    if (key) {
      for (const dd of drafts) {
        const cr = await criticDraft(dd, brand, key);
        if (cr) { dd.critic = cr; }
      }
    }
    respond.drafts = drafts;
  }

  const escalate = briefing.agents.find((x) => x.id === 'escalate');
  if (escalate) {
    escalate.toolArgs = Object.assign({}, escalate.toolArgs, { mentions: mentions.length ? mentions : escalate.toolArgs.mentions, crisis: crisis || escalate.toolArgs.crisis });
    const es = await runOne(escalate);
    escalate.exec = es.exec;
    escalate.realText = es.exec.ok ? fmtResult(es.exec) : '';
    escalate.result = es.exec.ok ? escalate.realText : (escalate.result + ' · (' + (es.exec.error || 'tool failed') + ')');
    e({ event: 'tool', id: 'escalate', tool: es.exec.tool, exec: { ok: es.exec.ok, ms: es.exec.ms, error: es.exec.error || null } });
    if (es.exec.ok && Array.isArray(es.exec.result.queue)) queue = es.exec.result.queue;
    await reflectAgent(escalate, es.exec, brand, key);
    if (es.exec.ok) e({ event: 'reflect', id: 'escalate', output: escalate.output, passes: escalate.reflection ? escalate.reflection.passes : 1 });
  }

  let rescues = [];
  const concierge = briefing.agents.find((x) => x.id === 'concierge');
  if (concierge) {
    // De-escalation runs on the real escalation queue: P0/P1 move to a private channel.
    concierge.toolArgs = Object.assign({}, concierge.toolArgs, { queue: queue, brand: brand });
    const cc = await runOne(concierge);
    concierge.exec = cc.exec;
    concierge.realText = cc.exec.ok ? fmtResult(cc.exec) : '';
    concierge.result = cc.exec.ok ? concierge.realText : (concierge.result + ' · (' + (cc.exec.error || 'tool failed') + ')');
    e({ event: 'tool', id: 'concierge', tool: cc.exec.tool, exec: { ok: cc.exec.ok, ms: cc.exec.ms, error: cc.exec.error || null } });
    if (cc.exec.ok && Array.isArray(cc.exec.result.rescues)) rescues = cc.exec.result.rescues;
    await reflectAgent(concierge, cc.exec, brand, key);
    if (cc.exec.ok) e({ event: 'reflect', id: 'concierge', output: concierge.output, passes: concierge.reflection ? concierge.reflection.passes : 1 });
  }

  let forecast = null;
  const prophet = briefing.agents.find((x) => x.id === 'prophet');
  if (prophet) {
    // Forecast is grounded in the real watch history (mem.history) + the live crisis score.
    prophet.toolArgs = Object.assign({}, prophet.toolArgs, { history: (mem && Array.isArray(mem.history)) ? mem.history : [], score: (crisis && typeof crisis.score === 'number') ? crisis.score : null });
    const pp = await runOne(prophet);
    prophet.exec = pp.exec;
    prophet.realText = pp.exec.ok ? fmtResult(pp.exec) : '';
    prophet.result = pp.exec.ok ? prophet.realText : (prophet.result + ' · (' + (pp.exec.error || 'tool failed') + ')');
    e({ event: 'tool', id: 'prophet', tool: pp.exec.tool, exec: { ok: pp.exec.ok, ms: pp.exec.ms, error: pp.exec.error || null } });
    if (pp.exec.ok && pp.exec.result) forecast = pp.exec.result;
    await reflectAgent(prophet, pp.exec, brand, key);
    if (pp.exec.ok) e({ event: 'reflect', id: 'prophet', output: prophet.output, passes: prophet.reflection ? prophet.reflection.passes : 1 });
  }

  telemetry.tools = toolsTel;
  e({ event: 'serp', used: !!serpLive, count: serpLive ? serpLive.length : 0, query: scanQ });
  e({ event: 'metrics', telemetry: telemetry });

  const payload = Object.assign({
    mode: mode, telemetry: telemetry, serpUsed: !!serpLive, serpCount: serpLive ? serpLive.length : 0, serpQuery: scanQ, serpQueries: sweep.queries,
    mentions: mentions, tally: tally, crisis: crisis, queue: queue,
    drafts: (respond && respond.drafts) || [],
    topics: (classify && classify.topics) || null,
    rescues: rescues,
    forecast: forecast
  }, briefing);

  // Competitor vs mode: scan + classify the rival, then compute share of voice.
  if (vs) {
    const compSweep = await sweepScan(vs, []);
    const compClass = await classifyMentions((compSweep.live || []).slice(0, 8));
    const brandN = mentions.length, compN = (compClass.mentions || []).length;
    const total = brandN + compN || 1;
    payload.vs = {
      competitor: String(vs).slice(0, 120),
      sov: Math.round((brandN / total) * 100),
      brand: { mentions: brandN, negative: (tally && tally.negative) || 0 },
      rival: { mentions: compN, negative: (compClass.tally && compClass.tally.negative) || 0 },
      compMentions: compClass.mentions.slice(0, 5)
    };
  }

  const snapshot = {
    at: Date.now(),
    score: (crisis && typeof crisis.score === 'number') ? crisis.score : null,
    point: {
      at: Date.now(),
      score: (crisis && typeof crisis.score === 'number') ? crisis.score : null,
      level: (crisis && crisis.level) || 'normal',
      pos: (tally && tally.positive) || 0,
      neg: (tally && tally.negative) || 0,
      neu: (tally && tally.neutral) || 0
    }
  };
  return { payload: payload, snapshot: snapshot, mem: mem };
}

// Persist history/trend/storm + store the run; returns the finalized briefing object.
async function persistReport(obj, snapshot, brand, mem) {
  obj.replayed = false;
  obj.runId = runId(brand);
  obj.historySeeded = !!(KV_URL && KV_TOKEN);
  if (snapshot) {
    const bk = brandKey(brand);
    const hist = await trackSeries('hist', bk, snapshot.point, 24, 604800 * 4);
    const last = hist.length > 1 ? hist[hist.length - 2] : null;
    obj.history = hist;
    obj.trend = (last && last.score != null && snapshot.score != null)
      ? { delta: snapshot.score - last.score, prevScore: last.score, prevAt: last.at }
      : null;
    if (obj.trend && snapshot.score != null) {
      const jump = snapshot.score - obj.trend.prevScore;
      if (jump >= 12) obj.storm = { forming: true, jump: jump, from: obj.trend.prevScore, to: snapshot.score, level: (obj.crisis && obj.crisis.level) || 'normal' };
      else if (snapshot.score >= 70) obj.storm = { forming: true, active: true, jump: jump, from: obj.trend.prevScore, to: snapshot.score, level: (obj.crisis && obj.crisis.level) || 'critical' };
    }
    obj.deltaText = (mem && snapshot.score != null) ? deltaBriefing(mem, snapshot.point) : null;
    try { await trackSeries('runs', bk, { runId: obj.runId, at: snapshot.at }, 12, 604800 * 4); } catch (e) {}
  }
  try { kv([['SET', 'grapevine:run:' + obj.runId, JSON.stringify({ at: Date.now(), briefing: obj })], ['EXPIRE', 'grapevine:run:' + obj.runId, 604800]]); } catch (e) {}
  return obj;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');

  // Replay a stored briefing: GET /api/grapevine?run=<id>
  if (req.method === 'GET' && url2.searchParams.get('run')) {
    const v = await kvGet('grapevine:run:' + String(url2.searchParams.get('run')).slice(0, 64));
    if (v) {
      try {
        const c = JSON.parse(v);
        if (c && c.briefing) { c.briefing.replayed = true; c.briefing.replayedAt = c.at || null; return res.json(c.briefing); }
      } catch (e) {}
    }
    return res.status(404).json({ error: 'briefing not found' });
  }
  // Scheduled daily watch: Vercel Cron → GET /api/grapevine?cron=1
  if (req.method === 'GET' && url2.searchParams.get('cron') === '1') {
    const auth = String(req.headers['authorization'] || '');
    const cronHdr = String(req.headers['x-vercel-cron'] || '');
    const secret = (process.env.CRON_SECRET || '').trim();
    if (secret && auth !== 'Bearer ' + secret) return res.status(401).json({ error: 'unauthorized' });
    if (!secret && cronHdr !== '1') return res.status(401).json({ error: 'unauthorized' });
    try { const r = await runScheduled(); return res.json({ ok: true, ran: r.length, results: r }); }
    catch (e) { return res.status(500).json({ error: String((e && e.message) || 'scheduled watch failed') }); }
  }
  // List the scheduled-watch queue: GET /api/grapevine?watches=1
  if (req.method === 'GET' && url2.searchParams.get('watches')) {
    return res.json({ ok: true, watches: await getWatches() });
  }
  // List human approvals for a brand: GET /api/grapevine?brand=<b>&approvals=1
  if (req.method === 'GET' && url2.searchParams.get('approvals')) {
    const bk = brandKey(String(url2.searchParams.get('brand') || '').slice(0, 120));
    const raw = await kvGet('grapevine:approvals:' + bk);
    let list = [];
    try { const p = JSON.parse(raw); if (Array.isArray(p)) list = p; } catch (e) {}
    return res.json({ ok: true, approvals: list.slice(-20).reverse() });
  }
  // List recent runs for a brand: GET /api/grapevine?brand=<b>&recent=1
  if (req.method === 'GET' && url2.searchParams.get('recent')) {
    const bk = brandKey(String(url2.searchParams.get('brand') || '').slice(0, 120));
    const raw = await kvGet('grapevine:runs:' + bk);
    let runs = [];
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) runs = p; } catch (e) {} }
    return res.json({ ok: true, brand: String(url2.searchParams.get('brand') || '').slice(0, 120), runs: runs.slice(-12).reverse() });
  }
  // History series for a brand: GET /api/grapevine?brand=<b>&hist=1
  if (req.method === 'GET' && url2.searchParams.get('hist')) {
    const bk = brandKey(String(url2.searchParams.get('brand') || '').slice(0, 120));
    const raw = await kvGet('grapevine:hist:' + bk);
    let hist = [];
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) hist = p; } catch (e) {} }
    return res.json({ ok: true, brand: String(url2.searchParams.get('brand') || '').slice(0, 120), history: hist });
  }
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/grapevine with {brand, vs?, platform?, stream?} — real mention scan + sentiment + crisis tools execute.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const brand = String(b.brand || '').slice(0, 120).trim();
  const platforms = (Array.isArray(b.platform) && b.platform.length) ? b.platform.map(String).slice(0, 6) : [];
  if (!brand) return res.status(400).json({ error: 'brand is required' });

  // Sub-actions (POST /api/grapevine?sub=…): approve a draft reply, or schedule/unschedule a watch.
  const sub = String(url2.searchParams.get('sub') || '');
  if (sub === 'approve') {
    const item = await approveReply(brand, String(b.runId || ''), Number(b.index) || 0, String(b.reply || ''), String(b.verdict || 'approved'));
    return res.json({ ok: true, approval: item });
  }
  if (sub === 'schedule') {
    const hours = Math.max(1, Math.min(168, parseInt(b.hours, 10) || 24));
    const list = await getWatches();
    const ex = list.find(function (w) { return w.brand === brand; });
    if (ex) ex.hours = hours; else list.push({ brand: brand, hours: hours, nextAt: Date.now() });
    await setWatches(list);
    return res.json({ ok: true, scheduled: true, brand: brand, hours: hours, watches: list });
  }
  if (sub === 'unschedule') {
    const list = await getWatches();
    await setWatches(list.filter(function (w) { return w.brand !== brand; }));
    return res.json({ ok: true, unscheduled: true, brand: brand });
  }

  if (await isRateLimited(ipOf(req) + ':grapevine')) return res.status(429).json({ error: 'rate limited' });

  const stream = !!(b.stream);
  const vs = String(b.vs || '').trim().slice(0, 120);
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };

  const rep = await buildReport(brand, platforms, send, vs);
  const obj = await persistReport(rep.payload, rep.snapshot, brand, rep.mem);
  await maybeAlert(obj, brand);
  send({ event: 'plan', data: obj });
  if (stream) res.end();
  else res.json(obj);
};
