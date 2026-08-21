// Content Engine — an autonomous 9-agent content studio powered by RAG.
// Given a topic, nine agents work in sequence: strategist → researcher → writer → editor →
// skeptic → seo → connector → publisher → amplifier. Every agent's tool really executes: the
// Strategist turns the topic into a brief, the Researcher runs a live
// SERP query and returns real sources/citations, the Writer drafts the piece
// grounded in RAG (retrieved SERP snippets + the author's knowledge base), the
// Editor runs real editorial checks over the actual draft, the Skeptic audits every
// claim and verifies the citation URLs resolve, the SEO agent computes
// a real on-page score from the actual text/meta, the Connector maps internal links,
// and the Publisher assembles a
// publish-ready package (slug, meta title/description, markdown export, readiness) while
// the Amplifier plans distribution.
//
// POST /api/content  {topic, audience?, voice?, keywords?, wordCount?, stream?} → NDJSON stream or JSON
//   events: orch | tool | reflect | metrics | plan | loop
// GET  /api/content?run=<id> → replay a stored run
// GET  /api/content?recent=<optional topic> → recent published runs
// POST /api/content?sub=pdf {runId} → PDF export of a stored run (pdfkit)
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const GROQ_TIMEOUT = 20000;
const KB = require('./kb');
const { serp } = require('./tools/serp');
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
        body: JSON.stringify([['INCR', 'rl:content:' + key], ['EXPIRE', 'rl:content:' + key, RL_WIN_SEC]])
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
function runId(topic) { return crypto.createHash('sha1').update('content|' + String(topic || '')).digest('hex').slice(0, 12); }
function topicKey(topic) { return crypto.createHash('sha1').update('content:topic|' + String(topic || '')).digest('hex').slice(0, 16); }

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

// The Content Engine team: strategist → researcher → writer → editor → skeptic →
// seo → connector → publisher → amplifier.
const AGENTS = ['strategist', 'researcher', 'writer', 'editor', 'skeptic', 'seo', 'connector', 'publisher', 'amplifier'];
const PERSONAS = {
  strategist: { name: 'Strategist Agent', persona: 'The Cartographer', role: 'Turns the raw topic into a client-ready brief — angle, intent, pillars, CTA, distribution' },
  researcher: { name: 'Researcher Agent', persona: 'The Archaeologist', role: 'Mines live search for angles, keywords and citable sources' },
  writer: { name: 'Writer Agent', persona: 'The Wordsmith', role: 'Drafts the piece grounded in retrieved research + knowledge base' },
  editor: { name: 'Editor Agent', persona: 'The Fact-Checker', role: 'Reviews the draft over the real sources — structure, length, claims' },
  skeptic: { name: 'Skeptic Agent', persona: 'The Devil\u2019s Advocate', role: 'Audits every cited claim and verifies the citation URLs actually resolve' },
  seo: { name: 'SEO Agent', persona: 'The Ranker', role: 'Scores on-page SEO from the actual title, headings and meta' },
  connector: { name: 'Connector Agent', persona: 'The Linker', role: 'Maps internal links from the piece to portfolio content + the knowledge base' },
  publisher: { name: 'Publisher Agent', persona: 'The Launcher', role: 'Assembles the publish-ready package — slug, meta, markdown export' },
  amplifier: { name: 'Amplifier Agent', persona: 'The Distributor', role: 'Builds the distribution plan — schedule, hashtags, newsletter excerpt' }
};
const TOOL_FOR = { strategist: 'content.brief', researcher: 'content.research', writer: 'content.draft', editor: 'content.edit', skeptic: 'content.skeptic', seo: 'content.seo', connector: 'content.linker', publisher: 'content.publish', amplifier: 'content.amplify' };

// --- RAG: stopwords + keyword mining + knowledge-base retrieval -----------------

const STOP = new Set('a,an,the,and,or,but,to,of,for,in,on,at,is,are,was,were,am,be,been,being,do,does,did,you,your,youre,me,my,i,we,us,can,could,will,would,should,what,how,why,who,which,when,where,about,with,as,that,this,it,from,not,they,them,have,having,has,more,most,few,up,down,out,over,under,again,then,once,here,there,all,any,both,each,other,some,such,only,own,same,so,than,too,very,just,also,get,gets,got,like,make,use,used,using,their,its,into,tell,were,been,being'.split(','));

function toks(s) { return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (t) { return t && !STOP.has(t); }); }
function sanitize(s, len) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, len || 200); }
function cWordsOf(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }

// Keyword mining over real SERP titles+snippets: weighted frequency of 1-2 word n-grams.
function mineKeywords(docs, topN) {
  const unigram = {}, bigram = {};
  (docs || []).slice(0, 8).forEach(function (d) {
    const t = toks((d.title || '') + ' ' + (d.snippet || ''));
    t.forEach(function (w) { unigram[w] = (unigram[w] || 0) + 1; });
    for (let i = 0; i < t.length - 1; i++) { const b = t[i] + ' ' + t[i + 1]; bigram[b] = (bigram[b] || 0) + 1; }
  });
  const base = Math.max(2, (docs || []).length);
  const unis = Object.keys(unigram).map(function (w) { return { k: w, n: unigram[w] / base }; });
  const bis = Object.keys(bigram).map(function (b) { return { k: b, n: (bigram[b] / Math.max(1, base - 1)) * 1.6 }; });
  return unis.concat(bis).sort(function (a, b) { return b.n - a.n; }).slice(0, 8).map(function (x) { return x.k; });
}

