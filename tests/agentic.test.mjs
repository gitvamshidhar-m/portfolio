// Hermetic tests for the Hive agentic pipeline (libs/agentic.js).
// Stubs global.fetch so nothing hits the network: GROQ (SSE + json), KV REST, and SERP.
// Run: node --test tests
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);

const FAKE_RESULTS = [
  { title: 'Skincare trends 2026', link: 'https://example.com/skincare', domain: 'example.com', snippet: 'Meta (FB/IG) Ads drive skincare discovery.' },
  { title: 'D2C beauty market size', link: 'https://beauty.org/india', domain: 'beauty.org', snippet: 'India D2C beauty, big growth.' }
];

const REFLECT_JSON = '{"output":"Grounded in LIVE SERP: Meta (FB/IG) Ads and Google Shopping lead the D2C skincare plan; \u20b9180,000 funnels toward paid search + social, 12k monthly searches sized."}';
const HOOK_JSON = '{"output":"Skincare built on real search signals — launch, measure, scale."}';

let kvStore = {};
let realFetch;

function json(body) {
  return {
    ok: true, status: 200,
    json: async () => body,
    text: async () => String(body),
    body: null
  };
}

function sseStream(lines) {
  const text = lines.map((l) => 'data: ' + JSON.stringify(l) + '\n').join('') + 'data: [DONE]\n';
  const web = Readable.toWeb(Readable.from([Buffer.from(text)]));
  return { ok: true, status: 200, body: web, json: async () => ({}), text: async () => text };
}

