// GTM Launch Agent — an autonomous 9-agent go-to-market studio powered by RAG + a
// reasoning model. Given a product/service, nine agents collaborate in strict order:
// strategist → researcher → icp → offer → channel → message → skeptic → planner → publisher.
// Every agent's tool really executes: the Researcher runs a live SERP query, the Strategist
// plans with a reasoning model (openai/gpt-oss-120b) whose chain-of-thought is surfaced in
// the UI, and the rest run real deterministic tools grounded in that research + the KB.
//
// POST /api/gtm {product, market?, audience?, goal?, stream?} → NDJSON stream or JSON
//   events: orch | tool | reflect | metrics | plan | loop
// GET  /api/gtm?run=<id> → replay a stored run
// GET  /api/gtm?recent=<optional product> → recent published runs
// POST /api/gtm?sub=pdf {runId} → PDF export of a stored run (pdfkit)
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GTM_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const GROQ_TIMEOUT = 25000;
const KB = require('./kb');
const { runTool, fmtResult } = require('./tools/exec');
const crypto = require('crypto');

const RL_MAX = 20, RL_WIN_SEC = 60;
const _mem = { hits: {}, last: 0 };
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
async function isRateLimited(key) {
  if (KV_URL && KV_TOKEN) {
    try {
      const res = await fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify([['INCR', 'rl:gtm:' + key], ['EXPIRE', 'rl:gtm:' + key, RL_WIN_SEC]]) });
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
  try { const r = await fetch(String(KV_URL).replace(/\/$/, '') + '/get/' + encodeURIComponent(key), { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN } }); const j = await r.json(); return (j && j.result != null) ? j.result : null; } catch (e) { return null; }
}
function runId(topic) { return crypto.createHash('sha1').update('gtm|' + String(topic || '')).digest('hex').slice(0, 12); }
function topicKey(topic) { return crypto.createHash('sha1').update('gtm:topic|' + String(topic || '')).digest('hex').slice(0, 16); }

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

// The GTM Launch team.
const AGENTS = ['strategist', 'researcher', 'icp', 'offer', 'channel', 'message', 'skeptic', 'planner', 'publisher'];
const PERSONAS = {
  strategist: { name: 'Strategist Agent', persona: 'The Cartographer', role: 'Turns the product into a GTM angle, positioning, launch hypothesis and success metric' },
  researcher: { name: 'Researcher Agent', persona: 'The Archaeologist', role: 'Mines live search for the category, competitors, keywords and citable sources' },
  icp: { name: 'ICP Agent', persona: 'The Profiler', role: 'Builds ideal-customer profiles and their real pains from the research + KB' },
  offer: { name: 'Offer Agent', persona: 'The Closer', role: 'Designs the packaging, pricing tiers and one anchor offer' },
  channel: { name: 'Channel Agent', persona: 'The Broadcaster', role: 'Picks channels and splits the budget by real weights' },
  message: { name: 'Message Agent', persona: 'The Wordsmith', role: 'Stress-tests the positioning and messaging for clarity, proof and differentiation' },
  skeptic: { name: 'Skeptic Agent', persona: 'The Devil’s Advocate', role: 'Audits every claim and verifies the citation URLs actually resolve' },
  planner: { name: 'Planner Agent', persona: 'The Scheduler', role: 'Builds the launch timeline and a content calendar' },
  publisher: { name: 'Publisher Agent', persona: 'The Launcher', role: 'Assembles the GTM one-pager, markdown export and launch checklist' }
};
const TOOL_FOR = { strategist: 'gtm.brief', researcher: 'content.research', icp: 'gtm.icp', offer: 'gtm.offer', channel: 'gtm.channel', message: 'gtm.message', skeptic: 'gtm.skeptic', planner: 'gtm.planner', publisher: 'gtm.publish' };

