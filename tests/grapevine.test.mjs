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
        { choices: [{ delta: { content: '{"id":"escalate","name":"Escalate Agent","call":"grapevine.escalate","toolArgs":{},"output":"queue","thinking":"t","action":"a","live":"l","result":"r"}],' } }] },
        { choices: [{ delta: { content: '"briefing":"watching the brand, mixed sentiment","nextSteps":["approve replies"]}' } }] },
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
  assert.ok(tools.length >= 5, 'expected 5+ tool events, got ' + tools.length);
  assert.ok(reflects.length >= 5, 'expected 5+ reflect events, got ' + reflects.length);
  assert.ok(plan, 'missing plan event');
  assert.ok(Array.isArray(plan.data.agents) && plan.data.agents.length === 5, 'briefing should have 5 agents');
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
  // Agent cards keep their real exec proof.
  const mon = d.agents.find((a) => a.id === 'monitor');
  assert.ok(mon && mon.exec && mon.exec.ok, 'monitor tool exec proof should be attached');
  assert.ok(d.telemetry && d.telemetry.tools.calls >= 5, 'telemetry should count the executed tools');
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
  assert.ok(evs.filter((e) => e.event === 'tool').length >= 5, 'tools still execute (respond falls back to templates)');
  assert.ok(Array.isArray(plan.data.mentions) && plan.data.mentions.length >= 1, 'monitor still scans real SERP without a key');
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
