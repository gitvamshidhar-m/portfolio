// Sentinel — an autonomous reputation & social-listening team.
// Given a brand, Sentinel's agents monitor live SERP for mentions, classify
// sentiment + urgency, score the crisis level, draft on-brand replies, and build
// a human escalation queue. Each agent's tool really executes (live search,
// lexicon sentiment, arithmetic crisis score) and the page shows the real values.
//
// POST /api/sentinel  {brand, platform?, stream?} → NDJSON stream or JSON
//   events: orch | tool | reflect | serp | metrics | plan
// GET  /api/sentinel?run=<id> → replay a stored briefing
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
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
        body: JSON.stringify([['INCR', 'rl:sentinel:' + key], ['EXPIRE', 'rl:sentinel:' + key, RL_WIN_SEC]])
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
function runId(brand) { return crypto.createHash('sha1').update('sentinel|' + String(brand || '')).digest('hex').slice(0, 12); }

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

// The Sentinel team: monitor → classify → crisis → respond → escalate.
const AGENTS = ['monitor', 'classify', 'crisis', 'respond', 'escalate'];
const PERSONAS = {
  monitor: { name: 'Monitor Agent', persona: 'The Eavesdropper', role: 'Scans live search + social for brand mentions' },
  classify: { name: 'Classify Agent', persona: 'The Judge', role: 'Sentiment, urgency & topic per mention' },
  crisis: { name: 'Crisis Agent', persona: 'The Firefighter', role: 'Detects a storm early, scores the risk' },
  respond: { name: 'Respond Agent', persona: 'The Voice', role: 'Drafts warm, on-brand public replies' },
  escalate: { name: 'Escalate Agent', persona: 'The Captain', role: 'Decides what a human must see first' }
};

function sysPrompt(brand, platforms, serpText) {
  return 'You are the ORCHESTRATOR of Sentinel, an autonomous reputation & social-listening team. Given a BRAND you must plan and "run" a team of agents that monitor mentions, classify sentiment, detect crises, draft replies, and decide what to escalate to a human. Later agents build on earlier agents\' outputs.\n'
    + 'LIVE SEARCH CONTEXT (real mentions for "' + brand + '"):\n' + (serpText || 'No live results — the Monitor Agent will still run a real scan.') + '\n\n'
    + 'Return ONLY valid minified JSON (no markdown) with exactly this shape:\n'
    + '{\n'
    + '  "brand":"<echo the brand>",\n'
    + '  "orchestrator":"<one line: how the team splits the watch>",\n'
    + '  "agents":[\n'
    + '    {"id":"monitor","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: what mentions it found, grounded in the LIVE SEARCH CONTEXT — name real platforms/domains>","live":"<4-8 words present continuous>","call":"sentinel.scan","toolArgs":{"q":"<the exact brand or query>"},"result":"<predicted one-line outcome>"},\n'
    + '    {"id":"classify","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: sentiment split it expects>","live":"<4-8 words>","call":"sentinel.sentiment","toolArgs":{"mentions":[{"text":"<sample mention text>","platform":"<platform>"}]},"result":"<predicted tally>"},\n'
    + '    {"id":"crisis","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: how risky the situation looks>","live":"<4-8 words>","call":"sentinel.crisis","toolArgs":{},"result":"<predicted score/level>"},\n'
    + '    {"id":"respond","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: how it will answer the loudest mentions>","live":"<4-8 words>","call":"sentinel.respond","toolArgs":{"text":"<a sample mention>","sentiment":"negative"},"result":"<predicted reply>"},\n'
    + '    {"id":"escalate","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: what needs a human first>","live":"<4-8 words>","call":"sentinel.escalate","toolArgs":{},"result":"<predicted queue>"}\n'
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
    orchestrator: 'Monitor sweeps live search + social for "' + core + '", Classify tags every mention, Crisis scores the risk, Respond drafts replies, Escalate builds the human queue.',
    agents: [
      ag('monitor', 'Sweeps live search and social for every mention of "' + core + '".', 'Queries SERP for brand + review/complaint variants across ' + plats + '.', 'Mentions surfaced across ' + plats + ' — handed to Classify.', 'Scanning live mentions…', 'sentinel.scan', { q: b }, 'live mentions across platforms'),
      ag('classify', 'Tags each mention by sentiment, urgency and platform.', 'Runs the lexicon classifier over every scanned mention.', 'Sentiment split + urgent items tallied — handed to Crisis.', 'Tagging sentiment + urgency…', 'sentinel.sentiment', { mentions: [{ text: 'sample mention', platform: 'web' }] }, 'positive/negative/neutral split'),
      ag('crisis', 'Watches for a negative spike before it compounds.', 'Scores negative share, volume and severity into a 0-100 risk.', 'Risk level computed from the tally — handed to Respond.', 'Scoring the crisis level…', 'sentinel.crisis', {}, 'risk score + level'),
      ag('respond', 'Answers the loudest mentions in the brand voice.', 'Drafts a warm public reply for the top positive + negative mentions.', 'Drafted replies queued for the top mentions — handed to Escalate.', 'Drafting on-brand replies…', 'sentinel.respond', { text: 'example mention', sentiment: 'negative' }, 'drafted replies'),
      ag('escalate', 'Decides what only a human should touch.', 'Ranks negatives into a P0/P1/P2 action queue by urgency.', 'Escalation queue built for the team — Sentinel stands by.', 'Building the human queue…', 'sentinel.escalate', {}, 'P0/P1/P2 escalation queue')
    ],
    briefing: 'Sentinel is now watching "' + core + '". It scanned mentions across ' + plats + ', classified sentiment, scored the crisis level, drafted replies and built a human escalation queue — so a brand-team can react in minutes, not days.',
    nextSteps: ['Approve the drafted replies for the top mentions', 'Assign the P0/P1 escalations to a human owner', 'Set daily SERP watch on "' + core + '"']
  };
}