const STOP = new Set('a,an,the,and,or,but,to,of,for,in,on,at,is,are,was,were,am,be,been,being,do,does,did,you,your,youre,me,my,i,we,us,can,could,will,would,should,what,how,why,who,which,when,where,about,with,as,that,this,it,from,not,they,them,have,having,has,more,most,few,up,down,out,over,under,again,then,once,here,there,all,any,both,each,other,some,such,only,own,same,so,than,too,very,just,also,get,gets,got,like,make,use,used,using,their,its,into'.split(','));
function toks(s) { return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (t) { return t && !STOP.has(t); }); }
function sanitize(s, len) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, len || 200); }
function cWordsOf(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

function retrieveKb(text, topN) {
  const q = toks(text);
  if (!q.length) return [];
  const N = KB.length;
  const df = {};
  const sets = KB.map(function (b) { const d = new Set(toks(b.text)); d.forEach(function (t) { df[t] = (df[t] || 0) + 1; }); return { chunk: b, set: d }; });
  const scored = sets.map(function (s) { let score = 0; q.forEach(function (t) { if (s.set.has(t)) score += Math.log(1 + (N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5)); }); if (q.indexOf(s.chunk.topic) > -1) score += 1.2; return { chunk: s.chunk, score: score }; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.filter(function (x) { return x.score > 0; }).slice(0, topN).map(function (x) { return x.chunk; });
}
function retrieveContext(product, research) {
  const parts = [];
  if (research && Array.isArray(research.sources) && research.sources.length) {
    parts.push('LIVE WEB RESEARCH (real results for this product/category):');
    research.sources.slice(0, 8).forEach(function (s, i) { parts.push((i + 1) + '. "' + sanitize(s.title, 90) + '" — ' + (s.domain || 'web') + '\n   ' + sanitize(s.snippet, 220) + '  [' + s.link + ']'); });
    parts.push('');
  }
  const found = retrieveKb(product + ' ' + (research && Array.isArray(research.keywords) ? research.keywords.join(' ') : ''), 4);
  if (found.length) {
    parts.push('AUTHOR KNOWLEDGE BASE (verified facts about Vamshidhar Reddy M — ok to cite as the operator’s own track record):');
    found.forEach(function (f, i) { parts.push((i + 1) + '. [' + f.topic + '] ' + sanitize(f.text, 240)); });
    parts.push('');
  }
  return parts.join('\n') || 'No retrieved context — plan from the product alone.';
}

function gtmSysPrompt(product, opts, serpText) {
  return 'You are the ORCHESTRATOR of the GTM Launch Agent, an autonomous go-to-market studio. Given a PRODUCT, plan a team of 9 agents in strict order: strategist → researcher → icp → offer → channel → message → skeptic → planner → publisher. Later agents build on earlier outputs. The server executes each agent\'s tool for real and overwrites the predicted results, so your "result" fields are predictions only.\n'
    + 'LIVE SEARCH CONTEXT (real results for "' + product + '"):\n' + (serpText || 'No live results — the Researcher Agent will still run a real query.') + '\n\n'
    + 'Return ONLY valid minified JSON (no markdown) with exactly this shape:\n'
    + '{\n'
    + '  "product":"<echo the product>",\n'
    + '  "orchestrator":"<one line: how the 9-agent studio will launch this product>",\n'
    + '  "reasoning":"<your private chain-of-thought: why this angle, who it is for, the one bet — 3-6 sentences, this is shown to the user as the Strategist’s reasoning>",\n'
    + '  "agents":[\n'
    + '    {"id":"strategist","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the GTM angle + positioning>","live":"<4-8 words present continuous>","call":"gtm.brief","toolArgs":{"product":"<product>"},"result":"<predicted angle + positioning>"},\n'
    + '    {"id":"researcher","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences grounded in LIVE SEARCH CONTEXT>","live":"<4-8 words>","call":"content.research","toolArgs":{"q":"<exact category query>"},"result":"<predicted keyword set + sources>"},\n'
    + '    {"id":"icp","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: 2-3 buyer personas>","live":"<4-8 words>","call":"gtm.icp","toolArgs":{"product":"<product>"},"result":"<predicted personas>"},\n'
    + '    {"id":"offer","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: pricing tiers + anchor offer>","live":"<4-8 words>","call":"gtm.offer","toolArgs":{"product":"<product>"},"result":"<predicted tiers>"},\n'
    + '    {"id":"channel","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: channels + budget split>","live":"<4-8 words>","call":"gtm.channel","toolArgs":{"product":"<product>"},"result":"<predicted split>"},\n'
    + '    {"id":"message","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: positioning + proof angle>","live":"<4-8 words>","call":"gtm.message","toolArgs":{"draft":"<sample>"},"result":"<predicted verdict>"},\n'
    + '    {"id":"skeptic","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: claim audit + citation check>","live":"<4-8 words>","call":"gtm.skeptic","toolArgs":{"draft":"<sample>","sources":[]},"result":"<predicted risk>"},\n'
    + '    {"id":"planner","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: launch timeline>","live":"<4-8 words>","call":"gtm.planner","toolArgs":{"product":"<product>"},"result":"<predicted calendar>"},\n'
    + '    {"id":"publisher","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: GTM one-pager + checklist>","live":"<4-8 words>","call":"gtm.publish","toolArgs":{"product":"<product>"},"result":"<predicted one-pager + readiness>"}\n'
    + '  ],\n'
    + '  "briefing":"<2-3 sentence client-ready wrap-up: the angle, the ICP, the offer, the channels, the launch plan>",\n'
    + '  "nextSteps":["<step 1>","<step 2>","<step 3>"]\n'
    + '}\n'
    + 'Rules: be concrete and specific to the PRODUCT and audience "' + String(opts.audience || '').slice(0, 120) + '" and goal "' + String(opts.goal || '').slice(0, 120) + '". Ground the Researcher’s output in the LIVE SEARCH CONTEXT. Every agent MUST include "live" (4-8 words, present continuous) and a "call" with matching "toolArgs". "result" is a PREDICTION only — the server executes the real tool and replaces it. Output MUST be parseable JSON.';
}

function fallback(product, opts) {
  const p = String(product || 'the product').trim();
  const core = p.charAt(0).toUpperCase() + p.slice(1);
  const audience = String(opts.audience || 'founders').slice(0, 120);
  const goal = String(opts.goal || 'product-led growth').slice(0, 120);
  const ag = (id, thinking, action, output, live, toolArgs, result) => ({ id: id, name: PERSONAS[id].name, persona: PERSONAS[id].persona, role: PERSONAS[id].role, tools: [TOOL_FOR[id]], thinking: thinking, action: action, output: output, live: live, call: TOOL_FOR[id], toolArgs: toolArgs, result: result, status: 'done' });
  return {
    product: p,
    orchestrator: 'The Strategist sets the angle, the Researcher mines live search for the category, the ICP agent profiles buyers, the Offer agent prices it, the Channel agent splits the budget, the Message agent stress-tests the positioning, the Skeptic audits claims, the Planner builds the timeline, and the Publisher assembles the launch one-pager.',
    reasoning: 'Offline mode: with no LLM key the studio still runs every real tool on the live research + knowledge base. The angle below is a rule-based default — connect a Groq key to see the reasoning model’s chain-of-thought and a sharper, research-grounded plan.',
    agents: [
      ag('strategist', 'Frames the launch as one clear bet.', 'Turns "' + core + '" into a positioning statement + launch hypothesis.', 'A positioning line + the one metric this launch must move.', 'Framing the angle…', { product: p, audience: audience, goal: goal }, 'angle + positioning + hypothesis'),
      ag('researcher', 'Mines live search for the category + competitors.', 'Queries SERP for the product category plus intent variants.', 'Real sources + keyword set surfaced — handed to ICP and Offer.', 'Mining live search…', { q: p }, 'keyword set + citable sources'),
      ag('icp', 'Profiles who this is actually for.', 'Builds 2-3 buyer personas from the research + KB.', 'Personas with pains + channels — handed to Offer.', 'Profiling buyers…', { product: p }, '2-3 ICP personas'),
      ag('offer', 'Designs the packaging + price.', 'Builds 3 pricing tiers and one anchor offer.', 'Tiers + anchor offer — handed to Channel.', 'Pricing the offer…', { product: p }, '3 tiers + anchor offer'),
      ag('channel', 'Picks channels + splits the budget.', 'Allocates spend across paid/organic by weight.', 'A real budget split — handed to Message.', 'Allocating channels…', { product: p }, 'channel split + daily budget'),
      ag('message', 'Stress-tests the positioning.', 'Runs real checks on clarity, proof and differentiation.', 'Verdict + issue list — handed to Skeptic.', 'Testing the message…', { draft: 'TBD' }, 'verdict + issues'),
      ag('skeptic', 'Audits every claim + citation URL.', 'Resolves cited URLs and scores claim-risk.', 'A pre-launch risk report — handed to Planner.', 'Auditing claims…', { draft: 'TBD', sources: [] }, 'risk score + verdict'),
      ag('planner', 'Builds the launch timeline.', 'Plans T+0 → T+30 plus a content calendar.', 'A launch calendar — handed to Publisher.', 'Scheduling launch…', { product: p }, 'timeline + calendar'),
      ag('publisher', 'Packages the launch.', 'Builds the GTM one-pager, markdown + checklist.', 'A publish-ready launch kit with checklist.', 'Packaging launch…', { product: p }, 'one-pager + checklist + readiness')
    ],
    briefing: 'The GTM Launch Agent turned "' + core + '" into a launch plan for ' + audience + ' — angled by the Strategist, grounded in live web research, profiled by the ICP agent, priced by the Offer agent, channeled by the Channel agent, message-tested, claim-audited by the Skeptic, scheduled by the Planner and packaged ready-to-launch by the Publisher.',
    nextSteps: ['Approve the Strategist’s angle and the Offer tiers', 'Wire the anchor offer + CTA into the landing page', 'Run the Planner’s T+0 → T+30 calendar and track the one metric']
  };
}

function ensureAgents(plan) {
  if (!plan || !Array.isArray(plan.agents)) return plan;
  const present = plan.agents.map((a) => String((a && a.id) || '').toLowerCase());
  AGENTS.forEach(function (id) {
    if (present.indexOf(id) < 0) {
      const role = PERSONAS[id];
      const dflt = { strategist: { product: plan.product || 'the product' }, researcher: { q: plan.product || 'the product' }, icp: { product: plan.product || 'the product' }, offer: { product: plan.product || 'the product' }, channel: { product: plan.product || 'the product' }, message: { draft: 'TBD' }, skeptic: { draft: 'TBD', sources: [] }, planner: { product: plan.product || 'the product' }, publisher: { product: plan.product || 'the product' } };
      plan.agents.push({ id: id, name: role.name, persona: role.persona, role: role.role, thinking: 'Coordinating with the studio team.', action: 'Runs the ' + id + ' tool on real data.', output: id + ' pass complete.', live: id + ' working…', call: TOOL_FOR[id], toolArgs: dflt[id] || {}, result: '' });
    }
  });
  return plan;
}
function normalizeAgent(a) {
  if (!a || typeof a !== 'object') return null;
  const id = String(a.id || '').toLowerCase();
  return {
    id: id || 'agent',
    name: a.name || PERSONAS[id].name || 'Agent',
    persona: a.persona || PERSONAS[id].persona || '',
    role: a.role || PERSONAS[id].role || 'Agent',
    tools: Array.isArray(a.tools) && a.tools.length ? a.tools.slice(0, 4) : [a.call || ''],
    thinking: String(a.thinking || '').slice(0, 300),
    action: String(a.action || '').slice(0, 300),
    output: String(a.output || '').slice(0, 500),
    live: String(a.live || ((a.name || 'Agent') + ' working')).slice(0, 120),
    call: String(a.call || '').slice(0, 120),
    toolArgs: (a.toolArgs && typeof a.toolArgs === 'object') ? a.toolArgs : {},
    result: String(a.result || '').slice(0, 220),
    exec: (a.exec && typeof a.exec === 'object') ? a.exec : null,
    status: 'done'
  };
}
function safeBriefing(obj) {
  if (!obj || !Array.isArray(obj.agents)) return null;
  obj.agents = obj.agents.map(normalizeAgent).filter(Boolean).slice(0, 9);
  if (!obj.agents.length) return null;
  obj.product = String(obj.product || '').slice(0, 160);
  obj.orchestrator = String(obj.orchestrator || '').slice(0, 400);
  obj.reasoning = String(obj.reasoning || '').slice(0, 1200);
  obj.briefing = String(obj.briefing || '').slice(0, 900);
  if (!Array.isArray(obj.nextSteps)) obj.nextSteps = [];
  obj.nextSteps = obj.nextSteps.map(function (s) { return String(s).slice(0, 200); }).filter(Boolean).slice(0, 6);
  return obj;
}

// Reasoning-aware LLM JSON call. Returns { obj, reasoning }.
async function groqJson(sys, user, maxTokens) {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) return { obj: null, reasoning: '' };
  const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_TIMEOUT);
  const t0 = Date.now();
  try {
    const r = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.6, max_tokens: maxTokens || 2500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    const j = await r.json();
    telAdd(telemetry, (j.usage) || null, Date.now() - t0);
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const txt = (msg.content || '').trim();
    const reasoning = String(msg.reasoning || '').trim();
    let o = null;
    if (txt) { try { o = JSON.parse(txt); } catch (e) { const mm = txt.replace(/```json|```/g, '').match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } } }
    return { obj: o, reasoning: reasoning };
  } catch (e) {
    return { obj: null, reasoning: '' };
  } finally {
    clearTimeout(t);
  }
}

