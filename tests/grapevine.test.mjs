// Hermetic tests for the Grapevine reputation pipeline (libs/grapevine.js).
// Stubs global.fetch so nothing hits the network: GROQ (SSE + json), KV REST, and SERP.
// Run: node --test tests
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';

const require = createRequire(import.meta.url);

const FAKE_RESULTS = [
  { title: 'Worst customer service ever - complaint about the brand', link: 'https://reddit.example.com/t1', domain: 'reddit.example.com', snippet: 'terrible support, slow refund, never again.' },
  { title: 'Amazing product, love it', link: 'https://x.example.com/t2', domain: 'x.example.com', snippet: 'great quality and fast delivery.' },
  { title: 'Just a normal mention of the brand', link: 'https://web.example.com/t3', domain: 'web.example.com', snippet: 'heard about the brand recently.' }
];

const REFLECT_JSON = '{"output":"Grounded in the LIVE scan: Reddit carries the loudest negative mention (complaint, refund), X is positive, sentiment split is mixed."}';

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
        { choices: [{ delta: { content: '{"brand":"the brand","orchestrator":"Monitor sweeps, Classify tags, Crisis scores, Respond drafts, Escalate queues.",' } }] },
        { choices: [{ delta: { content: '"agents":[' } }] },
        { choices: [{ delta: { content: '{"id":"monitor","name":"Monitor Agent","call":"grapevine.scan","toolArgs":{"q":"the brand review"},"output":"mentions found","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"classify","name":"Classify Agent","call":"grapevine.sentiment","toolArgs":{"mentions":[]},"output":"tags","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"crisis","name":"Crisis Agent","call":"grapevine.crisis","toolArgs":{},"output":"score","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"respond","name":"Respond Agent","call":"grapevine.respond","toolArgs":{"text":"x","sentiment":"negative"},"output":"replies","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"escalate","name":"Escalate Agent","call":"grapevine.escalate","toolArgs":{},"output":"queue","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"concierge","name":"Concierge Agent","call":"grapevine.rescue","toolArgs":{},"output":"rescues","thinking":"t","action":"a","live":"l","result":"r"},' } }] },
        { choices: [{ delta: { content: '{"id":"prophet","name":"Prophet Agent","call":"grapevine.predict","toolArgs":{},"output":"forecast","thinking":"t","action":"a","live":"l","result":"r"}],' } }] },
        { choices: [{ delta: { content: '"briefing":"watching the brand, mixed sentiment","nextSteps":["approve replies"]}' } }] },
        { choices: [{ delta: {} }], usage: { prompt_tokens: 40, completion_tokens: 60 } },
        { choices: [{ delta: {} }] }
      ]);
    }
    // Route the two new AI passes (topic tagging + brand-safety critic) to realistic mocks.
    const sysMsg = (body && body.messages && body.messages[0] && body.messages[0].content) || '';
    if (sysMsg.indexOf('tag brand-mention topics') >= 0) {
      return json({ choices: [{ message: { content: JSON.stringify({ topics: ['refund', 'shipping', 'praise'] }) } }], usage: { prompt_tokens: 12, completion_tokens: 8 } });
    }
    if (sysMsg.indexOf('brand-safety reviewer') >= 0) {
      const m = (body.messages && body.messages[1] && body.messages[1].content) || '';
      const ready = m.indexOf('averagely') >= 0 ? 'flagged' : 'post';
      return json({ choices: [{ message: { content: JSON.stringify({ ready: ready, risk: ready === 'flagged' ? 'high' : 'low', reason: ready === 'flagged' ? 'names a competitor negatively' : '' }) } }], usage: { prompt_tokens: 10, completion_tokens: 14 } });
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

test('stream emits tool+reflect per agent and a briefing plan', async (t) => {
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const tools = evs.filter((e) => e.event === 'tool');
  const reflects = evs.filter((e) => e.event === 'reflect');
  const plan = evs.find((e) => e.event === 'plan');
  assert.ok(tools.length >= 7, 'expected 7+ tool events, got ' + tools.length);
  assert.ok(reflects.length >= 7, 'expected 7+ reflect events, got ' + reflects.length);
  assert.ok(plan, 'missing plan event');
  assert.ok(Array.isArray(plan.data.agents) && plan.data.agents.length === 7, 'briefing should have 7 agents');
  assert.ok(plan.data.brand === 'the brand', 'brand should be echoed');
  assert.ok(Array.isArray(plan.data.nextSteps), 'nextSteps should be an array');
});

test('real tools execute and the briefing carries classified mentions + crisis + queue', async () => {
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const plan = evs.find((e) => e.event === 'plan');
  const d = plan.data;
  // Monitor fed real SERP into the pipeline.
  assert.ok(d.serpUsed, 'live SERP should have been used');
  assert.ok(Array.isArray(d.mentions) && d.mentions.length >= 2, 'monitor scan should return real mentions');
  // Classify ran for real: tally present.
  assert.ok(d.tally && typeof d.tally.negative === 'number', 'sentiment tally should be computed for real');
  // Crisis ran for real: score 0-100.
  assert.ok(d.crisis && d.crisis.score >= 0 && d.crisis.score <= 100, 'crisis score should be computed');
  // Respond produced drafts.
  assert.ok(Array.isArray(d.drafts) && d.drafts.length >= 1 && d.drafts[0].reply, 'replies should be drafted');
  // Escalate built a queue for the negative mention.
  assert.ok(Array.isArray(d.queue), 'escalation queue should be an array');
  // Concierge moved the real P0/P1 escalations into a private rescue channel with an SLA.
  assert.ok(Array.isArray(d.rescues), 'concierge rescues should be an array');
  d.rescues.forEach((r) => {
    assert.ok(r.priority, 'each rescue carries a priority');
    assert.ok(r.dm || r.text, 'each rescue carries a DM message');
    assert.ok(r.sla, 'each rescue carries an SLA window');
  });
  // Prophet ran a real regression over watch history + the current score.
  assert.ok(d.forecast && d.forecast.trend, 'prophet forecast should carry a trend');
  assert.ok(['rising', 'cooling', 'flat'].indexOf(d.forecast.trend) >= 0, 'trend is a known class');
  assert.ok(Array.isArray(d.forecast.horizon) && d.forecast.horizon.length === 4, 'forecast projects 4 day-points');
  assert.ok(typeof d.forecast.r2 === 'number' && d.forecast.confidence >= 0 && d.forecast.confidence <= 92, 'regression fit carries r2 + confidence');
  // Agent cards keep their real exec proof.
  const mon = d.agents.find((a) => a.id === 'monitor');
  assert.ok(mon && mon.exec && mon.exec.ok, 'monitor tool exec proof should be attached');
  const con = d.agents.find((a) => a.id === 'concierge');
  assert.ok(con && con.exec && con.exec.ok, 'concierge tool exec proof should be attached');
  assert.ok(d.telemetry && d.telemetry.tools.calls >= 7, 'telemetry should count the executed tools');
});

test('no key -> rule-based fallback with working tools, zero LLM calls', async () => {
  delete process.env.GROQ_API_KEY;
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const plan = evs.find((e) => e.event === 'plan');
  assert.equal(plan.data.mode, 'template');
  assert.equal(plan.data.telemetry.calls, 0, 'no key means no LLM calls metered');
  assert.ok(evs.filter((e) => e.event === 'tool').length >= 7, 'tools still execute (respond falls back to templates)');
  assert.ok(Array.isArray(plan.data.mentions) && plan.data.mentions.length >= 1, 'monitor still scans real SERP without a key');
});

test('AI passes: topics are tagged and each draft is critic-checked', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand', stream: true } }, res);
  const plan = parseStreamEvents(res.lines).find((e) => e.event === 'plan').data;
  assert.ok(plan.topics && Array.isArray(plan.topics.top) && plan.topics.top.length >= 1, 'topic tagging should attach a top-topics list');
  const first = plan.topics.top[0];
  assert.ok(typeof first.topic === 'string' && typeof first.n === 'number', 'each topic carries a label + count');
  assert.ok(Array.isArray(plan.drafts) && plan.drafts.length >= 1, 'drafts exist to review');
  plan.drafts.forEach((dd) => {
    assert.ok(dd.critic && dd.critic.ready, 'every draft should carry a critic verdict');
    assert.ok(['post', 'review', 'flag'].indexOf(dd.critic.ready) >= 0, 'verdict is a known class');
  });
});

