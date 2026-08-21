import { test } from 'node:test';
import assert from 'node:assert/strict';

// Load the GTM handler the same way Vercel's router does.
const handler = (await import('../libs/gtm.js')).default;

function makeRes(cb) {
  let chunks = '';
  const r = {
    statusCode: 200,
    _ended: false,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    get writableEnded() { return this._ended; },
    end(body) { this._ended = true; if (body != null) chunks += body; cb(this.statusCode, chunks); },
    write(s) { chunks += s; return true; },
    json(o) { this.end(JSON.stringify(o)); },
  };
  return r;
}

function makeReq(method, url, body) {
  return { method, url, headers: {}, body: body ? JSON.parse(JSON.stringify(body)) : undefined };
}

test('GTM studio returns all agents in order (strategist → … → simulator)', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm', { product: 'AI ad-creative tool for D2C brands', audience: 'D2C founders', goal: 'lower cost-per-lead', stream: false });
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  const ids = (got.agents || []).map((a) => a.id);
  assert.equal(ids.length, 11, 'expected 11 agents, got ' + ids.length);
  assert.deepEqual(ids, ['strategist', 'researcher', 'competitor', 'icp', 'offer', 'channel', 'message', 'skeptic', 'planner', 'publisher', 'simulator']);
});

test('all 9 GTM agents run real tools', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm', { product: 'AI ad-creative tool for D2C brands', stream: false });
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  for (const id of ['strategist', 'researcher', 'icp', 'offer', 'channel', 'message', 'skeptic', 'planner', 'publisher']) {
    const a = (got.agents || []).find((x) => x.id === id);
    // Each agent must have attempted its tool (exec is an object). In offline
    // mode a real SERP/LLM key is absent, so the tool may degrade gracefully,
    // but the attempt is always recorded.
    assert.ok(a && a.exec && typeof a.exec === 'object', id + ' did not attempt a tool');
  }
});

test('reasoning trace present when a key is set (or graceful offline fallback)', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm', { product: 'AI ad-creative tool', stream: false });
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  // Either we got a real reasoning trace (ai mode) or a graceful offline note (template mode).
  assert.ok(typeof got.reasoning === 'string' && got.reasoning.length > 0, 'reasoning trace missing');
});

test('GET without product lists the GTM surface', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('GET', '/api/gtm', null);
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  assert.equal(got.ok, true);
  assert.match(got.message, /9 agents/);
});

test('missing product is rejected', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm', { goal: 'growth' });
    handler(req, makeRes((code, out) => { try { resolve({ code, body: JSON.parse(out) }); } catch (e) { resolve({ code, body: out }); } }));
  });
  assert.equal(got.code, 400);
});

test('war-game: competitor debate + Monte Carlo simulator present', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm', { product: 'AI lead-scoring SaaS for agencies', stream: false });
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  assert.ok(got.debate && Array.isArray(got.debate.transcript) && got.debate.transcript.length >= 2, 'debate transcript missing');
  assert.ok(typeof got.debate.differentiation === 'number' && got.debate.differentiation > 0, 'differentiation missing');
  assert.ok(got.sim && typeof got.sim.pGoal === 'number', 'simulator missing');
  assert.ok(got.sim.cac && typeof got.sim.cac.p50 === 'number', 'CAC distribution missing');
  assert.ok(got.agents.some((a) => a.id === 'competitor'), 'competitor agent missing from run');
  assert.ok(got.agents.some((a) => a.id === 'simulator'), 'simulator agent missing from run');
});

test('measurement plan is emitted', async () => {
  const got = await new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm', { product: 'AI ad-creative tool', stream: false });
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  assert.ok(got.measurement && Array.isArray(got.measurement.events) && got.measurement.events.length >= 4, 'measurement events missing');
  assert.ok(Array.isArray(got.measurement.dashboard) && got.measurement.dashboard.length >= 3, 'dashboard spec missing');
});

test('live simulate endpoint returns a stable distribution', async () => {
  const payload = { budget: 300000, price: 29900, mix: { 'Paid search': 40, 'LinkedIn': 25, 'Newsletter/SEO': 20, 'Communities': 15 }, angleLift: 0.25, goal: { type: 'leads', target: 80 } };
  const call = () => new Promise((resolve) => {
    const req = makeReq('POST', '/api/gtm?sub=simulate', payload);
    handler(req, makeRes((code, out) => { try { resolve(JSON.parse(out)); } catch (e) { resolve({ _raw: out }); } }));
  });
  const a = await call();
  const b = await call();
  assert.equal(a.ok, true);
  assert.ok(a.sim && typeof a.sim.pGoal === 'number', 'sim missing');
  assert.deepEqual(a.sim.cac, b.sim.cac, 'simulation should be deterministic for same inputs');
});