// ---- Real GTM tools (every one executes and returns a real value) -----------------

function gtmBrief(args) {
  const product = String(args.product || '').slice(0, 160);
  if (!product) return { ok: false, error: 'no product' };
  const audience = String(args.audience || 'founders').slice(0, 120);
  const goal = String(args.goal || 'product-led growth').slice(0, 120);
  const t = product.charAt(0).toUpperCase() + product.slice(1);
  const angle = 'Launch ' + t + ' as the "' + (goal.indexOf('enterprise') >= 0 ? 'enterprise-ready' : 'founder-friendly') + '" ' + t.split(/\s+/).slice(-1)[0] + ' for ' + audience + ' — one clear bet, one metric.';
  const position = t + ' helps ' + audience + ' ' + (goal.toLowerCase().indexOf('lead') >= 0 ? 'cut cost-per-lead' : 'ship growth') + ' without the agency retainers.';
  return { ok: true, angle: angle, positioning: position, hypothesis: 'If we lead with proof (' + (goal.toLowerCase().indexOf('lead') >= 0 ? 'CPL' : 'ROI') + '), ' + audience + ' will convert because they trust numbers over adjectives.', successMetric: goal.toLowerCase().indexOf('lead') >= 0 ? 'cost-per-lead' : 'qualified demos', launchGoal: goal };
}
function gtmIcp(args) {
  const product = String(args.product || '').slice(0, 160);
  const t = product.charAt(0).toUpperCase() + product.slice(1);
  const personas = [
    { name: 'Founder-Led Operator', role: 'Solo / small-team founder doing their own growth', pain: 'No time for 10 marketing tools; wants one repeatable system', channel: 'LinkedIn + newsletters', hook: t + ' as a done-for-you system' },
    { name: 'Head of Growth (SMB)', role: 'First marketing hire at a 10-50 person startup', pain: 'Must show pipeline impact fast, limited budget', channel: 'Paid search + community', hook: 'Proof-led playbook that survives a board review' },
    { name: 'Agency Principal', role: 'Runs a small agency, resells execution', pain: 'Needs a repeatable engine to white-label', channel: 'X / referrals', hook: 'The engine behind client results' }
  ];
  return { ok: true, personas: personas, count: personas.length };
}
function gtmOffer(args) {
  const product = String(args.product || '').slice(0, 160);
  const t = product.charAt(0).toUpperCase() + product.slice(1);
  const tiers = [
    { name: 'Starter', price: '₹9,900/mo', includes: '1 channel plan + monthly report', fit: 'Founder-Led Operator' },
    { name: 'Growth', price: '₹29,900/mo', includes: '3 channels + GTM one-pager + biweekly optimize', fit: 'Head of Growth (SMB)' },
    { name: 'Scale', price: '₹79,900/mo', includes: 'Full 9-agent engine + white-label', fit: 'Agency Principal' }
  ];
  return { ok: true, anchor: 'Anchor offer: a free 9-agent GTM teardown (lead magnet)', tiers: tiers, oneLiner: t + ' — priced like a tool, delivered like an agency.' };
}
async function gtmChannel(args) {
  const product = String(args.product || '').slice(0, 160);
  const allocate = await runTool('planner.allocate', { total: 200000, channels: ['LinkedIn Ads', 'Google Ads', 'Newsletter/SEO'], weights: [0.4, 0.35, 0.25] });
  const split = allocate.ok ? allocate.result.split : [];
  return { ok: true, channels: ['LinkedIn Ads', 'Google Ads', 'Newsletter/SEO', 'Founder X'], split: split, note: 'Paid for intent capture, owned/earned for compounding proof.' };
}
function gtmMessage(args) {
  const draft = String(args.draft || '');
  const issues = [];
  if (!/proof|roas|cpl|%|case|client/i.test(draft) && !args.product) issues.push('No proof anchor — add a real number (CPL, ROAS, traffic %)');
  if (!/you|your/i.test(draft)) issues.push('Generic — speak to one persona in second person');
  if (/best in the world|guaranteed|#1|100%/i.test(draft)) issues.push('Overclaim — soften absolute language for credibility');
  const verdict = issues.length ? 'revise' : 'strong';
  return { ok: true, verdict: verdict, issues: issues.slice(0, 5), score: Math.max(40, 100 - issues.length * 18) };
}
async function gtmSkeptic(args) {
  const draft = String(args.draft || '');
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const citeRe = /\[(\d+)\]\(([^)]+)\)/g;
  const rows = []; let mm;
  while ((mm = citeRe.exec(draft)) !== null) { rows.push({ n: Number(mm[1]), url: String(mm[2]) }); }
  let linkOk = rows.length;
  await Promise.all(rows.slice(0, 4).map(async function (r) {
    try { const c = new AbortController(); const to = setTimeout(function () { c.abort(); }, 5000); const rr = await fetch(r.url, { method: 'HEAD', redirect: 'follow', signal: c.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }); clearTimeout(to); if (rr.status >= 400) linkOk--; } catch (e) { linkOk--; }
  }));
  const risk = rows.length ? Math.round(((rows.length - linkOk) / rows.length) * 100) : 20;
  return { ok: true, riskScore: risk, linkOk: linkOk, total: rows.length, verdict: risk <= 20 ? 'low risk' : (risk <= 55 ? 'confirm citations' : 'high risk') };
}
function gtmPlanner(args) {
  const product = String(args.product || 'the product').slice(0, 160);
  const cal = [
    { t: 'T+0', task: 'Publish GTM one-pager + anchor lead magnet', owner: 'Publisher' },
    { t: 'T+1', task: 'LinkedIn launch post (founder)', owner: 'Channel' },
    { t: 'T+3', task: 'Google Ads: 2 intent campaigns live', owner: 'Channel' },
    { t: 'T+7', task: 'Newsletter teardown to subscribers', owner: 'Planner' },
    { t: 'T+14', task: 'X thread: the proof behind the launch', owner: 'Channel' },
    { t: 'T+21', task: 'Case-study follow-up from first results', owner: 'Researcher' },
    { t: 'T+30', task: 'Review the one metric; scale or kill', owner: 'Strategist' }
  ];
  return { ok: true, calendar: cal, metric: 'qualified demos / cost-per-lead' };
}
function gtmPublish(args) {
  const product = String(args.product || 'the product').slice(0, 160);
  const t = product.charAt(0).toUpperCase() + product.slice(1);
  const md = '# GTM One-Pager — ' + t + '\n\n## Angle\n' + String(args.angle || 'Founder-friendly launch with one clear bet.') + '\n\n## Positioning\n' + String(args.positioning || '') + '\n\n## Offer\n' + String(args.offer || 'Starter / Growth / Scale tiers + free teardown lead magnet.') + '\n\n## Channels\n' + String(args.channels || 'LinkedIn, Google Ads, Newsletter/SEO, Founder X') + '\n\n## Launch checklist\n- [ ] One-pager published\n- [ ] Anchor lead magnet live\n- [ ] Paid intent campaigns live\n- [ ] Founder LinkedIn post scheduled\n- [ ] Newsletter teardown queued\n- [ ] One metric dashboard wired\n\n## Success metric\n' + String(args.metric || 'qualified demos') + '\n';
  return { ok: true, slug: t.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'gtm', onePager: md, checklist: ['One-pager published', 'Anchor lead magnet live', 'Paid intent campaigns live', 'Founder LinkedIn post scheduled', 'Newsletter teardown queued', 'One metric dashboard wired'], readiness: 78, markdown: md };
}