const AGENT_DEFAULTS = {};
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
  const sys = 'You are ' + (agent.name || 'an agent') + ' in Sentinel, an autonomous reputation team. Your tool just returned REAL output. Rewrite your handoff "output" (1-2 sentences) grounded strictly in that real return — name the actual numbers/platforms/sentiment. No hype, no emojis. Return ONLY JSON: {"output":"..."}.';
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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');

  // Replay a stored briefing: GET /api/sentinel?run=<id>
  if (req.method === 'GET' && url2.searchParams.get('run')) {
    const v = await kvGet('sentinel:run:' + String(url2.searchParams.get('run')).slice(0, 64));
    if (v) {
      try {
        const c = JSON.parse(v);
        if (c && c.briefing) { c.briefing.replayed = true; return res.json(c.briefing); }
      } catch (e) {}
    }
    return res.status(404).json({ error: 'briefing not found' });
  }
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/sentinel with {brand, platform?, stream?} — real mention scan + sentiment + crisis tools execute.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const brand = String(b.brand || '').slice(0, 120).trim();
  const platforms = (Array.isArray(b.platform) && b.platform.length) ? b.platform.map(String).slice(0, 6) : [];
  if (!brand) return res.status(400).json({ error: 'brand is required' });
  if (await isRateLimited(ipOf(req) + ':sentinel')) return res.status(429).json({ error: 'rate limited' });

  const stream = !!(b.stream);
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };
  const finish = function (obj) {
    obj.replayed = false;
    obj.runId = runId(brand);
    send({ event: 'plan', data: obj });
    try { kv([['SET', 'sentinel:run:' + obj.runId, JSON.stringify({ at: Date.now(), briefing: obj })], ['EXPIRE', 'sentinel:run:' + obj.runId, 604800]]); } catch (e) {}
    if (stream) res.end();
    else res.json(obj);
  };

  // Live SERP scan grounds the Monitor Agent (real tool call runs regardless of key).
  let scanQ = brand + (platforms.length ? ' ' + platforms[0] : '') + ' review';
  let serpLive = null;
  try { serpLive = await serp(scanQ, { num: 8 }); } catch (e) {}
  if (!Array.isArray(serpLive) || !serpLive.length) serpLive = null;

  telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
  let briefing = fallback(brand, platforms), mode = 'template';
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (key) {
    const serpBlock = serpLive && serpLive.length ? { query: scanQ, text: formatSerp(serpLive) } : null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(function () { controller.abort(); }, GROQ_TIMEOUT);
      const r = await fetch(GROQ, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0.55, max_tokens: 1600, stream: true, stream_options: { include_usage: true }, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sysPrompt(brand, platforms, serpBlock && serpBlock.text) }, { role: 'user', content: 'BRAND: ' + brand + '\nRun Sentinel and return the JSON briefing now.' }] })
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
      const p = safeBriefing(out);
      if (p) { briefing = p; mode = 'ai'; }
    } catch (e) {}
  }

  // ---- Real execution loop: every agent's tool actually runs now ----
  // monitor must land first (its scan feeds classify → crisis → respond → escalate).
  let toolsTel = { calls: 0, ms: 0 };
  let mentions = []; let tally = null; let crisis = null; let queue = [];
  const runOne = async (a) => {
    const tool = a.call;
    const args = a.toolArgs || {};
    let exec;
    if (tool === 'sentinel.scan') {
      // Feed the real SERP snapshot (already fetched) straight into the scan tool.
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
  const rest = briefing.agents.filter((x) => x.id !== 'monitor');
  if (monitor) {
    const m = await runOne(monitor);
    monitor.exec = m.exec;
    monitor.realText = m.exec.ok ? fmtResult(m.exec) : '';
    monitor.result = m.exec.ok ? monitor.realText : (monitor.result + ' · (' + (m.exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: 'monitor', tool: m.exec.tool, exec: { ok: m.exec.ok, ms: m.exec.ms, error: m.exec.error || null } });
    if (m.exec.ok && m.exec.result && Array.isArray(m.exec.result.mentions)) mentions = m.exec.result.mentions;
    await reflectAgent(monitor, m.exec, brand, key);
    if (m.exec.ok) send({ event: 'reflect', id: 'monitor', output: monitor.output, passes: monitor.reflection ? monitor.reflection.passes : 1 });
  }

  // classify → crisis → escalate share the mention data; respond runs per mention.
  const classify = briefing.agents.find((x) => x.id === 'classify');
  if (classify) {
    // The real mention list (from Monitor's live scan) is authoritative over whatever
    // the model predicted — always feed it into the classifier so the pipeline is real.
    classify.toolArgs = Object.assign({}, classify.toolArgs, { mentions: mentions.length ? mentions : classify.toolArgs.mentions });
    const c = await runOne(classify);
    classify.exec = c.exec;
    classify.realText = c.exec.ok ? fmtResult(c.exec) : '';
    classify.result = c.exec.ok ? classify.realText : (classify.result + ' · (' + (c.exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: 'classify', tool: c.exec.tool, exec: { ok: c.exec.ok, ms: c.exec.ms, error: c.exec.error || null } });
    if (c.exec.ok && Array.isArray(c.exec.result.classified)) mentions = c.exec.result.classified;
    if (c.exec.ok && c.exec.result.tally) tally = c.exec.result.tally;
    await reflectAgent(classify, c.exec, brand, key);
    if (c.exec.ok) send({ event: 'reflect', id: 'classify', output: classify.output, passes: classify.reflection ? classify.reflection.passes : 1 });
  }

  const crisisAgent = briefing.agents.find((x) => x.id === 'crisis');
  if (crisisAgent) {
    // Crisis scoring needs the real classified mentions + tally, not the model's guess.
    crisisAgent.toolArgs = Object.assign({}, crisisAgent.toolArgs, { mentions: mentions.length ? mentions : crisisAgent.toolArgs.mentions, tally: tally || crisisAgent.toolArgs.tally });
    const c = await runOne(crisisAgent);
    crisisAgent.exec = c.exec;
    crisisAgent.realText = c.exec.ok ? fmtResult(c.exec) : '';
    crisisAgent.result = c.exec.ok ? crisisAgent.realText : (crisisAgent.result + ' · (' + (c.exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: 'crisis', tool: c.exec.tool, exec: { ok: c.exec.ok, ms: c.exec.ms, error: c.exec.error || null } });
    if (c.exec.ok && c.exec.result) crisis = c.exec.result;
    await reflectAgent(crisisAgent, c.exec, brand, key);
    if (c.exec.ok) send({ event: 'reflect', id: 'crisis', output: crisisAgent.output, passes: crisisAgent.reflection ? crisisAgent.reflection.passes : 1 });
  }

  const respond = briefing.agents.find((x) => x.id === 'respond');
  if (respond) {
    // Respond actually drafts a reply for each mention classified (cap 6) via the real tool.
    const targets = (mentions.slice(0, 6)).length ? mentions.slice(0, 6) : [{ text: 'sample mention', platform: 'web', sentiment: 'neutral' }];
    const r = await runOne(respond);
    respond.exec = r.exec;
    respond.result = 'reply drafted for ' + targets.length + ' mention(s)';
    send({ event: 'tool', id: 'respond', tool: r.exec.tool, exec: { ok: r.exec.ok, ms: r.exec.ms, error: r.exec.error || null } });
    const drafts = [];
    for (const mt of targets) {
      const dr = await runTool('sentinel.respond', { text: mt.text, sentiment: mt.sentiment || 'neutral' });
      toolsTel.calls++; toolsTel.ms += dr.ms;
      drafts.push({ text: String(mt.text || '').slice(0, 180), platform: mt.platform || 'web', sentiment: mt.sentiment || 'neutral', reply: (dr.ok && dr.result && dr.result.reply) || '' });
    }
    respond.exec.result = { drafts: drafts };
    respond.realText = drafts.map(function (d) { return d.reply; }).filter(Boolean).join(' · ').slice(0, 220);
    respond.result = respond.realText || 'replies drafted';
    await reflectAgent(respond, respond.exec, brand, key);
    send({ event: 'reflect', id: 'respond', output: respond.output, passes: respond.reflection ? respond.reflection.passes : 1 });
    respond.drafts = drafts;
  }

  const escalate = briefing.agents.find((x) => x.id === 'escalate');
  if (escalate) {
    // Escalation queue is built from the real classified mentions + crisis score.
    escalate.toolArgs = Object.assign({}, escalate.toolArgs, { mentions: mentions.length ? mentions : escalate.toolArgs.mentions, crisis: crisis || escalate.toolArgs.crisis });
    const e = await runOne(escalate);
    escalate.exec = e.exec;
    escalate.realText = e.exec.ok ? fmtResult(e.exec) : '';
    escalate.result = e.exec.ok ? escalate.realText : (escalate.result + ' · (' + (e.exec.error || 'tool failed') + ')');
    send({ event: 'tool', id: 'escalate', tool: e.exec.tool, exec: { ok: e.exec.ok, ms: e.exec.ms, error: e.exec.error || null } });
    if (e.exec.ok && Array.isArray(e.exec.result.queue)) queue = e.exec.result.queue;
    await reflectAgent(escalate, e.exec, brand, key);
    if (e.exec.ok) send({ event: 'reflect', id: 'escalate', output: escalate.output, passes: escalate.reflection ? escalate.reflection.passes : 1 });
  }

  telemetry.tools = toolsTel;
  send({ event: 'serp', used: !!serpLive, count: serpLive ? serpLive.length : 0, query: scanQ });
  send({ event: 'metrics', telemetry: telemetry });

  const payload = Object.assign({
    mode: mode, telemetry: telemetry, serpUsed: !!serpLive, serpCount: serpLive ? serpLive.length : 0, serpQuery: scanQ,
    mentions: mentions, tally: tally, crisis: crisis, queue: queue,
    drafts: (respond && respond.drafts) || []
  }, briefing);
  finish(payload);
};
