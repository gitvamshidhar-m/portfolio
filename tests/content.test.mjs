// Hermetic tests for the Content Engine pipeline (libs/content.js).
// Stubs global.fetch so nothing hits the network: GROQ (orchestrator plan, reflections,
// draft tool), KV REST, and SERP providers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const FAKE_RESULTS = [
  { title: 'How to lower cost-per-lead for B2B SaaS', link: 'https://saas-guide.example.com/a', domain: 'saas-guide.example.com', snippet: 'Lower your cost-per-lead with tighter targeting, offer-based landing pages and consistent A/B testing.' },
  { title: 'B2B CPL benchmarks: what good actually looks like', link: 'https://benchmarks.example.com/b', domain: 'benchmarks.example.com', snippet: 'A real benchmark table for cost-per-lead across software categories.' },
  { title: '10 experiments that cut CPL by a third', link: 'https://grow.example.com/c', domain: 'grow.example.com', snippet: 'Repeatable experiments: consolidate ad groups, target-CPA bidding, creative A/B tests.' }
];

const PLAN_JSON = '{"topic":"cost-per-lead for B2B SaaS","orchestrator":"The Researcher mines live search, the Writer drafts grounded in it, the Editor fact-checks, the SEO agent scores, the Publisher packages.","agents":[' +
  '{"id":"researcher","thinking":"find the real sources","action":"query SERP","output":"sources found","live":"mining live search","call":"content.research","toolArgs":{"q":"cost-per-lead for B2B SaaS"},"result":"sources + keywords"},' +
  '{"id":"writer","thinking":"draft grounded in research","action":"write the article","output":"draft written","live":"drafting the piece","call":"content.draft","toolArgs":{"topic":"cost-per-lead for B2B SaaS"},"result":"title + sections"},' +
  '{"id":"editor","thinking":"check the draft","action":"run editorial checks","output":"review done","live":"reviewing the draft","call":"content.edit","toolArgs":{"draft":"sample","keywords":[]},"result":"verdict"},' +
  '{"id":"seo","thinking":"score on-page seo","action":"measure title and meta","output":"score computed","live":"scoring on-page seo","call":"content.seo","toolArgs":{"draft":"sample","title":"title"},"result":"score"},' +
  '{"id":"publisher","thinking":"package for publish","action":"build slug and meta","output":"package ready","live":"packaging for publish","call":"content.publish","toolArgs":{"draft":"sample","title":"title"},"result":"slug + readiness"}] ,' +
  '"briefing":"The piece is ready with an editorial pass and SEO score.","nextSteps":["Approve the draft","Add internal links","Publish"]}';

const MOCK_DRAFT = '# How to lower cost-per-lead for B2B SaaS\n\n' +
  '> A practical guide for B2B founders. Grounded in live research.\n\n' +
  '## Why cost-per-lead matters\n\n' +
  'Lowering cost-per-lead is the single biggest lever for a growth budget. The teams that cut CPL do it with real experiments and tighter targeting, not vibes. When demand generation budgets stay flat, the fastest path to more pipeline is a lower cost-per-lead, because every rupee of spend converts into a bigger share of qualified leads.\n\n' +
  '## Tighten your targeting\n\n' +
  'Narrow the audience to the buyers who convert, and measure against a real baseline. Consolidate ad groups across every campaign, switch to target-CPA bidding, and cut the keywords that burn clicks without producing an opportunity. A smaller, better-matched audience routinely outperforms a broad one.\n\n' +
  '## Offer-based landing pages\n\n' +
  'Every ad group should land on a page that mirrors the offer in the ad copy. When the page repeats the promise and the pricing, visitors stay on it longer and convert more often. Align the headline, the form and the call-to-action with the exact message that got the click in the first place.\n\n' +
  '## A/B testing cadence\n\n' +
  'Consolidate ad groups, switch to target-CPA bidding, and test one creative change at a time. Run each test against a real baseline, give it enough clicks to reach significance, and only scale the variant that beats your previous best. The compounding effect of small wins is what moves the blended cost-per-lead over a quarter.\n\n' +
  '## How the author proves this works\n\n' +
  'A verified track record includes cutting a client\u2019s cost-per-lead from Rs.1,100 to Rs.770 and lifting returns on ad spend from ~3.2x to ~5.5x. Those results came from the same playbook: targeted audiences, offer-aligned pages, and disciplined testing. To try it, book a call or start free with a single campaign (source: the cost-per-lead guide, which shows the targeting tactics behind these numbers).\n\n' +
  '## Key takeaways\n\n- Pick one lever\n- Measure against a baseline\n- Scale only what beats your previous best\n- Align the offer with the landing page\n- Test one change at a time\n';