async function fakeFetch(url, opts) {
  opts = opts || {};
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;

  if (u.includes('api.groq.com')) {
    if (body && body.stream) {
      return sseStream([
        { choices: [{ delta: { content: '{"goal":"D2C skincare launch"' } }] },
        { choices: [{ delta: { content: ',"orchestrator":"Research sizes, Strategy plans,' } }] },
        { choices: [{ delta: { content: ' Content ships, Analytics measures.","agents":[' } }] },
        { choices: [{ delta: { content: '{"id":"research","name":"Research Agent","call":"serp.search","toolArgs":{"q":"skincare india"},"output":"primary ICP","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"strategy","name":"Strategy Agent","call":"planner.allocate","toolArgs":{"total":100000,"channels":["Meta (FB/IG) Ads","Google Shopping"],"weights":[0.4,0.3]},"output":"plan","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"content","name":"Content Agent","call":"llm.draft","toolArgs":{"brief":"skincare"},"output":"copy","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"media","name":"Media Buying Agent","call":"calc.roi","toolArgs":{"revenue":300000,"spend":100000},"output":"roi","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"analytics","name":"Analytics Agent","call":"calc.cpl","toolArgs":{"spend":100000,"leads":140,"clicks":3300,"impressions":110000},"output":"kpi","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"optimizer","name":"Optimizer Agent","call":"market.sizer","toolArgs":{"searches":25000,"ctr":0.04,"conv":0.03,"aov":1500},"output":"loop","thinking":"t","action":"a","live":"l","result":"r"}],' } }] },
        { choices: [{ delta: { content: '"campaignPlan":{"channels":["Meta (FB/IG) Ads","Google Shopping"],"budget":{"total":"\u20b9100,000","split":"40/30"},"kpis":["ROAS"],"timeline":["Week 1: go"]},"summary":"plan ready"}' } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 40, completion_tokens: 60 } },
        { choices: [{ delta: {} }] }
      ]);
    }
    return json({
      choices: [{ message: { content: REFLECT_JSON } }],
      usage: { prompt_tokens: 30, completion_tokens: 25 }
    });
  }

  if (u.includes('/pipeline')) {
    const cmd = Array.isArray(body) && body[0] ? body[0] : null;
    if (cmd && cmd[0] === 'SET' && cmd[1]) kvStore[cmd[1]] = cmd[2];
    if (cmd && cmd[0] === 'INCR') return json([[1]]);
    return json([[0]]);
  }

  if (u.includes('/get/')) {
    const k = decodeURIComponent(u.split('/get/')[1] || '');
    return json(kvStore[k] != null ? { result: kvStore[k] } : {});
  }

  // SERP providers: SerpAPI / Brave / DuckDuckGo
  if (u.includes('serpapi.com') || u.includes('brave.com')) {
    return json({ organic_results: FAKE_RESULTS, data: { web: { results: FAKE_RESULTS } } });
  }
  return json({ results: [] });
}

before(() => {
  realFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  process.env.SERP_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  global.fetch = fakeFetch;
});

after(() => {
  global.fetch = realFetch;
});

function parseStreamEvents(lines) {
  return lines
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

function mockRes() {
  const lines = [];
  return {
    lines,
    _c: 200,
    setHeader () {},
    writeHead () {},
    status (c) { this._c = c; return this; },
    json (o) { lines.push(JSON.stringify(o)); return this; },
    write (s) { lines.push(s.toString()); return true; },
    end (s) { if (s) lines.push(s.toString()); return true; }
  };
}

function post(handler, body) {
  return handler({ method: 'POST', url: '/', headers: {}, body: body }, mockRes());
}

test('stream emits tool+reflect per agent and real planner split', async (t) => {
  const handler = require('../libs/agentic.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { goal: 'Launch a D2C skincare brand', budget: '1,00,000', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const tools = evs.filter((e) => e.event === 'tool');
  const reflects = evs.filter((e) => e.event === 'reflect');
  const plan = evs.find((e) => e.event === 'plan');
  assert.ok(tools.length >= 6, 'expected 6+ tool events, got ' + tools.length);
  assert.ok(reflects.length >= 6, 'expected 6+ reflect events, got ' + reflects.length);
  assert.ok(reflects.every((r) => typeof r.output === 'string' && r.output.length > 20), 'reflect outputs should be grounded text');
  assert.ok(plan, 'missing plan event');
  const st = plan.data.agents.find((a) => a.id === 'strategy');
  assert.ok(st && st.exec && st.exec.ok, 'strategy tool should have executed');
  assert.ok(Array.isArray(st.exec.result.split) && st.exec.result.split.length >= 2, 'planner split should be a real array');
  assert.equal(st.exec.result.split[0].channel, 'Meta (FB/IG) Ads');
  assert.ok(st.exec.result.split[0].amount.startsWith('₹'), 'split amounts should be real currency from the real tool');
  assert.ok(plan.data.telemetry && plan.data.telemetry.calls > 0, 'telemetry should record LLM calls');
});

test('words-streaming orch events (many small slices, not one dump)', async () => {
  const handler = require('../libs/agentic.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { goal: 'D2C skincare launch', budget: '1,00,000', stream: true } }, res);
  const evs = parseStreamEvents(res.lines).filter((e) => e.event === 'orch');
  assert.ok(evs.length >= 5, 'orchestrator should stream many word-level slices, got ' + evs.length);
  const lens = evs.map((e) => e.text.length);
  assert.ok(lens[lens.length - 1] > lens[0], 'text should grow to the full composition');
});

test('compare=1 attaches a rule-based baseline', async () => {
  const handler = require('../libs/agentic.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { goal: 'D2C skincare launch', budget: '1,00,000', stream: true, compare: true } }, res);
  const plan = parseStreamEvents(res.lines).find((e) => e.event === 'plan');
  assert.ok(plan && plan.data.fallback, 'compare mode should attach a fallback baseline');
  assert.ok(Array.isArray(plan.data.fallback.agents) && plan.data.fallback.agents.length === 6, 'fallback should be the full 6-agent rule plan');
});

test('second identical run hits composition cache, skips orchestrator stream', async () => {
  kvStore = {};
  const handler = require('../libs/agentic.js');
  const body = { goal: 'D2C skincare launch', budget: '1,00,000', stream: true, niche: 'skincare' };
  const r1 = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: body }, r1);
  const r2 = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: body }, r2);
  const e1 = parseStreamEvents(r1.lines), e2 = parseStreamEvents(r2.lines);
  const orchTexts = e1.filter((e) => e.event === 'orch').map((e) => e.text);
  const full = orchTexts.length ? orchTexts[orchTexts.length - 1] : '';
  let accParse = 'no orch';
  try { const o = JSON.parse(full); accParse = 'OK agents=' + (o.agents ? o.agents.length : '?'); } catch (e) { accParse = 'FAIL ' + e.message; }
  assert.ok(e1.filter((e) => e.event === 'orch').length > 0, 'first run should stream composition');
  assert.equal(accParse, 'OK agents=6', 'orchestrator fixture should assemble to a full 6-agent plan');
  const cacheEv = e2.find((e) => e.event === 'cache');
  assert.ok(cacheEv && cacheEv.hit === true, 'second run should emit a cache hit');
  assert.ok(e2.filter((e) => e.event === 'orch').length === 0, 'cached run should skip the orchestrator stream');
  assert.ok(e2.filter((e) => e.event === 'tool').length >= 6, 'cached run still re-executes tools live');
});

test('no key -> rule-based fallback with working tools, zero LLM calls', async () => {
  delete process.env.GROQ_API_KEY;
  kvStore = {};
  const handler = require('../libs/agentic.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { goal: 'Launch a D2C skincare brand', budget: '50,000', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const plan = evs.find((e) => e.event === 'plan');
  assert.equal(plan.data.mode, 'template');
  assert.equal(plan.data.telemetry.calls, 0, 'no key means no LLM calls metered');
  assert.ok(evs.filter((e) => e.event === 'tool').length >= 6, 'tools still execute (llm.draft falls back to a real rule line)');
});

test('follow/section never wipe campaignPlan even if the model drops it', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  const realFetch2 = global.fetch;
  kvStore['agentic:run:mergetest'] = JSON.stringify({
    at: Date.now(),
    plan: {
      goal: 'Launch D2C skincare',
      orchestrator: 'Research sizes.',
      agents: [{ id: 'research', name: 'Research Agent', platform: 1 }, { id: 'strategy', name: 'Strategy Agent', exec: { ok: true, result: { split: [{ channel: 'Meta', share: '50%' }] } } }],
      campaignPlan: { channels: ['Meta Ads', 'Google'], budget: { total: '₹100k', split: '50/50' }, kpis: ['ROAS'], timeline: ['Week 1: go'] },
      summary: 'plan ready'
    }
  });
  // Model reply that accidentally drops campaignPlan/budget — the bug in the field.
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/pipeline')) {
      const body = JSON.parse(opts.body || '[]'); const out = [];
      for (const cmd of Array.isArray(body) ? body : []) {
        if (cmd[0] === 'GET') out.push([kvStore[cmd[1]] != null ? kvStore[cmd[1]] : null]);
        else if (cmd[0] === 'SET') { kvStore[cmd[1]] = cmd[2]; out.push(['OK']); }
        else if (cmd[0] === 'INCR') out.push([[1]]);
        else out.push(['OK']);
      }
      return { ok: true, json: async () => out };
    }
    if (u.includes('/get/')) { const k = decodeURIComponent(u.split('/get/')[1] || ''); return { ok: true, json: async () => (kvStore[k] != null ? { result: kvStore[k] } : {}) }; }
    if (u.includes('kv.example.com')) { return { ok: true, json: async () => ({ ok: true }) }; }
    if (u.includes('api.groq.com')) {
      const bad = { answer: 'done.', plan: { goal: 'x', agents: [{ id: 'research', name: 'Research Agent' }] } };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(bad) } }] }) };
    }
    return { json: async () => ({}) };
  };
  const handler = require('../libs/agentic.js');
  await handler({ method: 'POST', url: '/?sub=follow', headers: {}, body: { runId: 'mergetest', question: '3 headlines', lang: 'en' } }, mockRes());
  const stored = JSON.parse(kvStore['agentic:run:mergetest']);
  const cp = stored.plan.campaignPlan;
  assert.ok(Array.isArray(cp.channels) && cp.channels.length === 2, 'channels must survive (got ' + JSON.stringify(cp.channels) + ')');
  assert.ok(cp.budget && cp.budget.total, 'budget must survive');
  assert.ok(Array.isArray(cp.kpis) && cp.kpis.length, 'kpis must survive');
  assert.ok(Array.isArray(cp.timeline) && cp.timeline.length, 'timeline must survive');
  const strat = stored.plan.agents.find((a) => a.id === 'strategy');
  assert.ok(strat && strat.exec && strat.exec.ok, 'tool exec proof must survive');
  global.fetch = realFetch2;
});