test('validation: missing brand is rejected', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { stream: true } }, res);
  const line = parseStreamEvents(res.lines)[0] || JSON.parse(res.lines[0] || '{}');
  assert.ok(String(res.lines[0] || '').indexOf('brand is required') >= 0, 'missing brand should 400');
});

test('stored briefing replays via GET ?run=', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand' } }, res);
  const j = JSON.parse(res.lines[0]);
  assert.ok(j.runId, 'runId should be returned');
  const key = 'grapevine:run:' + j.runId;
  assert.ok(kvStore[key], 'briefing should persist to KV');
  const r2 = mockRes();
  await handler({ method: 'GET', url: '/?run=' + j.runId, headers: {} }, r2);
  const replayed = JSON.parse(r2.lines[0]);
  assert.equal(replayed.brand, 'the brand', 'replay should return the stored briefing');
  assert.ok(replayed.replayed === true, 'replay flag should be set');
});

test('history series + trend persist per brand across runs', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');

  async function runOnce() {
    const res = mockRes();
    await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand' } }, res);
    return JSON.parse(res.lines[0]);
  }

  const first = await runOnce();
  assert.ok(Array.isArray(first.history) && first.history.length === 1, 'first run seeds history with one point');
  assert.ok(first.history[0].score != null && first.history[0].level, 'history point carries score + level');
  assert.equal(first.trend, null, 'no trend until a second watch exists');

  const second = await runOnce();
  assert.ok(second.history.length === 2, 'second run appends to history');
  assert.ok(second.trend && typeof second.trend.delta === 'number', 'trend delta computed vs previous watch');
  assert.ok(typeof second.trend.prevScore === 'number', 'trend exposes the previous score');
});