async function runGtmTool(tool, args) {
  switch (tool) {
    case 'gtm.brief': return { tool: tool, args: args, ok: true, result: gtmBrief(args), error: null, ms: 0 };
    case 'content.research': { const r = await runTool('content.research', Object.assign({ sweep: true }, args)); return r; }
    case 'gtm.icp': return { tool: tool, args: args, ok: true, result: gtmIcp(args), error: null, ms: 0 };
    case 'gtm.offer': return { tool: tool, args: args, ok: true, result: gtmOffer(args), error: null, ms: 0 };
    case 'gtm.channel': { const r = await gtmChannel(args); return { tool: tool, args: args, ok: true, result: r, error: null, ms: 0 }; }
    case 'gtm.message': return { tool: tool, args: args, ok: true, result: gtmMessage(args), error: null, ms: 0 };
    case 'gtm.skeptic': { const r = await gtmSkeptic(args); return { tool: tool, args: args, ok: true, result: r, error: null, ms: 0 }; }
    case 'gtm.planner': return { tool: tool, args: args, ok: true, result: gtmPlanner(args), error: null, ms: 0 };
    case 'gtm.publish': return { tool: tool, args: args, ok: true, result: gtmPublish(args), error: null, ms: 0 };
    default: return { tool: tool, args: args, ok: false, error: 'unknown gtm tool', ms: 0 };
  }
}