let kvStore = {};
let realFetch;

function json(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => String(body), body: null };
}

async function fakeFetch(url, opts) {
  opts = opts || {};
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;

  if (u.includes('api.groq.com')) {
    const sysMsg = (body && body.messages && body.messages[0] && body.messages[0].content) || '';
    if (sysMsg.indexOf('staff writer for an independent marketing analyst') >= 0) {
      return json({ choices: [{ message: { content: MOCK_DRAFT } }], usage: { prompt_tokens: 120, completion_tokens: 340 } });
    }
    if (sysMsg.indexOf('rewrite your handoff') >= 0) {
      return json({ choices: [{ message: { content: '{"output":"Handoff grounded in the real tool return."}' } }], usage: { prompt_tokens: 20, completion_tokens: 12 } });
    }
    // Orchestrator plan.
    return json({ choices: [{ message: { content: PLAN_JSON } }], usage: { prompt_tokens: 60, completion_tokens: 90 } });
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
  const headers = {};
  return {
    lines,
    headers,
    _c: 200,
    setHeader (k, v) { headers[String(k).toLowerCase()] = v; },
    writeHead () {},
    status (c) { this._c = c; return this; },
    json (o) { lines.push(JSON.stringify(o)); return this; },
    write (s) { lines.push(s.toString()); return true; },
    end (s) { if (s) lines.push(s.toString()); return true; }
  };
}

test('stream emits tool+reflect per agent and a plan with 5 agents', async () => {
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const tools = evs.filter((e) => e.event === 'tool');
  const reflects = evs.filter((e) => e.event === 'reflect');
  const plan = evs.find((e) => e.event === 'plan');
  assert.ok(tools.length >= 5, 'expected 5 tool events, got ' + tools.length);
  assert.ok(reflects.length >= 5, 'expected 5 reflect events, got ' + reflects.length);
  assert.ok(plan, 'missing plan event');
  assert.ok(Array.isArray(plan.data.agents) && plan.data.agents.length === 5, 'plan should carry 5 agents');
  assert.equal(plan.data.mode, 'ai', 'LLM plan should set ai mode');
  assert.ok(plan.data.nextSteps && plan.data.nextSteps.length >= 1, 'plan should carry nextSteps');
});

test('real tools execute: research sources, RAG draft, editorial verdict, SEO score, publish package', async () => {
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const plan = parseStreamEvents(res.lines).find((e) => e.event === 'plan');
  const d = plan.data;
  // Researcher grounded the pipeline in real live SERP.
  assert.ok(d.serpUsed, 'live SERP should have been used');
  assert.ok(Array.isArray(d.sources) && d.sources.length >= 2, 'research should return real sources');
  assert.ok(Array.isArray(d.citations) && d.citations.length >= 2 && d.citations[0].link, 'citations should carry real links');
  assert.ok(Array.isArray(d.keywords) && d.keywords.length >= 3, 'keyword set should be mined from sources');
  // Writer produced a draft grounded in the retrieved research.
  assert.ok(d.title, 'draft should carry a title');
  assert.ok(String(d.draft).length > 300, 'draft should be a real article body');
  assert.ok(/# How to lower cost-per-lead/.test(d.draft), 'mock LLM draft should be used when key set');
  // Editor ran real checks over the actual draft.
  assert.ok(d.editor && typeof d.editor.score === 'number' && d.editor.score >= 0 && d.editor.score <= 100, 'editor computes a real score');
  assert.ok(d.editor.verdict, 'editor issues a verdict');
  assert.ok(Array.isArray(d.editor.issues), 'editor exposes an issue list');
  // SEO scored the real text.
  assert.ok(d.seo && typeof d.seo.score === 'number' && d.seo.score >= 0 && d.seo.score <= 100, 'seo computes a 0-100 score');
  assert.ok(Array.isArray(d.seo.checks) && d.seo.checks.length >= 4, 'seo checklist is non-trivial');
  // Publisher assembled the publish-ready package.
  assert.ok(d.publish && d.publish.slug, 'publisher builds a slug');
  assert.ok(d.publish.metaTitle && d.publish.metaDesc, 'publisher builds meta title + description');
  assert.ok(d.publish.markdown && d.publish.markdown.indexOf('---') === 0, 'markdown export starts with front-matter');
  assert.ok(d.publish.ready >= 0 && d.publish.ready <= 100, 'readiness is a 0-100 blend');
  // RAG context present in the payload for replication.
  assert.ok(d.draft.indexOf('cost-per-lead') >= 0, 'draft covers the topic');
  // Agent cards keep real exec proof + telemetry counts the 5 executed tools.
  const resAgent = d.agents.find((a) => a.id === 'researcher');
  assert.ok(resAgent && resAgent.exec && resAgent.exec.ok, 'researcher tool exec proof attached');
  assert.ok(d.telemetry && d.telemetry.tools.calls >= 5, 'telemetry should count the executed tools, got ' + d.telemetry.tools.calls);
});

test('no key => rule-based fallback with working tools and zero LLM calls', async () => {
  delete process.env.GROQ_API_KEY;
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'SEO content strategy', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const plan = evs.find((e) => e.event === 'plan');
  assert.equal(plan.data.mode, 'template', 'no key means template mode');
  assert.equal(plan.data.telemetry.calls, 0, 'no LLM calls metered');
  assert.ok(evs.filter((e) => e.event === 'tool').length >= 5, 'tools still execute without a key');
  assert.ok(String(plan.data.draft).length > 100, 'template writer still produces a real draft');
  assert.ok(plan.data.seo && typeof plan.data.seo.score === 'number', 'deterministic SEO still scores without a key');
  assert.ok(plan.data.publish && plan.data.publish.ready, 'publisher packages without a key');
});

test('validation: missing topic is rejected', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { stream: true } }, res);
  assert.ok(String(res.lines[0] || '').indexOf('topic is required') >= 0, 'missing topic should 400');
});