// Knowledge-base retrieval with the same TF-IDF scoring used by the RAG chat.
function retrieveKb(text, topN) {
  const q = toks(text);
  if (!q.length) return [];
  const N = KB.length;
  const df = {};
  const sets = KB.map(function (b) {
    const d = new Set(toks(b.text));
    d.forEach(function (t) { df[t] = (df[t] || 0) + 1; });
    return { chunk: b, set: d };
  });
  const scored = sets.map(function (s) {
    let score = 0;
    q.forEach(function (t) { if (s.set.has(t)) score += Math.log(1 + (N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5)); });
    if (q.indexOf(s.chunk.topic) > -1) score += 1.2;
    return { chunk: s.chunk, score: score };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.filter(function (x) { return x.score > 0; }).slice(0, topN).map(function (x) { return x.chunk; });
}

// RAG context that grounds the Writer/Editor/SEO agents: live SERP snippets first,
// then the author's knowledge-base facts that overlap the topic (the portfolio KB).
function retrieveContext(topic, research) {
  const parts = [];
  if (research && Array.isArray(research.sources) && research.sources.length) {
    parts.push('LIVE WEB RESEARCH (real search results for this topic):');
    research.sources.slice(0, 8).forEach(function (s, i) {
      parts.push((i + 1) + '. "' + sanitize(s.title, 90) + '" — ' + (s.domain || 'web') + '\n   ' + sanitize(s.snippet, 220) + '  [' + s.link + ']');
    });
    parts.push('');
  }
  const found = retrieveKb(topic + ' ' + (research && Array.isArray(research.keywords) ? research.keywords.join(' ') : ''), 4);
  if (found.length) {
    parts.push('AUTHOR KNOWLEDGE BASE (verified facts about Vamshidhar Reddy M, ok to cite as the author\'s own track record):');
    found.forEach((f, i) => { parts.push((i + 1) + '. [' + f.topic + '] ' + sanitize(f.text, 240)); });
    parts.push('');
  }
  return parts.join('\n') || 'No retrieved context — write from the topic alone.';
}

// --- Orchestrator plan -----------------------------------------------------------

function contentSysPrompt(topic, opts, serpText) {
  return 'You are the ORCHESTRATOR of the Content Engine, an autonomous content studio. Given a TOPIC, plan a team of 9 agents that works in strict order: strategist → researcher → writer → editor → skeptic → seo → connector → publisher → amplifier. Later agents build on earlier outputs. The server executes each agent\'s tool for real and overwrites the predicted results, so your "result" fields are predictions only.\n'
    + 'LIVE SEARCH CONTEXT (real results for "' + topic + '"):\n' + (serpText || 'No live results — the Researcher Agent will still run a real query.') + '\n\n'
    + 'Return ONLY valid minified JSON (no markdown) with exactly this shape:\n'
    + '{\n'
    + '  "topic":"<echo the topic>",\n'
    + '  "orchestrator":"<one line: how the 9-agent studio will produce the piece>",\n'
    + '  "agents":[\n'
    + '    {"id":"strategist","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the angle, intent and CTA of the brief>","live":"<4-8 words present continuous>","call":"content.brief","toolArgs":{"topic":"<topic>"},"result":"<predicted brief: angle + pillars>"},\n'
    + '    {"id":"researcher","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences grounded in the LIVE SEARCH CONTEXT — name real sources/angles>","live":"<4-8 words present continuous>","call":"content.research","toolArgs":{"q":"<exact topic query>"},"result":"<predicted keyword set + sources>"},\n'
    + '    {"id":"writer","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the piece it will draft and its angle>","live":"<4-8 words>","call":"content.draft","toolArgs":{"topic":"<topic>","audience":"<audience>","voice":"<voice>","wordCount":<target words>},"result":"<predicted title + section plan>"},\n'
    + '    {"id":"editor","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: what editorial checks it will run over the draft>","live":"<4-8 words>","call":"content.edit","toolArgs":{"draft":"<sample>","keywords":[]},"result":"<predicted issues + verdict>"},\n'
    + '    {"id":"skeptic","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: adversarial claim audit + citation verification>","live":"<4-8 words>","call":"content.skeptic","toolArgs":{"draft":"<sample>","sources":[]},"result":"<predicted risk score + verdict>"},\n'
    + '    {"id":"seo","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the on-page metrics it will score>","live":"<4-8 words>","call":"content.seo","toolArgs":{"draft":"<sample>","title":"<predicted title>"},"result":"<predicted score 0-100>"},\n'
    + '    {"id":"connector","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the internal link graph it will map>","live":"<4-8 words>","call":"content.linker","toolArgs":{"draft":"<sample>","topic":"<topic>"},"result":"<predicted internal links>"},\n'
    + '    {"id":"publisher","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the publish-ready package it will assemble>","live":"<4-8 words>","call":"content.publish","toolArgs":{"draft":"<sample>","title":"<predicted title>"},"result":"<predicted slug + readiness>"},\n'
    + '    {"id":"amplifier","thinking":"<1 sentence>","action":"<1 sentence>","output":"<1-2 sentences: the distribution plan it will build>","live":"<4-8 words>","call":"content.amplify","toolArgs":{"title":"<predicted title>","slug":"<predicted slug>"},"result":"<predicted schedule + hashtags>"}\n'
    + '  ],\n'
    + '  "briefing":"<2-3 sentence client-ready wrap-up: the angle, the editorial+Skeptic verdicts, the SEO score, readiness to publish and the distribution plan>",\n'
    + '  "nextSteps":["<step 1>","<step 2>","<step 3>"]\n'
    + '}\n'
    + 'Rules: be concrete and specific to the TOPIC and audience "' + String(opts.audience || '').slice(0, 120) + '" and voice "' + String(opts.voice || '').slice(0, 120) + '". Ground the Researcher\'s output in the LIVE SEARCH CONTEXT (name real domains/angles you see there). Every agent MUST include "live" (4-8 words, present continuous) and a "call" with matching "toolArgs". "result" is a PREDICTION only — the server executes the real tool and replaces it. Output MUST be parseable JSON.';
}

function fallback(topic, opts) {
  const t = String(topic || 'the topic').trim();
  const core = t.charAt(0).toUpperCase() + t.slice(1);
  const audience = String(opts.audience || opts.aud || 'marketers').slice(0, 120);
  const voice = String(opts.voice || opts.tone || 'clear and direct').slice(0, 120);
  const ag = (id, thinking, action, output, live, toolArgs, result) => ({ id: id, name: PERSONAS[id].name, persona: PERSONAS[id].persona, role: PERSONAS[id].role, tools: [TOOL_FOR[id]], thinking: thinking, action: action, output: output, live: live, call: TOOL_FOR[id], toolArgs: toolArgs, result: result, status: 'done' });
  const wc = Math.max(300, Math.min(2400, Number(opts.wordCount) || 900));
  return {
    topic: t,
    orchestrator: 'The Strategist briefs the angle, the Researcher mines live search for sources and citations, the Writer drafts a piece grounded in that research, the Editor fact-checks it, the Skeptic audits every claim and citation URL, the SEO agent scores on-page optimization, the Connector maps internal links, the Publisher assembles the publish-ready package, and the Amplifier plans distribution.',
    agents: [
      ag('strategist', 'Front-loads the brief: angle, search intent, audience framing, CTA, distribution.', 'Turns "' + core + '" into a client-ready brief for the whole team.', 'A brief with angle + pillars handed to Researcher and Writer.', 'Briefing the piece…', { topic: t, audience: audience, voice: voice }, 'angle + pillars + CTA'),
      ag('researcher', 'Mines live search for the angles, keywords and citable sources behind "' + core + '".', 'Queries SERP for the topic plus intent variants.', 'Real sources + keyword set surfaced — handed to Writer.', 'Mining live search…', { q: t }, 'keyword set + citable sources'),
      ag('writer', 'Drafts the piece in a ' + voice + ' voice for ' + audience + '.', 'Writes a structured draft grounded in the brief, retrieved research and the author\'s knowledge base.', 'A ' + wc + '-word structured draft handed to Editor.', 'Drafting the piece…', { topic: t, audience: audience, voice: voice, wordCount: wc }, 'structured draft + title'),
      ag('editor', 'Checks the draft for structure, length and claims.', 'Runs real editorial checks over the actual draft text against the cited sources.', 'Verdict + issue list handed to the Skeptic agent.', 'Reviewing the draft…', { draft: 'TBD', keywords: [] }, 'verdict + issue list'),
      ag('skeptic', 'Audits every cited claim and verifies citation URLs.', 'Scans the inline citations, resolves the URLs for real and scores the claim-risk.', 'A pre-publish risk report handed to the SEO agent.', 'Auditing claims…', { draft: 'TBD', sources: [] }, 'risk score + verdict'),
      ag('seo', 'Scores the on-page optimization of the real draft.', 'Measures title length, meta, headings, keyword placement and readability against the actual text.', 'A real 0-100 on-page score handed to Connector.', 'Scoring on-page SEO…', { draft: 'TBD', title: 'TBD' }, 'SEO score + checklist'),
      ag('connector', 'Maps internal links to portfolio content.', 'Matches the draft against the knowledge base and builds a link graph.', 'Internal link suggestions handed to Publisher.', 'Linking related content…', { draft: 'TBD', topic: t }, 'internal link graph'),
      ag('publisher', 'Packages the piece for publishing.', 'Builds the slug, meta title/description, markdown export (with citations + internal links) and readiness verdict.', 'A publish-ready package with export handed to Amplifier.', 'Packaging for publish…', { draft: 'TBD', title: 'TBD' }, 'slug + meta + readiness'),
      ag('amplifier', 'Plans distribution for the finished piece.', 'Builds a schedule, per-platform formatting, hashtags and a newsletter excerpt.', 'A distribution plan handed back to you.', 'Planning distribution…', { title: 'TBD', slug: 'TBD' }, 'schedule + hashtags + excerpt')
    ],
    briefing: 'The Content Engine turned "' + core + '" into a ' + voice + ' ' + wc + '-word piece for ' + audience + ' — briefed by the Strategist, grounded in live web research, fact-checked by the Editor, claim-audited by the Skeptic, scored for on-page SEO, internally linked by the Connector, packaged ready to publish by the Publisher and scheduled for distribution by the Amplifier.',
    nextSteps: ['Approve the Strategist\'s angle and the Editor/Skeptic verdicts', 'Add internal links and a call-to-action in the CMS', 'Publish the markdown export and run the Amplifier\'s distribution schedule']
  };
}

function ensureAgents(plan) {
  if (!plan || !Array.isArray(plan.agents)) return plan;
  const present = plan.agents.map((a) => String((a && a.id) || '').toLowerCase());
  AGENTS.forEach(function (id) {
    if (present.indexOf(id) < 0) {
      const role = PERSONAS[id];
      const dflt = { strategist: { topic: plan.topic || 'the topic' }, researcher: { q: plan.topic || 'the topic' }, writer: { topic: plan.topic || 'the topic' }, editor: { draft: 'TBD', keywords: [] }, skeptic: { draft: 'TBD', sources: [] }, seo: { draft: 'TBD', title: 'TBD' }, connector: { draft: 'TBD', topic: plan.topic || 'the topic' }, publisher: { draft: 'TBD', title: 'TBD' }, amplifier: { title: 'TBD', slug: 'TBD' } };
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
  obj.topic = String(obj.topic || '').slice(0, 160);
  obj.orchestrator = String(obj.orchestrator || '').slice(0, 400);
  obj.briefing = String(obj.briefing || '').slice(0, 900);
  if (!Array.isArray(obj.nextSteps)) obj.nextSteps = [];
  obj.nextSteps = obj.nextSteps.map(function (s) { return String(s).slice(0, 200); }).filter(Boolean).slice(0, 6);
  return obj;
}

// Lightweight reflection: one LLM pass grounding each agent's output in its real tool result.
async function reflectAgent(agent, exec, key) {
  if (!key || !exec || !exec.ok) return;
  const sys = 'You are ' + (agent.name || 'an agent') + ' in the Content Engine. Your tool just returned REAL output. Rewrite your handoff "output" (1-2 sentences) grounded strictly in that real return — name the actual numbers, scores, word counts or domains. No hype, no emojis. Return ONLY JSON: {"output":"..."}';
  const user = 'TOOL: ' + exec.tool + '\nREAL RESULT:\n' + fmtResult(exec).slice(0, 900);
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 8000);
    const t0 = Date.now();
    const r = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.4, max_tokens: 140, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    clearTimeout(t);
    const j = await r.json();
    telAdd(telemetry, (j.usage) || null, Date.now() - t0);
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null; try { o = JSON.parse(txt); } catch (e) { const mm = txt.match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    if (o && o.output) agent.output = String(o.output).slice(0, 500);
    agent.reflection = { passes: 1 };
  } catch (e) {}
}

async function groqJson(sys, user, maxTokens) {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) return null;
  const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, GROQ_TIMEOUT);
  const t0 = Date.now();
  try {
    const r = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.6, max_tokens: maxTokens || 700, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] }) });
    const j = await r.json();
    telAdd(telemetry, (j.usage) || null, Date.now() - t0);
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null; try { o = JSON.parse(txt); } catch (e) { const mm = (txt.replace(/```json|```/g, '')).match(/\{[\s\S]*\}/); if (mm) { try { o = JSON.parse(mm[0]); } catch (e2) {} } }
    return o;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ---- The real pipeline -----------------------------------------------------------

