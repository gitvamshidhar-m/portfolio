// Hermetic tests for the competitor-watch API (libs/watch.js).
// Stubs fetch so nothing hits the network. Run: node --test tests
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let kvStore = {};
let realFetch;

function json(o) { return { ok: true, json: async () => o }; }

before(() => {
  realFetch = global.fetch;
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  global.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/pipeline')) {
      const body = JSON.parse((opts && opts.body) || '[]');
      const out = [];
      for (const cmd of Array.isArray(body) ? body : []) {
        if (cmd[0] === 'GET') out.push([kvStore[cmd[1]] != null ? kvStore[cmd[1]] : null]);
        else if (cmd[0] === 'SET') { kvStore[cmd[1]] = cmd[2]; out.push(['OK']); }
        else if (cmd[0] === 'INCR') out.push([[1]]);
        else out.push(['OK']);
      }
      return json(out);
    }
    if (u.includes('/get/')) {
      const k = decodeURIComponent(u.split('/get/')[1] || '');
      return json(kvStore[k] != null ? { result: kvStore[k] } : {});
    }
    if (u.includes('/set/')) {
      const m = u.match(/\/set\/([^?]+)\?value=(.*)$/);
      if (m) kvStore[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
      return json({ ok: true });
    }
    return json({ ok: true });
  };
});

after(() => { global.fetch = realFetch; });

function mockRes() {
  const lines = [];
  return {
    lines, statusCode: 200,
    setHeader () {}, writeHead () {},
    status (c) { this.statusCode = c; return this; },
    json (o) { lines.push(JSON.stringify(o)); return this; },
    write () { return true; },
    end () { return true; }
  };
}

function call(handler, method, url, headers, body) {
  return handler({ method, url, headers: headers || {}, body: body || undefined }, mockRes());
}

test('POST write actions require WATCH_ADMIN_TOKEN when set', async () => {
  process.env.WATCH_ADMIN_TOKEN = 's3cret';
  const handler = require('../libs/watch.js');
  const unauthorized = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { action: 'add', query: 'skincare india' } }, unauthorized);
  assert.equal(unauthorized.statusCode, 401, 'no token -> 401');
  assert.ok(unauthorized.lines[0].indexOf('unauthorized') >= 0);

  const bad = mockRes();
  await handler({ method: 'POST', url: '/', headers: { 'x-watch-token': 'wrong' }, body: { action: 'add', query: 'skincare india' } }, bad);
  assert.equal(bad.statusCode, 401, 'wrong token -> 401');

  const ok = mockRes();
  await handler({ method: 'POST', url: '/', headers: { authorization: 'Bearer s3cret' }, body: { action: 'add', query: 'skincare india' } }, ok);
  assert.equal(ok.statusCode, 200, 'correct bearer token -> allowed');
  const stored = JSON.parse(kvStore['watch:queries']);
  assert.ok(stored.indexOf('skincare india') >= 0, 'query should be persisted');
  delete process.env.WATCH_ADMIN_TOKEN;
});

test('GET stays open (reads are public) and returns last check', async () => {
  delete process.env.WATCH_ADMIN_TOKEN;
  kvStore['watch:last'] = JSON.stringify({ at: 1700000000000, results: [{ query: 'skincare india', results: 10, newCompetitors: ['rival.com'], moves: ['x.com: 1 → #5'] }] });
  const handler = require('../libs/watch.js');
  const res = mockRes();
  await handler({ method: 'GET', url: '/', headers: {}, body: undefined }, res);
  const j = JSON.parse(res.lines[0]);
  assert.ok(Array.isArray(j.queries), 'queries list should be present');
  assert.ok(j.last && j.last.at, 'last check should be present for the UI');
});

test('cron with no secret accepts x-vercel-cron header', async () => {
  delete process.env.WATCH_ADMIN_TOKEN;
  delete process.env.CRON_SECRET;
  kvStore['watch:queries'] = '[]';
  const handler = require('../libs/watch.js');
  const res = mockRes();
  await handler({ method: 'GET', url: '/?cron=1', headers: { 'x-vercel-cron': '1' }, body: undefined }, res);
  assert.equal(res.statusCode, 200, 'x-vercel-cron header should authorize when no secret configured');
  const j = JSON.parse(res.lines[0]);
  assert.equal(j.ok, true);
});
