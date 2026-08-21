const KB = require('../libs/kb');
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

const rl = { hits: {}, last: Date.now() };
const RL_WIN = 60000, RL_MAX = 10;
function rate(key) { const now = Date.now(); if (now - rl.last > RL_WIN) { rl.hits = {}; rl.last = now; } rl.hits[key] = (rl.hits[key] || 0) + 1; return rl.hits[key]; }
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }
function kv(pipe) { if (!KV_URL || !KV_TOKEN) return Promise.resolve(); return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {}); }
function sanitize(s, len) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, len || 200); }
function pdfSafe(s) { return String(s || '').replace(/\u20B9/g, 'Rs.').replace(/[^\x00-\xFF]/g, '').replace(/[*_#`>]/g, '').trim(); }

const SKILL_POOL = {
  ppc: ['Google Ads', 'LinkedIn Ads', 'Meta Ads', 'Target CPA bidding', 'Search/Display/PMax', 'Ad account restructure', 'Creative A/B testing', 'ROAS optimization', 'Budget management', 'Funnel optimization'],
  seo: ['Technical SEO', 'On-page optimization', 'Local SEO', 'E-E-A-T', 'Keyword strategy', 'Content intent mapping', 'GA4 + Search Console', 'Screaming Frog', 'Ahrefs / SEMrush', 'Sitemap & schema'],
  ai: ['Generative AI', 'Prompt engineering', 'AI agents', 'LLM APIs (Groq)', 'RAG systems', 'Workflow automation', 'Next.js / TypeScript', 'Solo product shipping', 'Vercel deployment', 'Automation pipelines'],
  growth: ['Full-funnel marketing', 'Lead generation', 'Growth strategy', 'CRO', 'Landing pages', 'Analytics & dashboards', 'Reporting automation', 'Campaign scaling', 'A/B testing', 'Retention / LTV']
};
function focusFor(jd) {
  const s = ' ' + String(jd || '').toLowerCase() + ' ';
  if (/ppc|google ads|linkedin ads|meta ads|sem|paid|p max|performance max|cpc|cpl|roas|ad account/.test(s)) return 'ppc';
  if (/seo|organic|search console|\bserp\b|on-page|technical seo|backlink|rank/.test(s)) return 'seo';
  if (/ai|llm|gen ?ai|automation|agent|machine learning|chatbot|python|developer|engineer|api/.test(s)) return 'ai';
  if (/growth|demand gen|lead gen|funnel|cro|marketing manager|growth lead/.test(s)) return 'growth';
  return 'growth';
}
function pickSkills(jd, top) {
  const f = focusFor(jd);
  const pool = SKILL_POOL[f];
  const scored = pool.map(function (s) {
    let v = (f === 'ppc' || f === 'seo' || f === 'ai' || f === 'growth') ? 1 : 0;
    pool.forEach(function (p) { if (p !== s && s.indexOf(p.split(' ')[0]) > -1) v += 0.5; });
    if (String(jd || '').toLowerCase().indexOf(s.toLowerCase().split(' ')[0]) > -1) v += 3;
    return { s: s, v: v };
  });
  scored.sort(function (a, b) { return b.v - a.v; });
  return scored.slice(0, top || 8).map(function (x) { return x.s; });
}

function ctxFor(f) {
  const keys = f === 'ppc' ? ['experience', 'results', 'skills'] : f === 'seo' ? ['results', 'skills', 'experience'] : f === 'ai' ? ['products', 'skills', 'results'] : ['results', 'approach', 'products'];
  return KB.filter(function (b) { return keys.indexOf(b.topic) > -1; }).map(function (b) { return '- [' + b.topic + '] ' + b.text; }).join('\n');
}

function sys(ctx) {
  return 'You tailor Vamshidhar Reddy M\'s resume to a specific JOB DESCRIPTION. He is a performance marketer who builds AI tools: 10+ years SEO/PPC/automation, three live solo products (Hook AI, Creative Predictor, AI Growth Strategy Generator), Hyderabad (remote-friendly), open to work.\n'
    + 'Use ONLY the CONTEXT facts. Never invent metrics, employers, or products. Rewrite his REAL facts so they speak to THIS job: emphasize the skills/experience the JD asks for, keep the numbers exact.\n'
    + 'Return ONLY valid JSON with exactly:\n'
    + '{"summary":"<3 sentence professional summary tailored to the JD, first person, $ numbers preserved>",\n'
    + ' "skills":["<top 8 skills, ranked by JD relevance>"],\n'
    + ' "highlights":["<6 one-line resume bullets tailored to the JD, each grounded in CONTEXT>"],\n'
    + ' "cover":["<2-3 sentence tailored cover-letter opener referencing the JD>"]}\n'
    + 'CONTEXT:\n' + ctx;
}

function buildMarkdown(r, company, jd) {
  const c = String(company || 'the role').slice(0, 120);
  return '# Vamshidhar Reddy M\nPerformance Marketer & AI Tool Builder\ngeovamshidhar@gmail.com · +91-7981719085 · Hyderabad, India (remote) · linkedin.com/in/vamshidharreddym\n\n'
    + '## Tailored to: ' + c + '\n\n'
    + '## Summary\n' + (r.summary || '') + '\n\n'
    + '## Core skills for this role\n- ' + (r.skills || []).join('\n- ') + '\n\n'
    + '## Highlights\n- ' + (r.highlights || []).join('\n- ') + '\n\n'
    + '## Proven track record\n- CPL Rs.1,100 → Rs.770 (−30%)\n- ROAS 3.2x → 5.5x (40+ ad groups → 8)\n- +15% organic traffic\n- 70+ qualified leads/mo\n- 3 AI products shipped solo\n\n'
    + '## This is a live, verifiable portfolio\nthe resume generator, RAG chat, ROI model and agent studio on vamshidharm.vercel.app run for real — click them.\n';
}

function fallback(jd, company) {
  const f = focusFor(jd);
  const skills = pickSkills(jd, 8);
  const highlights = f === 'ppc'
    ? ['Cut a client CPL from Rs.1,100 to Rs.770 (−30%) in 60 days.', 'Lifted ROAS ~3.2x → 5.5x by consolidating 40+ ad groups into 8.', 'Manage Rs.2L+/month across Google, LinkedIn and Meta.', 'Generate 70+ qualified leads/month at current company.', 'A/B test creatives and scale only the variant that beats baseline.', 'Built an AI Creative Predictor that scores ads before spend.']
    : f === 'seo'
    ? ['Grew organic traffic ~15% via technical SEO audits and fixes.', 'Run keyword strategy, content intent mapping and E-E-A-T hardening.', 'Own GA4, Search Console, Screaming Frog, Ahrefs, SEMrush.', 'Ship technical SEO on my own site: schema, sitemap, robots, RSS, llms.txt.', 'Audit pages against the metrics that convert, not vanity traffic.', 'Mirror SEO work into content briefs the team can actually execute.']
    : f === 'ai'
    ? ['Shipped three live AI products solo (Hook AI, Creative Predictor, Growth Strategy Generator).', 'Build with Groq LLMs, RAG, Next.js and TypeScript on Vercel.', 'Automate workflows that cut hours of reporting into seconds.', 'Prompt-engineer and run AI agents on real data.', 'Prove AI ROI with numbers, not slides.', 'Own strategy, build, launch and growth end-to-end.']
    : ['Own full-funnel growth: SEO + paid + CRO + AI automation.', 'Cut CPL 30% and lifted ROAS on real managed budgets.', 'Generate 70+ qualified leads/month at current company.', 'Plan strategy with the CMO and build the tool that executes it.', 'Run 30-day sprints from audit to measurable result.', 'Model impact with an ROI calculator on the portfolio.'];
  const r = {
    summary: 'Performance marketer who builds the tools he recommends — 10+ years in SEO, PPC and CRO with three AI products shipped solo. I bring a measurable ROI (CPL −30%, ROAS 3.2x→5.5x, +15% organic traffic, 70+ leads/mo) plus the engineering to automate the win.',
    skills: skills,
    highlights: highlights,
    cover: ['I built the tool that writes this resume from your job description — that is the standard I bring to marketing: strategy plus shipped software.', 'My track record is live and clickable on my portfolio, and the numbers are exact: CPL −30%, ROAS 3.2x→5.5x, +15% organic traffic.', 'I would love 15 minutes to map how those tactics transfer to ' + String(company || 'your team').slice(0, 80) + '.']
  };
  return { r: r, mode: 'template', focus: f };
}

function toPdf(r, company) {
  return new Promise(function (resolve, reject) {
    try {
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ size: 'A4', margins: { top: 44, bottom: 44, left: 48, right: 48 }, info: { Title: 'Vamshidhar Reddy M — Tailored Resume', Author: 'Vamshidhar Reddy M', Subject: String(company || 'Tailored resume') } });
      const chunks = [];
      doc.on('data', function (c) { chunks.push(c); });
      doc.on('end', function () { resolve(Buffer.concat(chunks)); });
      doc.font('Helvetica-Bold').fontSize(20).fillColor('#1a1a2e').text('Vamshidhar Reddy M');
      doc.font('Helvetica').fontSize(10).fillColor('#555').text('Performance Marketer & AI Tool Builder');
      doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#888').text('geovamshidhar@gmail.com · +91-7981719085 · Hyderabad, India (remote) · linkedin.com/in/vamshidharreddym');
      doc.moveDown(0.8);
      if (r.summary) { doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a2e').text('Summary'); doc.font('Helvetica').fontSize(9.5).fillColor('#333').text(pdfSafe(r.summary), { align: 'left' }); doc.moveDown(0.6); }
      if (r.skills && r.skills.length) { doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a2e').text('Core skills for this role'); doc.font('Helvetica').fontSize(9.5).fillColor('#333').text('• ' + r.skills.map(pdfSafe).join('\n• '), { align: 'left' }); doc.moveDown(0.6); }
      if (r.highlights && r.highlights.length) { doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a2e').text('Highlights'); doc.font('Helvetica').fontSize(9.5).fillColor('#333').text('• ' + r.highlights.map(pdfSafe).join('\n• '), { align: 'left' }); doc.moveDown(0.6); }
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a2e').text('Proven track record');
      doc.font('Helvetica').fontSize(9.5).fillColor('#333').text('• CPL Rs.1,100 → Rs.770 (−30%)\n• ROAS 3.2x → 5.5x (40+ ad groups → 8)\n• +15% organic traffic\n• 70+ qualified leads/mo\n• 3 AI products shipped solo', { align: 'left' });
      doc.moveDown(0.8);
      doc.font('Helvetica-Oblique').fontSize(8).fillColor('#999').text('Generated live by the AI resume engine on vamshidharm.vercel.app from the job description you pasted.');
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const url2 = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET') return res.json({ ok: true, mode: process.env.GROQ_API_KEY ? 'ai' : 'template', message: 'POST /api/tailor with {jd, company?, focus?} to tailor the resume; POST /api/tailor?sub=pdf to get a PDF.' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const jd = String(b.jd || '').slice(0, 4000).trim();
  if (!jd) return res.status(400).json({ error: 'missing job description' });
  const company = String(b.company || '').slice(0, 120);
  const key = (process.env.GROQ_API_KEY || '').trim();
  const n = rate(ipOf(req) + ':tailor');
  if (n > RL_MAX) return res.status(429).json({ error: 'rate limited' });

  const fb = fallback(jd, company);
  // PDF sub-route: generate without waiting on the LLM shape.
  if (url2.searchParams.get('sub') === 'pdf') {
    try {
      const buf = await toPdf(fb.r, company);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="Vamshidhar_Reddy_M_tailored_resume.pdf"');
      return res.end(buf);
    } catch (e) {
      return res.status(500).json({ error: 'pdf generation failed' });
    }
  }
  if (!key) {
    kv([['LPUSH', 'leads:recent', JSON.stringify({ type: 'tailor', focus: fb.focus, company: company || '', at: new Date().toISOString() })], ['LTRIM', 'leads:recent', 0, 49]]);
    return res.json({ mode: 'template', focus: fb.focus, summary: fb.r.summary, skills: fb.r.skills, highlights: fb.r.highlights, cover: fb.r.cover, markdown: buildMarkdown(fb.r, company, jd) });
  }

  const f = fb.focus;
  const ctx = ctxFor(f);
  try {
    const c = new AbortController(); const t = setTimeout(function () { c.abort(); }, 15000);
    const j = await fetch(GROQ, { method: 'POST', signal: c.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: MODEL, temperature: 0.45, max_tokens: 900, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sys(ctx) }, { role: 'user', content: 'JOB DESCRIPTION:\n' + jd + '\n\nTailor Vamshidhar\'s resume to this role. Keep real metrics exact.' }] }) })
      .then(function (r) { return r.json(); })
      .catch(function () { return null; });
    clearTimeout(t);
    const text = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    let o = null;
    try { o = JSON.parse(text); } catch (e) { const m = text.match(/\{[\s\S]*\}/); if (m) { try { o = JSON.parse(m[0]); } catch (e2) {} } }
    const r = o && (o.summary || o.skills || o.highlights)
      ? { summary: String(o.summary || '').slice(0, 500), skills: (Array.isArray(o.skills) ? o.skills : []).map(String).slice(0, 10), highlights: (Array.isArray(o.highlights) ? o.highlights : []).map(String).slice(0, 8), cover: (Array.isArray(o.cover) ? o.cover : []).map(String).slice(0, 4) }
      : fb.r;
    if (!r.skills.length) r.skills = fb.r.skills;
    kv([['LPUSH', 'leads:recent', JSON.stringify({ type: 'tailor', focus: f, company: company || '', at: new Date().toISOString() })], ['LTRIM', 'leads:recent', 0, 49]]);
    res.json({ mode: 'ai', focus: f, summary: r.summary, skills: r.skills, highlights: r.highlights, cover: r.cover, markdown: buildMarkdown(r, company, jd) });
  } catch (e) {
    const fb2 = fallback(jd, company);
    res.json({ mode: 'template', focus: fb2.focus, summary: fb2.r.summary, skills: fb2.r.skills, highlights: fb2.r.highlights, cover: fb2.r.cover, markdown: buildMarkdown(fb2.r, company, jd), error: String(e && e.message || e) });
  }
};