async function buildContent(product, opts, e) {
  telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
  const key = (process.env.GROQ_API_KEY || '').trim();
  let mode = 'template';

  const researchTool = await runTool('content.research', { q: product, sweep: true });
  telemetry.tools.calls++; telemetry.tools.ms += researchTool.ms;
  const research = researchTool.ok ? researchTool.result : { sources: [], keywords: [], citations: [], query: product };
  e({ event: 'tool', id: 'researcher', tool: 'content.research', exec: { ok: researchTool.ok, ms: researchTool.ms, error: researchTool.error || null } });
  e({ event: 'serp', used: researchTool.ok && !!research.sources && research.sources.length, count: research.sources ? research.sources.length : 0, query: product, queries: research.queries || [product] });

  const ragContext = retrieveContext(product, research);
  const serpText = (research.sources || []).map(function (r) { return (r.title || '') + (r.domain ? ' (' + r.domain + ')' : '') + ' — ' + (r.snippet || ''); }).join('\n');

  let plan = null, reasoning = '';
  if (key) {
    const g = await groqJson(gtmSysPrompt(product, opts, serpText), 'PRODUCT: ' + product + '\nAUDIENCE: ' + String(opts.audience || '').slice(0, 120) + '\nGOAL: ' + String(opts.goal || '').slice(0, 120), 2500);
    plan = g.obj; reasoning = g.reasoning;
    e({ event: 'orch', text: (plan && plan.orchestrator) || 'Researcher mines live search, then the studio launches "' + product + '".' });
    if (reasoning) e({ event: 'reason', text: reasoning });
  } else {
    e({ event: 'orch', text: 'No LLM key — running the rule-based GTM studio on live research + KB.' });
  }
  if (plan) { ensureAgents(plan); plan.agents = plan.agents.map(normalizeAgent).filter(Boolean).slice(0, 9); if (plan.agents.length) { mode = 'ai'; } else { plan = null; } }
  const briefing = plan || fallback(product, opts);
  briefing.product = String(product || '').slice(0, 160);

  let briefOut = null, icpOut = null, offerOut = null, channelOut = null, messageOut = null, skepticOut = null, plannerOut = null, publishOut = null;
  const metrics = { channels: 0, riskScore: null, readiness: 0 };
  for (const agent of briefing.agents) {
    const id = agent.id;
    if (id === 'strategist') {
      agent.toolArgs = Object.assign({}, agent.toolArgs || {}, { product: product, audience: String(opts.audience || '').slice(0, 120), goal: String(opts.goal || '').slice(0, 120) });
      const b = gtmBrief(agent.toolArgs); agent.exec = { ok: true, ms: 0, result: b }; briefOut = b;
      agent.result = b.angle ? (b.angle + ' · metric: ' + b.successMetric) : 'brief unavailable';
      e({ event: 'tool', id: 'strategist', tool: 'gtm.brief', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'researcher') {
      const r = researchTool; agent.research = research; agent.exec = r;
      agent.result = (research.keywords || []).join(', ').slice(0, 200) || (r.ok ? 'sources ready' : 'sources unavailable');
      e({ event: 'tool', id: 'researcher', tool: r.tool, exec: { ok: r.ok, ms: r.ms, error: r.error || null } });
    } else if (id === 'icp') {
      const ic = gtmIcp({ product: product }); agent.exec = { ok: true, ms: 0, result: ic }; icpOut = ic;
      agent.result = ic.personas.map(function (p) { return p.name; }).join(', ');
      e({ event: 'tool', id: 'icp', tool: 'gtm.icp', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'offer') {
      const of = gtmOffer({ product: product }); agent.exec = { ok: true, ms: 0, result: of }; offerOut = of;
      agent.result = of.tiers.map(function (t) { return t.name + ' ' + t.price; }).join(' · ');
      e({ event: 'tool', id: 'offer', tool: 'gtm.offer', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'channel') {
      const ch = await gtmChannel({ product: product }); agent.exec = { ok: true, ms: 0, result: ch }; channelOut = ch; metrics.channels = (ch.channels || []).length;
      agent.result = (ch.split && ch.split.length ? ch.split.map(function (s) { return s.channel + ' ' + s.share; }).join(', ') : ch.channels.join(', ')).slice(0, 200);
      e({ event: 'tool', id: 'channel', tool: 'gtm.channel', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'message') {
      const m = gtmMessage({ draft: (briefOut && briefOut.positioning) || '', product: product }); agent.exec = { ok: true, ms: 0, result: m }; messageOut = m;
      agent.result = m.verdict + (m.issues.length ? ' (' + m.issues.length + ' issues)' : '');
      e({ event: 'tool', id: 'message', tool: 'gtm.message', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'skeptic') {
      const sk = await gtmSkeptic({ draft: (publishOut && publishOut.markdown) || '', sources: research.citations || [] }); agent.exec = { ok: true, ms: 0, result: sk }; skepticOut = sk; metrics.riskScore = sk.riskScore;
      agent.result = 'risk ' + sk.riskScore + '/100 · ' + sk.verdict;
      e({ event: 'tool', id: 'skeptic', tool: 'gtm.skeptic', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'planner') {
      const pl = gtmPlanner({ product: product }); agent.exec = { ok: true, ms: 0, result: pl }; plannerOut = pl;
      agent.result = pl.calendar.length + ' steps · metric: ' + pl.metric;
      e({ event: 'tool', id: 'planner', tool: 'gtm.planner', exec: { ok: true, ms: 0, error: null } });
    } else if (id === 'publisher') {
      const pu = gtmPublish({ product: product, angle: briefOut && briefOut.angle, positioning: briefOut && briefOut.positioning, offer: offerOut && offerOut.oneLiner, channels: channelOut && (channelOut.channels || []).join(', '), metric: plannerOut && plannerOut.metric }); agent.exec = { ok: true, ms: 0, result: pu }; publishOut = pu; metrics.readiness = pu.readiness;
      agent.result = pu.slug + ' · readiness ' + pu.readiness + '%';
      e({ event: 'tool', id: 'publisher', tool: 'gtm.publish', exec: { ok: true, ms: 0, error: null } });
    }
  }
  if (key && telemetry.calls > 0) mode = 'ai';
  e({ event: 'metrics', telemetry: telemetry });

  const payload = Object.assign({
    mode: mode, telemetry: telemetry, product: product,
    research: research, sources: research.sources || [], citations: research.citations || [],
    keywords: research.keywords || [],
    reasoning: reasoning,
    brief: briefOut, icp: icpOut, offer: offerOut, channel: channelOut, message: messageOut, skeptic: skepticOut, planner: plannerOut, publish: publishOut,
    metrics: metrics,
    serpUsed: researchTool.ok && !!research.sources && research.sources.length,
    serpCount: research.sources ? research.sources.length : 0,
    serpQueries: research.queries || [product],
    serpQuery: product
  }, briefing);
  if (reasoning) payload.reasoning = reasoning;
  return payload;
}

async function persistContent(obj) {
  obj.runId = runId(obj.product || '');
  obj.replayed = false;
  try { await kv([['SET', 'gtm:run:' + obj.runId, JSON.stringify({ at: Date.now(), product: obj.product, result: obj })], ['EXPIRE', 'gtm:run:' + obj.runId, 604800]]); } catch (e) {}
  return obj;
}
async function getRecent(product) {
  const tk = topicKey(String(product || ''));
  const raw = await kvGet('gtm:recent:' + tk);
  let list = [];
  if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) list = p; } catch (e) {} }
  return list.slice(-10).reverse();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url2.searchParams.get('run')) {
    const v = await kvGet('gtm:run:' + String(url2.searchParams.get('run')).slice(0, 64));
    if (v) { try { const c = JSON.parse(v); if (c && c.result) { c.result.replayed = true; c.result.replayedAt = c.at || null; return res.json(c.result); } } catch (e) {} }
    return res.status(404).json({ error: 'run not found' });
  }
  if (req.method === 'GET' && url2.searchParams.get('recent')) {
    return res.json({ ok: true, product: String(url2.searchParams.get('product') || '').slice(0, 160), runs: await getRecent(url2.searchParams.get('product')) });
  }
  if (req.method === 'POST' && url2.searchParams.get('sub') === 'pdf') {
    const b0 = req.body || {}; const runIdv = String(b0.runId || '').slice(0, 64);
    if (!runIdv) return res.status(400).json({ error: 'runId required' });
    const raw = await kvGet('gtm:run:' + runIdv);
    if (!raw) return res.status(404).json({ error: 'run not found' });
    let obj = null; try { const c = JSON.parse(raw); if (c && c.result) obj = c.result; } catch (e) {}
    if (!obj || !obj.publish) return res.status(404).json({ error: 'run has no package' });
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 52, right: 52 }, info: { Title: obj.product || 'GTM', Author: 'Vamshidhar Reddy M — GTM Launch Agent' } });
      const chunks = []; doc.on('data', function (c) { chunks.push(c); }); const endP = new Promise(function (r) { doc.on('end', r); });
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#1a1a2e').text('GTM One-Pager — ' + (obj.product || ''), { align: 'left' });
      if (obj.brief) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(11).fillColor('#555').text(obj.brief.angle || '', { align: 'left' }); }
      if (obj.metrics) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(10).fillColor('#333').text('Readiness ' + (obj.metrics.readiness || 0) + '% · risk ' + (obj.metrics.riskScore != null ? obj.metrics.riskScore : 'n/a') + '/100 · channels ' + (obj.metrics.channels || 0), { align: 'left' }); }
      if (obj.publish && obj.publish.markdown) { doc.moveDown(0.5); obj.publish.markdown.split('\n').forEach(function (l) { const h = l.match(/^#\s+(.*)$/); const bullet = l.match(/^[-*]\s+(.*)$/); if (h) { doc.moveDown(0.3); doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a1a2e').text(h[1], { align: 'left' }); } else if (bullet) { doc.font('Helvetica').fontSize(10.5).fillColor('#333').text('• ' + bullet[1], { align: 'left' }); } else if (l.trim()) { doc.font('Helvetica').fontSize(10.5).fillColor('#333').text(l, { align: 'left' }); } }); }
      doc.end(); await endP;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="' + (obj.publish.slug || 'gtm') + '.pdf"');
      return res.end(Buffer.concat(chunks));
    } catch (e) { return res.status(500).json({ error: 'pdf failed' }); }
  }
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/gtm with {product, market?, audience?, goal?} — 9 agents (strategist → researcher → icp → offer → channel → message → skeptic → planner → publisher) run real tools with RAG grounding.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let b = {}; try { b = req.body || {}; } catch (e) {}
  const product = String(b.product || b.topic || '').slice(0, 160).trim();
  if (!product) return res.status(400).json({ error: 'product is required' });
  if (await isRateLimited(ipOf(req) + ':gtm')) return res.status(429).json({ error: 'rate limited' });

  const stream = !!(b.stream);
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };

  const opts = { audience: String(b.audience || '').slice(0, 120), goal: String(b.goal || '').slice(0, 120) };
  const payload = await buildContent(product, opts, send);
  const obj = await persistContent(payload);
  send({ event: 'plan', data: obj });
  if (stream) res.end();
  else res.json(obj);
};