test('GET ?recent=1 lists past runs and GET ?hist=1 returns the series', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand' } }, res);
  const run = JSON.parse(res.lines[0]);

  const r2 = mockRes();
  await handler({ method: 'GET', url: '/?brand=the%20brand&recent=1', headers: {} }, r2);
  const recent = JSON.parse(r2.lines[0]);
  assert.ok(recent.ok === true, 'recent endpoint ok');
  assert.ok(Array.isArray(recent.runs) && recent.runs.some((x) => x.runId === run.runId), 'recent includes the just-run id');
  assert.ok(recent.runs[0].at, 'recent entries carry a timestamp');

  const r3 = mockRes();
  await handler({ method: 'GET', url: '/?brand=the%20brand&hist=1', headers: {} }, r3);
  const hist = JSON.parse(r3.lines[0]);
  assert.ok(Array.isArray(hist.history) && hist.history.length >= 1, 'hist endpoint returns points');
});

test('competitor vs mode adds a share-of-voice block', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand', vs: 'rival brand' } }, res);
  const d = JSON.parse(res.lines[0]);
  assert.ok(d.vs, 'vs block should be present');
  assert.equal(d.vs.competitor, 'rival brand', 'competitor name echoed');
  assert.ok(typeof d.vs.sov === 'number' && d.vs.sov >= 0 && d.vs.sov <= 100, 'share of voice is a 0-100 number');
  assert.ok(d.vs.brand && d.vs.competitor && typeof d.vs.brand.mentions === 'number', 'both mention counts present');
});

test('per-platform sweep populates platform metadata from site-scoped SERP', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { brand: 'the brand', platform: ['reddit'], stream: true } }, res);
  const plan = parseStreamEvents(res.lines).find((e) => e.event === 'plan').data;
  assert.ok(Array.isArray(plan.serpQueries) && plan.serpQueries.length >= 2, 'sweep runs a general query + a site-scoped query');
  assert.ok(plan.serpQueries.some((q) => String(q).indexOf('site:reddit.com') >= 0), 'reddit platform should be site-scoped');
  assert.ok(plan.serpUsed, 'live SERP should have been used in the sweep');
});

test('schedule a daily watch and run the cron runner', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/?sub=schedule', headers: {}, body: { brand: 'the brand', hours: 24 } }, res);
  const sj = JSON.parse(res.lines[0]);
  assert.ok(sj.ok && sj.scheduled, 'schedule endpoint ok');

  const list = mockRes();
  await handler({ method: 'GET', url: '/?watches=1', headers: {} }, list);
  const wl = JSON.parse(list.lines[0]);
  assert.ok(wl.watches.some((w) => w.brand === 'the brand'), 'watches list includes the brand');

  const cron = mockRes();
  await handler({ method: 'GET', url: '/?cron=1', headers: { 'x-vercel-cron': '1' } }, cron);
  const r = JSON.parse(cron.lines[0]);
  assert.ok(r.ok === true, 'cron runner ok');
  assert.ok(Array.isArray(r.results), 'cron returns result list');
  assert.ok(r.results.length >= 1, 'cron runs the due watch');
  assert.ok(r.results[0].brand === 'the brand', 'cron ran the scheduled brand');
});

test('cron is unauthorized without a secret/header', async () => {
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'GET', url: '/?cron=1', headers: {} }, res);
  assert.equal(res._c, 401, 'cron should 401 without auth');
});

test('POST ?sub=approve persists a human verdict to KV', async () => {
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/grapevine.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/?sub=approve', headers: {}, body: { brand: 'the brand', runId: 'run123', index: 0, reply: 'great, we will fix it', verdict: 'approved' } }, res);
  const r = JSON.parse(res.lines[0]);
  assert.ok(r.ok && r.approval, 'approve endpoint returns the stored verdict');
  assert.equal(r.approval.verdict, 'approved', 'verdict echoed');

  const list = mockRes();
  await handler({ method: 'GET', url: '/?brand=the%20brand&approvals=1', headers: {} }, list);
  const ap = JSON.parse(list.lines[0]);
  assert.ok(ap.approvals.length >= 1 && ap.approvals[0].runId === 'run123', 'approval persisted and retrievable');
});