test('stored run replays via GET ?run=', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'SEO content strategy' } }, res);
  const j = JSON.parse(res.lines[0]);
  assert.ok(j.runId, 'runId should be returned');
  const key = 'content:run:' + j.runId;
  assert.ok(kvStore[key], 'run should persist to KV');
  const r2 = mockRes();
  await handler({ method: 'GET', url: '/?run=' + j.runId, headers: {} }, r2);
  const replayed = JSON.parse(r2.lines[0]);
  assert.equal(replayed.topic, 'SEO content strategy', 'replay returns the stored run');
  assert.ok(replayed.replayed === true, 'replay flag should be set');
});

test('GET ?recent=1&topic= lists past runs for that topic', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'SEO content strategy' } }, res);
  const run = JSON.parse(res.lines[0]);
  const r2 = mockRes();
  await handler({ method: 'GET', url: '/?recent=1&topic=SEO%20content%20strategy', headers: {} }, r2);
  const recent = JSON.parse(r2.lines[0]);
  assert.ok(recent.ok === true, 'recent endpoint ok');
  assert.ok(Array.isArray(recent.runs) && recent.runs.some((x) => x.runId === run.runId), 'recent includes the just-run id');
  assert.ok(recent.runs[0].seoScore != null && recent.runs[0].readiness != null, 'recent entries carry seoScore + readiness');
});

test('v2: research sweep runs intent variants and merges sources', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const serp = evs.find((e) => e.event === 'serp');
  assert.ok(serp && Array.isArray(serp.queries) && serp.queries.length === 3, 'sweep should run 3 intent queries, got ' + (serp && serp.queries && serp.queries.length));
  const plan = evs.find((e) => e.event === 'plan');
  assert.ok(Array.isArray(plan.data.serpQueries) && plan.data.serpQueries.length === 3, 'payload exposes the sweep queries');
  assert.ok(plan.data.research.queries && plan.data.research.queries.length === 3, 'research object carries the queries run');
});