async function buildContent(topic, opts, e) {
  telemetry = { calls: 0, prompt: 0, completion: 0, ms: 0, cost: 0, tools: { calls: 0, ms: 0 } };
  const key = (process.env.GROQ_API_KEY || '').trim();
  const target = Math.max(300, Math.min(2400, Number(opts.wordCount) || 900));
  let mode = 'template';

  // 1) Real research first, so the writer/editor/seo are grounded in live results (RAG).
  //    sweep:true runs intent variants (topic + guide + benchmark) and merges results.
  const researchTool = await runTool('content.research', { q: topic, sweep: true });
  telemetry.tools.calls++; telemetry.tools.ms += researchTool.ms;
  const research = researchTool.ok ? researchTool.result : { sources: [], keywords: [], citations: [], query: topic };
  e({ event: 'tool', id: 'researcher', tool: 'content.research', exec: { ok: researchTool.ok, ms: researchTool.ms, error: researchTool.error || null } });
  e({ event: 'serp', used: researchTool.ok && !!research.sources && research.sources.length, count: research.sources ? research.sources.length : 0, query: topic, queries: research.queries || [topic] });

  // RAG context: live SERP snippets + knowledge-base facts for this topic.
  const ragContext = retrieveContext(topic, research);
  const serpText = (research.sources || []).map(function (r) { return (r.title || '') + (r.domain ? ' (' + r.domain + ')' : '') + ' — ' + (r.snippet || ''); }).join('\n');

  // 2) Orchestrator plan.
  let plan = null;
  if (key) {
    plan = await groqJson(contentSysPrompt(topic, opts, serpText), 'TOPIC: ' + topic + '\nAUDIENCE: ' + String(opts.audience || '').slice(0, 120) + '\nVOICE: ' + String(opts.voice || '').slice(0, 120) + '\nTARGET LENGTH: ~' + target + ' words', 1400);
    let acc = '';
    e({ event: 'orch', text: (plan && plan.orchestrator) || 'Researcher mines real search for "' + topic + '", Writer drafts, Editor reviews, SEO scores, Publisher packages.' });
  } else {
    e({ event: 'orch', text: 'No LLM key — running the rule-based studio: research → draft → edit → seo → publish.' });
  }
  if (plan) { ensureAgents(plan); plan.agents = plan.agents.map(normalizeAgent).filter(Boolean).slice(0, 9); if (plan.agents.length) { mode = 'ai'; } else { plan = null; } }
  const briefing = plan || fallback(topic, opts);
  briefing.topic = String(topic || '').slice(0, 160); // honor the real request topic, not the plan's echo

  // 3) Execution loop — every agent's tool really runs, in order, feeding the next.
  //    The Researcher already ran up front (needed to ground the plan + RAG), so its
  //    real result is adopted here rather than re-run.
  let metrics = { wordCount: 0, seoScore: 0, readiness: 0, citations: (research.citations || []).length, fixes: 0, converged: false, riskScore: null };
  let draft = ''; let title = ''; let editorOut = null; let seoOut = null; let publishOut = null;
  let briefOut = null; let skepticOut = null; let connectorOut = null; let amplifierOut = null;
  const briefCtx = function () {
    if (!briefOut) return '';
    return '\nSTRATEGIST BRIEF (the angle the Writer must honor):\nAngle: ' + String(briefOut.angle || '').slice(0, 300) + '\nIntent: ' + String(briefOut.intent || '') + '\nPillars (suggested structure):\n- ' + (Array.isArray(briefOut.pillars) ? briefOut.pillars.join('\n- ') : '') + '\nCTA: ' + String(briefOut.cta || '');
  };
  for (const agent of briefing.agents) {
    const id = agent.id;
    if (id === 'strategist') {
      agent.toolArgs = Object.assign({}, agent.toolArgs || {}, { topic: topic, audience: String(opts.audience || '').slice(0, 120), voice: String(opts.voice || '').slice(0, 120), keywords: (research.keywords || []).slice(0, 5) });
      const b = await runTool('content.brief', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += b.ms;
      agent.exec = b; briefOut = b.ok ? b.result : null;
      agent.result = briefOut ? (briefOut.angle || '').slice(0, 120) + ' · intent ' + briefOut.intent : 'brief unavailable';
      e({ event: 'tool', id: 'strategist', tool: b.tool, exec: { ok: b.ok, ms: b.ms, error: b.error || null } });
      await reflectAgent(agent, b, key);
      if (agent.reflection) e({ event: 'reflect', id: 'strategist', output: agent.output, passes: 1 });
    } else if (id === 'researcher') {
      agent.toolArgs = Object.assign({}, agent.toolArgs, { q: topic });
      const r = researchTool;
      agent.title = research.title || '';
      agent.research = research;
      agent.exec = r;
      agent.result = (research.keywords || []).join(', ').slice(0, 200) || (r.ok ? 'sources ready' : 'sources unavailable');
      e({ event: 'tool', id: 'researcher', tool: r.tool, exec: { ok: r.ok, ms: r.ms, error: r.error || null } });
      await reflectAgent(agent, r, key);
      if (agent.reflection) e({ event: 'reflect', id: 'researcher', output: agent.output, passes: 1 });
    } else if (id === 'writer') {
      const kw = (research.keywords || []).slice(0, 5);
      agent.toolArgs = Object.assign({}, agent.toolArgs, { topic: topic, audience: String(opts.audience || '').slice(0, 120), voice: String(opts.voice || '').slice(0, 120), keywords: kw, context: ragContext + briefCtx(), wordCount: target });
      const w = await runTool('content.draft', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += w.ms;
      agent.exec = w;
      agent.result = (w.ok && w.result && w.result.title) ? (w.result.title + ' · ' + (w.result.sections || []).length + ' sections') : (fmtResult(w) || 'draft unavailable');
      if (w.ok && w.result) {
        draft = w.result.draft || draft;
        title = w.result.title || title;
        metrics.wordCount = (draft || '').trim().split(/\s+/).filter(Boolean).length;
      }
      e({ event: 'tool', id: 'writer', tool: w.tool, exec: { ok: w.ok, ms: w.ms, error: w.error || null, wc: metrics.wordCount } });
      await reflectAgent(agent, w, key);
      if (agent.reflection) e({ event: 'reflect', id: 'writer', output: agent.output, passes: 1 });
    } else if (id === 'editor') {
      // Agentic fix loop: review the draft; if it fails, feed the editor's issues back
      // to the Writer (with the prior draft) and re-review — up to MAX_FIX passes.
      const MAX_FIX = 2, PASS_THRESHOLD = 75;
      let fixPass = 0, converged = false;
      const review = async function (feed) {
        if (feed) {
          const wAg = briefing.agents.find(function (a) { return a.id === 'writer'; });
          const wArgs = Object.assign({}, agent.toolArgs || {}, wAg ? wAg.toolArgs || {} : {}, {
            topic: topic, audience: String(opts.audience || '').slice(0, 120), voice: String(opts.voice || '').slice(0, 120),
            keywords: (research.keywords || []).slice(0, 5), context: ragContext + briefCtx(), wordCount: target,
            feedback: feed, draft: draft
          });
          const w = await runTool('content.draft', wArgs);
          telemetry.tools.calls++; telemetry.tools.ms += w.ms;
          e({ event: 'tool', id: 'writer', tool: w.tool, exec: { ok: w.ok, ms: w.ms, error: w.error || null, wc: w.ok && w.result ? cWordsOf(w.result.draft) : 0, pass: fixPass } });
          if (w.ok && w.result) {
            draft = w.result.draft || draft;
            title = w.result.title || title;
            metrics.wordCount = cWordsOf(draft);
            const w2 = briefing.agents.find(function (a) { return a.id === 'writer'; });
            if (w2) { w2.exec = w; w2.result = (w.result.title || title) + ' · feedback pass ' + fixPass; }
          }
        }
        const edArgs = Object.assign({}, agent.toolArgs || {}, { draft: draft, keywords: (research.keywords || []).slice(0, 6), sources: research.citations || [] });
        const ed = await runTool('content.edit', edArgs);
        telemetry.tools.calls++; telemetry.tools.ms += ed.ms;
        e({ event: 'tool', id: 'editor', tool: ed.tool, exec: { ok: ed.ok, ms: ed.ms, error: ed.error || null, pass: fixPass } });
        return ed;
      };
      let ed = await review(null);
      while (fixPass < MAX_FIX && ed.ok && ed.result && (!(ed.result.score >= PASS_THRESHOLD)) && ed.result.issues && ed.result.issues.length) {
        fixPass++;
        let issues = ed.result.issues.slice(0, 4);
        if (ed.result.claimCoverage && ed.result.claimCoverage.passRate < 55) issues = issues.concat('Ground more claims in the cited sources — the editor could only trace ' + ed.result.claimCoverage.passRate + '% of body sentences to a source.');
        e({ event: 'loop', pass: fixPass, id: 'writer', issues: issues });
        ed = await review(issues);
      }
      converged = !!(ed.ok && ed.result && ed.result.score >= PASS_THRESHOLD);
      agent.exec = ed; editorOut = ed.ok ? ed.result : null;
      agent.fixPasses = fixPass; agent.converged = converged;
      metrics.fixes = fixPass; metrics.converged = converged;
      agent.result = ed.ok ? (fmtResult(ed) || 'review complete') : 'review skipped';
      e({ event: 'tool', id: 'editor', tool: ed.tool, exec: { ok: ed.ok, ms: ed.ms, error: ed.error || null, final: true, score: ed.ok ? ed.result.score : null } });
      await reflectAgent(agent, ed, key);
      if (agent.reflection) e({ event: 'reflect', id: 'editor', output: agent.output, passes: 1 });
    } else if (id === 'skeptic') {
      agent.toolArgs = Object.assign({}, agent.toolArgs || {}, { draft: draft, sources: research.citations || [] });
      const sk = await runTool('content.skeptic', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += sk.ms;
      agent.exec = sk; skepticOut = sk.ok ? sk.result : null;
      metrics.riskScore = (skepticOut && skepticOut.riskScore) || null;
      agent.result = skepticOut ? ('risk ' + skepticOut.riskScore + '/100 · ' + (skepticOut.linkOk || 0) + '/' + (skepticOut.total || 0) + ' citations verified') : 'audit skipped';
      e({ event: 'tool', id: 'skeptic', tool: sk.tool, exec: { ok: sk.ok, ms: sk.ms, error: sk.error || null } });
      await reflectAgent(agent, sk, key);
      if (agent.reflection) e({ event: 'reflect', id: 'skeptic', output: agent.output, passes: 1 });
    } else if (id === 'seo') {
      agent.toolArgs = Object.assign({}, agent.toolArgs, { draft: draft, title: title, keywords: (research.keywords || []).slice(0, 6) });
      const so = await runTool('content.seo', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += so.ms;
      agent.exec = so; seoOut = so.ok ? so.result : null;
      metrics.seoScore = (seoOut && seoOut.score) || 0;
      agent.result = seoOut ? (seoOut.score + '/100 · ' + (seoOut.passes || 0) + ' checks passed') : 'score unavailable';
      e({ event: 'tool', id: 'seo', tool: so.tool, exec: { ok: so.ok, ms: so.ms, error: so.error || null } });
      await reflectAgent(agent, so, key);
      if (agent.reflection) e({ event: 'reflect', id: 'seo', output: agent.output, passes: 1 });
    } else if (id === 'connector') {
      agent.toolArgs = Object.assign({}, agent.toolArgs || {}, { draft: draft, topic: topic });
      const lk = await runTool('content.linker', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += lk.ms;
      agent.exec = lk; connectorOut = lk.ok ? lk.result : null;
      agent.result = (connectorOut && connectorOut.links && connectorOut.links.length) ? (connectorOut.links.length + ' internal links mapped: ' + connectorOut.links.map(function (x) { return x.url; }).join(', ')) : 'no internal links matched';
      e({ event: 'tool', id: 'connector', tool: lk.tool, exec: { ok: lk.ok, ms: lk.ms, error: lk.error || null } });
      await reflectAgent(agent, lk, key);
      if (agent.reflection) e({ event: 'reflect', id: 'connector', output: agent.output, passes: 1 });
    } else if (id === 'publisher') {
      const meta = (seoOut && (seoOut.metaTitle || seoOut.metaDesc)) ? seoOut : {};
      agent.toolArgs = Object.assign({}, agent.toolArgs, { draft: draft, title: title, keywords: (research.keywords || []).slice(0, 6), sources: research.citations || [], metaTitle: meta.metaTitle || '', metaDesc: meta.metaDesc || '', seoScore: metrics.seoScore });
      const p = await runTool('content.publish', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += p.ms;
      agent.exec = p; publishOut = p.ok ? p.result : null;
      metrics.readiness = (publishOut && publishOut.ready) || 0;
      if (publishOut && connectorOut && Array.isArray(connectorOut.links) && connectorOut.links.length) {
        publishOut.markdown += '\n\n## Related on this site\n' + connectorOut.links.map(function (l) { return '- [' + (l.anchor || l.url) + '](' + l.url + ')'; }).join('\n');
        publishOut.internalLinks = connectorOut.links;
      }
      agent.result = publishOut ? (publishOut.slug + ' · ' + publishOut.readingMin + ' min read · ready ' + publishOut.ready + '%') : 'package unavailable';
      e({ event: 'tool', id: 'publisher', tool: p.tool, exec: { ok: p.ok, ms: p.ms, error: p.error || null } });
      await reflectAgent(agent, p, key);
      if (agent.reflection) e({ event: 'reflect', id: 'publisher', output: agent.output, passes: 1 });
    } else if (id === 'amplifier') {
      agent.toolArgs = Object.assign({}, agent.toolArgs || {}, { title: title || topic, slug: (publishOut && publishOut.slug) || 'article', keywords: (research.keywords || []).slice(0, 4), readingMin: (publishOut && publishOut.readingMin) || 5, variants: (publishOut && publishOut.variants) || {} });
      const am = await runTool('content.amplify', agent.toolArgs);
      telemetry.tools.calls++; telemetry.tools.ms += am.ms;
      agent.exec = am; amplifierOut = am.ok ? am.result : null;
      agent.result = amplifierOut ? (amplifierOut.schedule.length + ' distribution steps · ' + amplifierOut.hashtags.join(' ')) : 'plan unavailable';
      e({ event: 'tool', id: 'amplifier', tool: am.tool, exec: { ok: am.ok, ms: am.ms, error: am.error || null } });
      await reflectAgent(agent, am, key);
      if (agent.reflection) e({ event: 'reflect', id: 'amplifier', output: agent.output, passes: 1 });
    }
  }

  // Live LLM flag: the badge shows LIVE LLM whenever the orchestrator plan OR the
  // writer/reflection passes actually hit Groq — not only when the plan JSON parsed.
  if (key && telemetry.calls > 0) mode = 'ai';
  e({ event: 'metrics', telemetry: telemetry });

  const payload = Object.assign({
    mode: mode, telemetry: telemetry, topic: topic, targetWords: target,
    research: research, sources: research.sources || [], citations: research.citations || [],
    keywords: research.keywords || [],
    draft: draft, title: title,
    brief: briefOut, editor: editorOut, skeptic: skepticOut, seo: seoOut, connector: connectorOut, publish: publishOut, amplifier: amplifierOut,
    variants: (publishOut && publishOut.variants) || null,
    inlineCitations: (publishOut && publishOut.inlineCitations) || 0,
    metrics: metrics,
    loop: { fixes: metrics.fixes || 0, converged: !!metrics.converged, threshold: 75, max: 2 },
    serpUsed: researchTool.ok && !!research.sources && research.sources.length,
    serpCount: research.sources ? research.sources.length : 0,
    serpQueries: research.queries || [topic],
    serpQuery: topic
  }, briefing);
  return payload;
}

async function persistContent(obj) {
  obj.runId = runId(obj.topic || '');
  obj.replayed = false;
  const tk = topicKey(obj.topic || '');
  try { kv([['SET', 'content:run:' + obj.runId, JSON.stringify({ at: Date.now(), topic: obj.topic, result: obj })], ['EXPIRE', 'content:run:' + obj.runId, 604800]]); } catch (e) {}
  try {
    const prev = await getRecent(obj.topic);
    const recent = [{ runId: obj.runId, at: Date.now(), title: obj.title, seoScore: (obj.seo && obj.seo.score) || 0, readiness: (obj.publish && obj.publish.ready) || 0, topic: obj.topic }].concat(prev);
    await kv([['SET', 'content:recent:' + tk, JSON.stringify(recent.slice(0, 10))], ['EXPIRE', 'content:recent:' + tk, 604800 * 4]]);
  } catch (e) {}
  return obj;
}

async function getRecent(topic) {
  const tk = topicKey(String(topic || ''));
  const raw = await kvGet('content:recent:' + tk);
  let list = [];
  if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p)) list = p; } catch (e) {} }
  return list.slice(-10).reverse();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'GET' && url2.searchParams.get('run')) {
    const v = await kvGet('content:run:' + String(url2.searchParams.get('run')).slice(0, 64));
    if (v) {
      try {
        const c = JSON.parse(v);
        if (c && c.result) { c.result.replayed = true; c.result.replayedAt = c.at || null; return res.json(c.result); }
      } catch (e) {}
    }
    return res.status(404).json({ error: 'run not found' });
  }
  if (req.method === 'GET' && url2.searchParams.get('recent')) {
    return res.json({ ok: true, topic: String(url2.searchParams.get('topic') || '').slice(0, 160), runs: await getRecent(url2.searchParams.get('topic')) });
  }
  if (req.method === 'POST' && url2.searchParams.get('sub') === 'pdf') {
    const b0 = req.body || {};
    const runId = String(b0.runId || '').slice(0, 64);
    if (!runId) return res.status(400).json({ error: 'runId required' });
    const raw = await kvGet('content:run:' + runId);
    if (!raw) return res.status(404).json({ error: 'run not found' });
    let obj = null;
    try { const c = JSON.parse(raw); if (c && c.result) obj = c.result; } catch (e) {}
    if (!obj || !obj.draft) return res.status(404).json({ error: 'run has no draft' });
    try {
      const PDFDocument = require('pdfkit');
      const d = String(obj.draft || '');
      const title = String(obj.title || obj.topic || 'Content Engine').slice(0, 120);
      const metaTitle = (obj.publish && obj.publish.metaTitle) ? String(obj.publish.metaTitle).slice(0, 100) : title;
      const metaDesc = (obj.publish && obj.publish.metaDesc) ? String(obj.publish.metaDesc).slice(0, 170) : '';
      const slug = (obj.publish && obj.publish.slug) ? String(obj.publish.slug).slice(0, 80) : 'content';
      const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 52, right: 52 }, info: { Title: title, Author: 'Vamshidhar Reddy M — Content Engine', Subject: metaTitle } });
      const chunks = [];
      doc.on('data', function (c) { chunks.push(c); });
      const endP = new Promise(function (resolve) { doc.on('end', resolve); });
      // Cover: title + meta + metrics.
      doc.font('Helvetica-Bold').fontSize(22).fillColor('#1a1a2e').text(title, { align: 'left' });
      doc.moveDown(0.3);
      doc.font('Helvetica').fontSize(11).fillColor('#555').text((obj.metrics && obj.metrics.wordCount ? obj.metrics.wordCount + ' words' : '') + ' · ' + (obj.seo ? ('SEO ' + (obj.seo.score || 0) + '/100') : '') + ' · ' + (obj.publish ? ('ready ' + (obj.publish.ready || 0) + '%') : '') + ' · ' + (obj.loop ? (obj.loop.fixes + ' fix pass(es)') : ''), { align: 'left' });
      if (metaDesc) { doc.moveDown(0.4); doc.font('Helvetica-Oblique').fontSize(11).fillColor('#333').text(metaDesc, { align: 'left' }); }
      doc.moveDown(0.5);
      if ((obj.variants && obj.variants.linkedin) || (obj.variants && obj.variants.thread)) {
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a1a2e').text('Platform variants');
        doc.moveDown(0.25);
        if (obj.variants.linkedin) { doc.font('Helvetica-Bold').fontSize(10).fillColor('#0a66c2').text('LinkedIn'); doc.moveDown(0.15); doc.font('Helvetica').fontSize(10).fillColor('#333').text(String(obj.variants.linkedin).slice(0, 600), { align: 'left' }); }
        if (obj.variants.thread) { doc.moveDown(0.5); doc.font('Helvetica-Bold').fontSize(10).fillColor('#010409').text('X thread'); doc.moveDown(0.15); doc.font('Helvetica').fontSize(10).fillColor('#333').text(String(obj.variants.thread).slice(0, 800), { align: 'left' }); }
        doc.moveDown(1);
      }
      // Body: markdown → simple PDF lines (headings get the H-n font size bump).
      const lines = String(d).split('\n');
      lines.forEach(function (l) {
        const h = l.match(/^(#{1,3})\s+(.*)$/);
        const bullet = l.match(/^([-*])\s+(.*)$/);
        const t = l.trim();
        if (h) {
          doc.moveDown(0.35);
          doc.font('Helvetica-Bold').fontSize(h[1].length === 1 ? 17 : (h[1].length === 2 ? 14 : 12)).fillColor('#1a1a2e').text(String(h[2]).replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'), { align: 'left' });
          doc.moveDown(0.2);
        } else if (bullet) {
          doc.font('Helvetica').fontSize(10.5).fillColor('#333').text('•  ' + String(bullet[2]).replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'), { align: 'left', lineGap: 1 });
        } else if (t && !/^---/.test(t)) {
          doc.font('Helvetica').fontSize(10.5).fillColor('#333').text(t.replace(/\*\*/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'), { align: 'left', lineGap: 2 });
        } else if (!t) {
          doc.moveDown(0.25);
        }
      });
      // Sources footer.
      if (obj.citations && obj.citations.length) {
        doc.moveDown(0.6);
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#1a1a2e').text('Sources');
        doc.moveDown(0.2);
        obj.citations.slice(0, 6).forEach(function (s, i) {
          doc.font('Helvetica').fontSize(9.5).fillColor('#444').text((i + 1) + '. ' + ((s.title || 'source') + ' — ' + (s.link || s.domain || '')), { align: 'left' });
        });
      }
      doc.end();
      await endP;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="' + slug + '.pdf"');
      return res.end(Buffer.concat(chunks));
    } catch (e) {
      return res.status(500).json({ error: 'pdf generation failed' });
    }
  }
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/content with {topic, audience?, voice?, keyword?, wordCount?, stream?} — 9 agents (strategist → researcher → writer → editor → skeptic → seo → connector → publisher → amplifier) run real tools with RAG grounding.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const topic = String(b.topic || b.query || '').slice(0, 160).trim();
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  if (await isRateLimited(ipOf(req) + ':content')) return res.status(429).json({ error: 'rate limited' });

  const stream = !!(b.stream);
  if (stream) res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  const send = function (obj) { if (stream) res.write(JSON.stringify(obj) + '\n'); };

  const opts = {
    audience: String(b.audience || b.aud || '').slice(0, 120),
    voice: String(b.voice || b.tone || '').slice(0, 120),
    wordCount: Number(b.wordCount) || 0
  };
  const payload = await buildContent(topic, opts, send);
  const obj = await persistContent(payload);
  send({ event: 'plan', data: obj });
  if (stream) res.end();
  else res.json(obj);
};