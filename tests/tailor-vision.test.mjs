// Hermetic tests for the AI resume tailors (libs/tailor.js) and the multimodal
// vision extractor (libs/vision.js). Stubs global.fetch: Groq (LLM/vision),
// KV REST, and nothing else touches the network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function json(body) {
  return { ok: true, status: 200, json: async () => body, text: async () => String(body), body: null };
}

let realFetch;
async function fakeFetch(url, opts) {
  opts = opts || {};
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (u.includes('api.groq.com')) {
    const msgs = (body && body.messages) || [];
    const content = msgs[0] && msgs[0].content;
    // Vision: content is an array [{text}, {image_url}].
    if (Array.isArray(content)) {
      return json({ choices: [{ message: { content: 'Growth Marketing Manager (Remote)\n\nResponsibilities:\n- Own organic traffic and CPL\n- Manage Google Ads and LinkedIn Ads\n- A/B test landing pages\n- Use GA4 and Looker' } }] });
    }
    if (String(content || '').indexOf('tailor Vamshidhar') > -1) {
      return json({ choices: [{ message: { content: JSON.stringify({
        summary: 'I am a performance marketer who owns CPL and organic traffic, with 10+ years across Google Ads, LinkedIn Ads and CRO.',
        skills: ['Google Ads', 'LinkedIn Ads', 'GA4', 'CPL optimization', 'Technical SEO', 'CRO', 'Looker', 'AI automation'],
        highlights: ['Cut a client CPL from Rs.1,100 to Rs.770 (-30%).', 'Grew organic traffic ~15% via technical SEO.', 'Generate 70+ qualified leads a month.', 'Manage Rs.2L+ monthly ad spend.'],
        cover: ['My portfolio generated this resume from your job description.']
      }) } }] });
    }
    return json({ choices: [{ message: { content: '{}' } }] });
  }
  if (u.includes('/pipeline')) return json([[0]]);
  return json({});
}

before(() => {
  realFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  process.env.KV_REST_API_URL = 'https://kv.example.com';
  process.env.KV_REST_API_TOKEN = 'test';
  global.fetch = fakeFetch;
});

after(() => {
  global.fetch = realFetch;
});

function mockRes() {
  const lines = [];
  return {
    lines,
    headers: {},
    _c: 200,
    setHeader (k, v) { this.headers[String(k).toLowerCase()] = v; },
    status (c) { this._c = c; return this; },
    json (o) { lines.push(JSON.stringify(o)); return this; },
    end (s) { if (s) lines.push(s.toString()); return true; },
    write (s) { lines.push(s.toString()); return true; }
  };
}

test('tailor: AI generates a tailored resume from a job description', async () => {
  const handler = require('../libs/tailor.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: { jd: 'We need a Growth Marketing Manager to own CPL and Google Ads.', company: 'Acme' } }, res);
  const j = JSON.parse(res.lines[0]);
  assert.equal(j.mode, 'ai');
  assert.ok(j.summary && j.summary.length > 10, 'summary generated');
  assert.ok(Array.isArray(j.skills) && j.skills.length >= 6, 'skills are ranked for the role');
  assert.ok(j.highlights.length >= 4, 'resume bullets present');
  assert.ok(/Rs\.1,100/.test(String(j.highlights.join(' '))), 'real metrics are preserved, not invented');
  assert.ok(j.markdown.indexOf('## Summary') > -1, 'markdown resume is built');
});

test('tailor: invalid request is rejected', async () => {
  const handler = require('../libs/tailor.js');
  const res = mockRes();
  await handler({ method: 'POST', url: '/', headers: {}, body: {} }, res);
  const j = JSON.parse(res.lines[0]);
  assert.ok(j.error, 'missing jd should error');
});

test('vision: extracts job-description text from a screenshot', async () => {
  const handler = require('../libs/vision.js');
  const res = mockRes();
  const b64 = Buffer.from('fake image bytes for the vision test path '.repeat(200)).toString('base64');
  await handler({ method: 'POST', url: '/', headers: {}, body: { image: b64, mime: 'image/png' } }, res);
  const j = JSON.parse(res.lines[0]);
  assert.equal(j.ok, true);
  assert.ok(j.text && j.text.indexOf('Growth Marketing Manager') > -1, 'vision model text extracted into the payload');
  assert.ok(j.title && j.title.length > 0, 'title inferred from first line');
});

test('no key: tailor falls back to a deterministic template with working tools', async () => {
  const k = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = '';
  try {
    const handler = require('../libs/tailor.js');
    const res = mockRes();
    await handler({ method: 'POST', url: '/', headers: {}, body: { jd: 'PPC specialist managing Google Ads budgets and ROAS.' } }, res);
    const j = JSON.parse(res.lines[0]);
    assert.equal(j.mode, 'template');
    assert.ok(Array.isArray(j.skills) && j.skills.length >= 6, 'fallback skill set still ranked');
    assert.ok(j.markdown.indexOf('## Summary') > -1, 'fallback markdown still produced');
  } finally {
    process.env.GROQ_API_KEY = k;
  }
});