test('v2: editor reports claim-coverage pass-rate', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const d = parseStreamEvents(res.lines).find((e) => e.event === 'plan').data;
  assert.ok(d.editor.claimCoverage, 'editor should report claim coverage');
  assert.ok(typeof d.editor.claimCoverage.passRate === 'number', 'claim coverage has a numeric passRate');
  assert.ok(d.editor.claimCoverage.sentences > 0, 'claim coverage measured real sentences');
  assert.ok(d.editor.claimCoverage.passRate >= 0 && d.editor.claimCoverage.passRate <= 100, 'passRate within 0-100');
});

test('v2: SEO measures Flesch readability on the real text', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const d = parseStreamEvents(res.lines).find((e) => e.event === 'plan').data;
  assert.ok(d.seo.readability, 'seo should return a readability measurement');
  assert.ok(typeof d.seo.readability.score === 'number' && d.seo.readability.score >= 0 && d.seo.readability.score <= 100, 'readability score in range');
  assert.ok(d.seo.readability.label, 'readability has a label');
  assert.ok(d.seo.readability.words >= 1, 'readability measured on real words');
});

test('v2: publisher builds inline citations + LinkedIn/X variants', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const d = parseStreamEvents(res.lines).find((e) => e.event === 'plan').data;
  assert.ok(d.publish.inlineCitations >= 1, 'draft should carry at least one inline citation, got ' + d.publish.inlineCitations);
  assert.ok(/\[\d+\]\(https?:/.test(d.publish.markdown), 'markdown export includes inline citations');
  assert.ok(d.variants && d.variants.linkedin, 'linkedin variant generated');
  assert.ok(d.variants && d.variants.thread, 'X thread variant generated');
  assert.ok(d.variants.linkedin.indexOf(d.publish.slug) >= 0, 'linkedin variant links the slug');
});

test('v2: agentic fix loop re-runs writer on editor issues', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS', stream: true } }, res);
  const evs = parseStreamEvents(res.lines);
  const plan = evs.find((e) => e.event === 'plan');
  const loopEvents = evs.filter((e) => e.event === 'loop');
  assert.ok(plan.data.loop && typeof plan.data.loop.fixes === 'number', 'payload carries loop.fixes');
  assert.ok(plan.data.metrics.fixes === plan.data.loop.fixes, 'metrics.fixes matches loop.fixes');
  assert.equal(plan.data.loop.max, 2, 'loop capped at 2 fix passes');
  // The mock draft is strong, so the editor should pass without needing a fix pass.
  assert.ok(plan.data.loop.fixes === 0, 'strong draft should pass review on first pass (fixes=0)');
  assert.ok(plan.data.loop.converged === true, 'first-pass approval counts as converged');
  assert.ok(loopEvents.length === 0, 'no loop events emitted when the draft passes first time');
});

test('v2: PDF export route streams a rendered PDF for a stored run', async () => {
  process.env.GROQ_API_KEY = 'test-key';
  kvStore = {};
  const handler = require('../libs/content.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { topic: 'cost-per-lead for B2B SaaS' } }, res);
  const j = JSON.parse(res.lines[0]);
  const r2 = mockRes();
  await handler({ method: 'POST', url: '/?sub=pdf', headers: {}, body: { runId: j.runId } }, r2);
  assert.equal(r2._c, 200, 'pdf export should return 200');
  assert.equal(r2.headers['content-type'], 'application/pdf', 'pdf route sets Content-Type');
  assert.ok(String(r2.headers['content-disposition']).indexOf('attachment') >= 0, 'pdf route sets attachment disposition');
  const buf = Buffer.concat(r2.lines.map((s) => Buffer.from(String(s), 'binary')));
  assert.ok(buf.length > 1000, 'pdf stream should contain rendered bytes, got ' + buf.length);
  assert.ok(buf.slice(0, 5).toString('ascii') === '%PDF-', 'output should start with the PDF magic header');
});

test('PDF export 404s for an unknown runId', async () => {
  const handler = require('../libs/content.js');
  const r2 = mockRes();
  await handler({ method: 'POST', url: '/?sub=pdf', headers: {}, body: { runId: 'does-not-exist' } }, r2);
  assert.equal(r2._c, 404, 'unknown runId should 404');
});