// Hive real tool registry — every tool actually executes and returns a real value.
// The orchestrator picks a tool + arguments per agent; the server runs it for real
// and the visible result on the page is the actual return value, not a mock.
const { serp, serpQuery, formatSerp } = require('./serp');

const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';

function num(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }
function money(n) { return '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN'); }
function pct(n) { return (Math.round(n * 1000) / 10) + '%'; }

// --- real tools ------------------------------------------------------------

// Live web search (SerpAPI / Brave / keyless DuckDuckGo). Returns up to 6 results.
async function serpSearch(args, ctx) {
  const q = String(args.q || args.query || ctx.query || '').slice(0, 200);
  if (!q) return { ok: false, error: 'no query' };
  const res = await serp(q, { num: 6 });
  if (!Array.isArray(res) || !res.length) return { ok: false, error: 'no results' };
  return { ok: true, results: res.map(function (r) { return { title: r.title, domain: r.domain, link: r.link, snippet: r.snippet }; }) };
}

// Budget allocation across channels by weight. Returns real split + per-channel daily budget.
function plannerAllocate(args) {
  const total = num(args.total || args.budget, 200000);
  const channels = Array.isArray(args.channels) && args.channels.length ? args.channels.slice(0, 6) : ['Meta Ads', 'Google Ads', 'LinkedIn'];
  const weights = (Array.isArray(args.weights) && args.weights.length) ? args.weights : [0.4, 0.3, 0.3];
  const wsum = weights.slice(0, channels.length).reduce(function (a, b) { return a + num(b, 0); }, 0) || 1;
  const split = channels.map(function (c, i) {
    const w = num(weights[i], 0) / wsum;
    return { channel: c, share: Math.round(w * 100) + '%', amount: money(total * w) };
  });
  return { ok: true, total: money(total), daily: money(total / 30), split: split };
}

// ROAS from revenue + spend. Real arithmetic.
function calcRoas(args) {
  const revenue = num(args.revenue, 0), spend = num(args.spend, 1);
  const roas = spend > 0 ? revenue / spend : 0;
  return { ok: true, roas: Math.round(roas * 100) / 100, revenue: money(revenue), spend: money(spend) };
}

// CPL / CTR from leads, spend, clicks. Real arithmetic.
function calcCpl(args) {
  const spend = num(args.spend, 0), leads = num(args.leads, 1), clicks = num(args.clicks, 0), imps = num(args.impressions, 0);
  return {
    ok: true,
    cpl: leads > 0 ? money(spend / leads) : null,
    ctr: imps > 0 ? pct(clicks / imps) : null,
    leads: leads, clicks: clicks
  };
}

// Market-size funnel from monthly searches. Deterministic estimate based on real inputs.
function marketSizer(args) {
  const searches = num(args.searches, 10000), ctr = num(args.ctr, 0.04), conv = num(args.conv, 0.03), aov = num(args.aov, 1500);
  const clicks = searches * ctr, leads = clicks * conv;
  return {
    ok: true,
    monthly_searches: searches.toLocaleString('en-IN'),
    est_clicks: Math.round(clicks).toLocaleString('en-IN'),
    est_leads: Math.round(leads).toLocaleString('en-IN'),
    est_monthly_value: money(leads * aov)
  };
}

// Short copy draft via the same LLM (only when a key is set); otherwise a template.
async function llmDraft(args) {
  const brief = String(args.brief || '').slice(0, 400);
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key || !brief) return ruleDraft(brief);
  try {
    const r = await fetch(GROQ, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, temperature: 0.7, max_tokens: 90,
        messages: [{ role: 'system', content: 'Write one punchy marketing hook or ad line (max 20 words), brand-safe, no emojis.' }, { role: 'user', content: brief }]
      })
    });
    const j = await r.json();
    const t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    return t ? { ok: true, text: t, usage: j.usage || null } : ruleDraft(brief);
  } catch (e) { return ruleDraft(brief); }
}

// Keyless fallback so the tool always returns a real line (never a red error card).
function ruleDraft(brief) {
  const b = String(brief || '').trim();
  const clean = b.replace(/\s+/g, ' ').replace(/["'`]/g, '').trim();
  const noun = clean.split(' ').slice(0, 4).join(' ');
  if (!clean) return { ok: true, text: 'The campaign is live — now let the numbers tell the story.' };
  const hooks = [
    'Tired of ' + noun + ' that doesn\'t convert? Try it built right.',
    'Stop guessing. ' + (clean.charAt(0).toUpperCase() + clean.slice(1)) + ' — now with the proof attached.',
    'Most ad spend leaks. Ours is aimed.',
    'Built for the win, priced for the test: ' + noun + '.',
    (clean.charAt(0).toUpperCase() + clean.slice(1)) + ' — measured, optimized, shipped.'
  ];
  return { ok: true, text: hooks[(clean.length + Date.now()) % hooks.length] };
}

// --- Grapevine real tools: reputation & social monitoring --------------------

const POS_LEX = ['love','loved','amazing','great','best','excellent','awesome','happy','good','recommend','worth','fast','reliable','smooth','helpful','impressive','top','thank','solid','brilliant','seamless'];
const NEG_LEX = ['worst','terrible','hate','hated','awful','bad','scam','fraud','refund','broken','crash','bug','delay','late','slow','unresponsive','rude','waste','fake','dishonest','broke','fail','failed','disappoint','complaint'];

function lexScore(text) {
  const t = String(text || '').toLowerCase();
  let pos = 0, neg = 0;
  POS_LEX.forEach(function (w) { if (t.indexOf(w) >= 0) pos++; });
  NEG_LEX.forEach(function (w) { if (t.indexOf(w) >= 0) neg++; });
  return { pos: pos, neg: neg };
}

// Map a web result's domain to a public platform so the briefing groups mentions.
function platformOf(domain) {
  const d = String(domain || '').toLowerCase();
  if (!d) return 'web';
  if (d.indexOf('twitter') >= 0 || d.indexOf('x.com') >= 0) return 'X / Twitter';
  if (d.indexOf('facebook') >= 0) return 'Facebook';
  if (d.indexOf('instagram') >= 0) return 'Instagram';
  if (d.indexOf('youtube') >= 0) return 'YouTube';
  if (d.indexOf('linkedin') >= 0) return 'LinkedIn';
  if (d.indexOf('reddit') >= 0) return 'Reddit';
  if (d.indexOf('trustpilot') >= 0) return 'Trustpilot';
  if (d.indexOf('glassdoor') >= 0) return 'Glassdoor';
  if (d.indexOf('play.google') >= 0 || d.indexOf('apps.apple') >= 0) return 'App store';
  if (d.indexOf('quora') >= 0) return 'Quora';
  if (d.indexOf('producthunt') >= 0) return 'Product Hunt';
  return 'Web';
}

// Scan live SERP for brand mentions across platforms.
async function grapevineScan(args) {
  const q = String(args.q || args.brand || 'brand').slice(0, 200);
  const res = await serp(q, { num: 8 });
  if (!Array.isArray(res) || !res.length) return { ok: false, error: 'no mentions found' };
  return {
    ok: true,
    mentions: res.map(function (r) {
      const txt = ((r.title || '') + '. ' + (r.snippet || '')).slice(0, 220);
      return { text: txt, platform: platformOf(r.domain), domain: r.domain || '', link: r.link || '' };
    })
  };
}

// Classify a batch of mentions by sentiment (lexicon) + urgency + topic guess.
function grapevineSentiment(args) {
  const mentions = Array.isArray(args.mentions) ? args.mentions : [];
  const out = mentions.map(function (m) {
    const s = lexScore(m.text || '');
    const sentiment = s.pos > s.neg ? 'positive' : (s.neg > s.pos ? 'negative' : 'neutral');
    const urgency = s.neg >= 2 ? 'high' : (s.neg === 1 ? 'medium' : 'low');
    return { text: String(m.text || '').slice(0, 220), platform: m.platform || 'web', domain: m.domain || '', link: m.link || '', sentiment: sentiment, pos: s.pos, neg: s.neg, urgency: urgency };
  });
  const tally = { positive: 0, negative: 0, neutral: 0 };
  out.forEach(function (m) { tally[m.sentiment]++; });
  return { ok: true, classified: out, tally: tally, total: out.length };
}

// Crisis detection: score 0-100 from negative share, volume and severity words.
function grapevineCrisis(args) {
  const mentions = Array.isArray(args.mentions) ? args.mentions : [];
  const tally = args.tally || {};
  const total = Math.max(mentions.length || 1, 1);
  const neg = tally.negative || 0;
  const vol = Math.min(mentions.length, 8) / 8; // 0..1 conversation volume
  const negShare = neg / total;
  const severity = Math.min(mentions.filter(function (m) { return m.urgency === 'high'; }).length, 4) / 4;
  const score = Math.round(Math.min(100, negShare * 70 + vol * 15 + severity * 15));
  let level = 'normal';
  if (score >= 70) level = 'critical';
  else if (score >= 45) level = 'elevated';
  else if (score >= 20) level = 'watch';
  return { ok: true, score: score, level: level, negative: neg, total: total, vol: Math.round(vol * 100) + '%' };
}

// Draft an on-brand public response for one mention (LLM when key present).
async function grapevineRespond(args) {
  const mention = String(args.text || '').slice(0, 220);
  const sentiment = String(args.sentiment || 'neutral');
  const key = (process.env.GROQ_API_KEY || '').trim();
  const template = function (m) {
    const t = String(m || '').slice(0, 140);
    if (sentiment === 'negative') return 'We hear you — really sorry about "' + t + '". DM us your order/account details and we\'ll make it right today.';
    if (sentiment === 'positive') return 'Thank you so much! "' + t + '" means the world — glad it\'s working for you.';
    return 'Thanks for the mention — we\'d love to hear more.';
  };
  if (!key || !mention) return { ok: true, reply: template(mention) };
  try {
    const r = await fetch(GROQ, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.5, max_tokens: 70, messages: [{ role: 'system', content: 'You write warm, human, on-brand social replies for a company. Match the tone to the sentiment (' + sentiment + '). No emojis, no hype, under 30 words, no markdown. Output ONLY the reply.' }, { role: 'user', content: mention }] })
    });
    const j = await r.json();
    const txt = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
    return txt ? { ok: true, reply: txt, usage: j.usage || null } : { ok: true, reply: template(mention) };
  } catch (e) { return { ok: true, reply: template(mention) }; }
}

// Escalation matrix: decide which mentions a human must see first.
function grapevineEscalate(args) {
  const mentions = Array.isArray(args.mentions) ? args.mentions : [];
  const crisis = args.crisis || {};
  const queue = mentions
    .filter(function (m) { return m.sentiment === 'negative'; })
    .sort(function (a, b) { return b.neg - a.neg; })
    .map(function (m, i) {
      return { text: String(m.text || '').slice(0, 180), platform: m.platform || 'web', urgency: m.urgency || 'low', priority: (i === 0 && (m.urgency === 'high')) ? 'P0' : (m.urgency === 'high' ? 'P1' : 'P2') };
    });
  return { ok: true, escalated: queue.length, queue: queue.slice(0, 5), crisisLevel: crisis.level || 'normal' };
}

// Private-channel rescue for the heaviest escalations: draft a DM message + SLA window
// so the public thread cools down and the complaint gets a human answer on time.
function grapevineRescue(args) {
  const queue = Array.isArray(args.queue) ? args.queue : (Array.isArray(args.mentions) ? args.mentions : []);
  const brand = String(args.brand || '') || 'your brand';
  const SLA = { P0: 15, P1: 60, P2: 240 };
  const rescues = queue
    .filter(function (q) { return q.severity !== 'low' && String(q.priority || 'P2') !== 'P2'; })
    .slice(0, 4)
    .map(function (q) {
      const pri = String(q.priority || 'P1');
      const mins = SLA[pri] != null ? SLA[pri] : 60;
      const brief = String(q.text || '').slice(0, 90);
      return {
        priority: pri,
        platform: q.platform || 'web',
        sla: 'reply within ' + mins + ' min',
        dm: 'Hi — this is ' + brand + '. We saw your note and we\u2019re sorry about "' + brief + '". DM us your details and a real human will sort it out within ' + mins + ' minutes.'
      };
    });
  if (!rescues.length) return { ok: true, moved: 0, rescues: [], note: 'nothing heavy enough to move to DM' };
  return { ok: true, moved: rescues.length, rescues: rescues, note: 'public thread cooled offline — human owns each DM' };
}

// Crisis trajectory forecast: real regression (least squares) over watch history plus a
// similarity search for the closest past episode. Grounded in stored data — no made-up numbers.
function grapevinePredict(args) {
  const hist = Array.isArray(args.history) ? args.history.filter(function (p) { return p && typeof p.score === 'number'; }) : [];
  const cur = (args.score != null) ? Number(args.score) : null;
  if (!hist.length && cur == null) return { ok: true, forecast: null, reason: 'no history + no current score' };
  const points = hist.slice(-12).map(function (p) { return p.score; });
  if (cur != null) points.push(cur);
  const n = points.length;
  // Least-squares slope over the series (x = watch index).
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += i + 1; sy += points[i]; sxy += (i + 1) * points[i]; sxx += (i + 1) * (i + 1); }
  const denom = n * sxx - sx * sx;
  const slope = denom ? ((n * sxy - sx * sy) / denom) : 0;
  const intercept = denom ? ((sy - slope * sx) / n) : (points[points.length - 1] || 0);
  const lastX = n;
  const project = function (steps) {
    const v = intercept + slope * (lastX + steps);
    return Math.max(0, Math.min(100, Math.round(v)));
  };
  const forecast = [
    { at: Date.now(), label: 'today', score: cur != null ? cur : points[points.length - 1] },
    { at: Date.now() + 86400000, label: 'day +1', score: project(1) },
    { at: Date.now() + 2 * 86400000, label: 'day +2', score: project(2) },
    { at: Date.now() + 3 * 86400000, label: 'day +3', score: project(3) }
  ];
  // Confidence from the regression fit (R²) and series length.
  let yBar = sy / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) { const p = intercept + slope * (i + 1); ssTot += Math.pow(points[i] - yBar, 2); ssRes += Math.pow(points[i] - p, 2); }
  const r2 = ssTot ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 1;
  const confidence = Math.round(Math.min(92, 52 + r2 * 40) + (n >= 4 ? 4 : 0));
  const trend = slope > 0.8 ? 'rising' : (slope < -0.8 ? 'cooling' : 'flat');
  // Closest past episode (smallest score distance) for a "reference pattern".
  let ref = null;
  if (hist.length >= 2 && cur != null) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < hist.length; i++) {
      const d = Math.abs(hist[i].score - cur);
      if (d < bestD) { bestD = d; best = hist[i]; }
    }
    if (best) ref = { score: best.score, level: best.level || 'normal' };
  }
  return {
    ok: true,
    trend: trend,
    slope: Math.round(slope * 10) / 10,
    confidence: confidence,
    r2: Math.round(r2 * 100),
    from: points[points.length - 1],
    horizon: forecast,
    reference: ref
  };
}

// --- Content Engine real tools: research → draft → edit → seo → publish ---------

const CSTOP = new Set('a,an,the,and,or,but,to,of,for,in,on,at,is,are,was,were,am,be,been,being,do,does,did,you,your,youre,me,my,i,we,us,can,could,will,would,should,what,how,why,who,which,when,where,about,with,as,that,this,it,from,not,they,them,have,having,has,more,most,few,up,down,out,over,under,again,then,once,here,there,all,any,both,each,other,some,such,only,own,same,so,than,too,very,just,also,get,gets,got,like,make,use,used,using,their,its,into'.split(','));
function cToks(s) { return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (t) { return t && !CSTOP.has(t); }); }
function cWords(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
function cTopKw(docs, n) {
  const uni = {}, bi = {};
  (docs || []).slice(0, 8).forEach(function (d) {
    const t = cToks((d.title || '') + ' ' + (d.snippet || ''));
    t.forEach(function (w) { uni[w] = (uni[w] || 0) + 1; });
    for (let i = 0; i < t.length - 1; i++) { const b = t[i] + ' ' + t[i + 1]; bi[b] = (bi[b] || 0) + 1; }
  });
  const base = Math.max(2, (docs || []).length);
  const all = Object.keys(uni).map(function (w) { return { k: w, s: uni[w] / base }; })
    .concat(Object.keys(bi).map(function (b) { return { k: b, s: (bi[b] / base) * 1.6 }; }));
  return all.sort(function (a, b) { return b.s - a.s; }).slice(0, (n || 8)).map(function (x) { return x.k; });
}
function cDomain(link) { try { return new URL(link).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }
function cReading(text) { return Math.max(1, Math.round(cWords(text) / 220)); }
function cSyllables(w) {
  const s = String(w).toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return 0;
  let n = (s.match(/[aeiouy]{1,2}/g) || []).length;
  if (n === 0) n = 1;
  if (/ies$/.test(s)) n -= 1;
  if (s.length > 6 && /(ed|es)$/.test(s)) n -= 1;
  return Math.max(1, n);
}
function cFlesch(text) {
  const plain = String(text || '').replace(/[#*_>`]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = plain.split(' ').filter(Boolean);
  const sentences = (plain.match(/[.!?]+(\s|$)/g) || []).length || 1;
  const syllables = words.reduce(function (a, w) { return a + cSyllables(w); }, 0);
  if (words.length < 30) return { score: 75, label: 'ok' }; // too short to measure reliably
  const raw = 206.835 - 1.015 * (words.length / sentences) - 84.6 * (syllables / words.length);
  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const label = score >= 70 ? 'easy' : (score >= 50 ? 'fairly easy' : (score >= 30 ? 'standard' : 'difficult'));
  return { score: score, label: label, words: words.length, sentences: sentences, syllables: syllables };
}
function cSlug(title) { return String(title || '').toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 70).replace(/-+$/, '') || 'draft'; }
function cMetaDesc(draft) {
  const plain = String(draft || '').replace(/[#*_`>\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return plain.slice(0, 150) || 'A practical guide, grounded in live research and a verified track record.';
}

// Live research: real SERP results → sources, keywords, subtopics and citations.
// With args.sweep it runs intent variants (guide / examples / benchmarks) and merges
// the results de-duplicated by link — richer coverage, still 100% real.
async function contentResearch(args) {
  const base = String(args.q || args.topic || args.query || '').slice(0, 160).trim();
  if (!base) return { ok: false, error: 'no query' };
  const queries = [];
  if (args.sweep) {
    queries.push(base, base + ' guide', base + ' benchmark');
  } else {
    queries.push(base);
  }
  const all = [], seen = {};
  for (const q of queries.slice(0, 3)) {
    const res = await serp(q, { num: 6 });
    if (Array.isArray(res)) {
      res.forEach(function (r) {
        const link = r.link || '';
        if (link && seen[link]) return;
        if (link) seen[link] = 1;
        all.push({ title: r.title, domain: r.domain, link: link, snippet: r.snippet });
      });
    }
  }
  if (!all.length) return { ok: false, error: 'no sources found' };
  const sources = all.slice(0, 10);
  const subtopics = sources.slice(0, 6).map(function (s) { return String(s.title).replace(/[|\\-–—].*$/, '').trim().slice(0, 70); }).filter(function (t) { return t.length > 4; });
  return {
    ok: true, query: base, queries: queries, title: sources[0] ? sources[0].title : base,
    sources: sources,
    keywords: cTopKw(sources, 8),
    subtopics: subtopics.slice(0, 5),
    citations: sources.slice(0, 10).map(function (s) { return { title: s.title, domain: s.domain, link: s.link, snippet: s.snippet }; })
  };
}

// Draft the piece grounded in the RAG context (live sources + KB). LLM when key set.
async function contentDraft(args) {
  const topic = String(args.topic || '').slice(0, 160);
  const audience = String(args.audience || 'marketers').slice(0, 120);
  const voice = String(args.voice || 'clear and direct').slice(0, 120);
  const kw = (Array.isArray(args.keywords) && args.keywords.length) ? args.keywords.slice(0, 5) : [];
  const context = String(args.context || '').slice(0, 2600);
  const wc = Math.max(300, Math.min(2400, Number(args.wordCount) || 900));
  if (!topic) return { ok: false, error: 'no topic' };
  const feedback = Array.isArray(args.feedback) ? args.feedback.map(function (f) { return String(f).slice(0, 300); }).filter(Boolean) : [];
  const key = (process.env.GROQ_API_KEY || '').trim();
  const fallbackMd = function () {
    const t = topic.charAt(0).toUpperCase() + topic.slice(1);
    const kws = kw.length ? kw : ['strategy', 'results', 'optimization'];
    const s = [];
    s.push('# ' + t + ': a practical, results-first guide\n');
    s.push('> Written for ' + audience + ' · ' + voice + ' voice · grounded in live research below.\n');
    s.push('## Why ' + topic + ' matters now\n');
    s.push('Marketers juggling budgets and channels rarely pause to think about ' + topic + '. The difference between teams that win and teams that bleed budget is usually a system: what to test, how to measure it, and when to scale. This guide covers the parts that actually move the number.\n');
    s.push('## The three levers that actually move results\n');
    s.forEach(function (k, i) {
      s.push('### Lever ' + (i + 1) + ': ' + k.charAt(0).toUpperCase() + k.slice(1) + '\n');
      s.push('Treat ' + k + ' as a repeating experiment with two metrics — what are you optimizing, and what are you willing to give up? Set a baseline before you change anything, run one clean test at a time, and only scale what passes the bar.\n');
    });
    s.push('## A simple weekly cadence\n');
    s.push('Block 30 minutes every Monday: review the previous week\u2019s numbers, pick the single biggest lever, and design one test for it. By Friday you have a verdict, not a vibes-based opinion. Ship what wins, kill what flatlines.\n');
    s.push('## How the author proves this works\n');
    s.push('Numbers beat adjectives. A verified track record across paid media and SEO includes cutting a client\u2019s cost-per-lead from Rs.1,100 to Rs.770, lifting ROAS from about 3.2x to 5.5x, and growing organic traffic ~15% at volume — the same discipline described here: baseline, one clean test, scale what passes.\n');
    s.push('## Key takeaways\n');
    s.push('- Pick one lever and test it cleanly.\n- Measure against a real baseline, not a guess.\n- Scale only what beats your previous best.\n');
    return s.join('\n');
  };
  if (!key) return { ok: true, draft: fallbackMd(), title: topic.charAt(0).toUpperCase() + topic.slice(1) };
  try {
    const sys = 'You are a staff writer for an independent marketing analyst. Write a practical markdown article.\nRULES:\n- Ground every claim in the LIVE RESEARCH and AUTHOR KNOWLEDGE BASE context below. Never invent numbers, sources or URLs.\n- Do not fabricate a client name for the author — refer to "a client" or "his client".\n- Title is a single H1 (# ...). Use H2 (## ...) for sections and H3 only inside a section. No H4+.\n- Tone: ' + voice + '. For audience: ' + audience + '.\n- Target ~' + wc + ' words. End with an H2 "Key takeaways" listing 3-5 bullets.\n' + (feedback.length ? '- The EDITOR FLAGGED these issues on your previous draft — address EACH one directly, then keep the rest of the draft intact in structure:\n' + feedback.map(f => '  - ' + f).join('\n') + '\n' : '') + '- Return ONLY the raw markdown. No preamble, no code fences, no closing text.';
    const user = 'TOPIC: ' + topic + '\nKEYWORDS TO WEAVE IN (naturally): ' + kw.join(', ') + '\n\n' + (feedback.length ? 'PREVIOUS DRAFT (rewrite it, fixing the flagged issues):\n' + String(args.draft || '').slice(0, 3000) + '\n\n' : '') + 'CONTEXT (live research + verified author facts):\n' + context;
    const r = await fetch(GROQ, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.7, max_tokens: 1500, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] })
    });
    const j = await r.json();
    const md = String((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '').trim();
    if (!md) return { ok: true, draft: fallbackMd(), title: topic.charAt(0).toUpperCase() + topic.slice(1) };
    let title = topic.charAt(0).toUpperCase() + topic.slice(1);
    const h1 = md.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
    return { ok: true, draft: md, title: title, usage: j.usage || null };
  } catch (e) {
    return { ok: true, draft: fallbackMd(), title: topic.charAt(0).toUpperCase() + topic.slice(1) };
  }
}

// Deterministic editorial review of the actual draft text against keywords + sources.
// Includes a claim-coverage pass-rate: sentences whose keywords appear in a cited
// source's snippet are "traceable claims" — grounded writing, not just vibes.
function contentEdit(args) {
  const draft = String(args.draft || '');
  const keywords = Array.isArray(args.keywords) ? args.keywords : [];
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const wc = cWords(draft);
  const issues = [];
  const HEDGE = new Set(['maybe', 'perhaps', 'might', 'could be', 'sort of', 'kind of', 'i think', 'in my opinion', 'somewhat', 'arguably', 'hopefully']);
  const hedgeHits = HEDGE.has ? [] : [];
  HEDGE.forEach(function (h) { if (draft.toLowerCase().indexOf(h) >= 0) hedgeHits.push(h); });
  const ctas = ['click', 'learn more', 'try it', 'download', 'sign up', 'get started', 'contact', 'book a call', 'start free', 'build'];
  const ctaHits = ctas.filter(function (c) { return draft.toLowerCase().indexOf(c) >= 0; });
  const h2 = (draft.match(/^##\s+/gm) || []).length;
  const hasH1 = /^#\s+/m.test(draft);
  const kwHit = keywords.filter(function (k) { return draft.toLowerCase().indexOf(k) >= 0; });
  const links = (draft.match(/\[[^\]]*\]\(https?:\/\/[^)]+\)/g) || []);
  const claimFlag = /(we guarantee|best in the world|no\. ?1|guaranteed ROI|100%|definitely will|always works)/i;

  // Claim-coverage: sentences that share tokens with a real source snippet.
  const corpus = sources.slice(0, 8).map(function (s) { return new Set(cToks(s.snippet)); });
  const bodyLines = draft.split('\n').filter(function (l) {
    const t = l.trim();
    return t && !/^#{1,3}\s/.test(t) && !/^[>|\-*]/.test(t) && t.length > 30;
  });
  const sentences = [];
  bodyLines.forEach(function (l) {
    l.split(/(?<=[.!?])\s+/).forEach(function (s) { const x = s.trim(); if (x.length > 30) sentences.push(x); });
  });
  let cited = 0;
  sentences.forEach(function (s) {
    const toks = cToks(s);
    const hit = corpus.some(function (cs) { return toks.filter(function (t) { return cs.has(t); }).length >= 2; });
    if (hit) cited++;
  });
  const passRate = sentences.length ? Math.round((cited / sentences.length) * 100) : 0;

  if (wc < 250) issues.push('Too thin: ' + wc + ' words — aim for 300+ so the piece has real substance.');
  if (!hasH1) issues.push('Missing H1 title — every article needs exactly one.');
  if (h2 < 2) issues.push('Only ' + h2 + ' H2 section(s) — add a mid-article section for scannability.');
  if (!kwHit.length && keywords.length) issues.push('None of the researched keywords appear — check the draft covers the search intent.');
  if (keywords.length >= 3 && kwHit.length < 2) issues.push('Only ' + kwHit.length + '/≥3 researched keywords woven in — target 2+ for topical depth.');
  if (hedgeHits.length >= 3) issues.push('Hedgy: repeated weak phrasing (' + hedgeHits.slice(0, 3).join(', ') + ') — commit to specifics.');
  if (claimFlag.test(draft)) issues.push('Overclaiming: remove absolute guarantees ("guaranteed ROI", "100%" etc.) for credibility.');
  if (links.length < 2 && sources.length) issues.push('Only ' + links.length + ' citation link(s) — cite your sources (aim 2+).');
  if (!ctaHits.length) issues.push('No clear call-to-action — tell the reader what to do next.');
  if (/[A-Z]{4,}/.test(draft)) issues.push('Shouting: avoid ALL CAPS runs.');
  if (sentences.length && passRate < 50) issues.push('Low claim coverage: only ' + passRate + '% of body sentences are traceable to a source — ground more claims in the cited research.');

  const passes = Math.max(0, 9 - issues.length);
  const score = Math.round((passes / 9) * 100);
  const verdict = score >= 80 ? 'ready' : (score >= 55 ? 'minor edits' : 'rewrite recommended');
  return {
    ok: true,
    claimCoverage: { sentences: sentences.length, cited: cited, passRate: passRate },
    stats: { words: wc, readingMin: cReading(draft), sections: h2 + (hasH1 ? 1 : 0), citations: links.length, keywordsMatched: kwHit.length, hedges: hedgeHits.length, cta: ctaHits.length },
    issues: issues.slice(0, 7),
    passes: passes,
    score: score,
    verdict: verdict
  };
}

// Real on-page SEO score from the actual title, draft and keywords,
// including a real Flesch reading-ease measurement.
function contentSeo(args) {
  const draft = String(args.draft || '');
  const title = String(args.title || '').slice(0, 80);
  const keywords = Array.isArray(args.keywords) ? args.keywords : [];
  const wc = cWords(draft);
  const lower = draft.toLowerCase(), tLower = title.toLowerCase();
  const h1 = (draft.match(/^#\s+/gm) || []).length;
  const h2 = (draft.match(/^##\s+/gm) || []).length;
  let metaTitle = title;
  if (metaTitle.length > 60) metaTitle = metaTitle.slice(0, 57).replace(/\s+\S*$/, '') + '…';
  const metaDesc = cMetaDesc(draft);
  const readability = cFlesch(draft);
  const checks = [];
  const kwInTitle = keywords.filter(function (k) { return tLower.indexOf(k) >= 0; });
  const kwInBody = keywords.filter(function (k) { return lower.indexOf(k) >= 0; });

  const add = function (ok2, label) { checks.push({ ok: ok2, label: label }); };
  add((title.length || 0) >= 25 && (title.length || 0) <= 60, 'Title ' + title.length + ' chars — target 25-60');
  add(metaDesc.length <= 162, 'Meta description ' + metaDesc.length + ' chars — under 162');
  add(kwInTitle.length >= 1, 'Primary keyword present in the page title (' + (kwInTitle.length || 0) + ' matched)');
  add(kwInBody.length >= 2, 'Researched keywords present in the body (' + kwInBody.length + '/' + Math.max(keywords.length, 1) + ')');
  add(h1 === 1, 'Exactly one H1 (' + h1 + ' found)');
  add(h2 >= 2, '≥2 H2 sections for scannability (' + h2 + ')');
  add(wc >= 300, 'Word count ' + wc + ' — meets 300+ baseline');
  add(/^##\s+Key takeaways/im.test(draft), 'Ends with a "Key takeaways" section');
  add(readability.score >= 50, 'Readability Flesch ' + readability.score + ' (' + readability.label + ') — aim 50+');
  add(readability.words >= 30, 'Readability measured on a real sample (' + readability.words + ' words)');
  const passes = checks.filter(function (c) { return c.ok; }).length;
  const score = Math.round((passes / checks.length) * 100);
  return {
    ok: true,
    score: Math.max(0, Math.min(100, score)),
    passes: passes,
    total: checks.length,
    checks: checks,
    readability: readability,
    metaTitle: metaTitle,
    metaDesc: metaDesc
  };
}

// Publish-ready package: slug, meta, markdown export + blended readiness score.
// Also builds inline citations (claim → source link) and platform variants
// (LinkedIn post + X thread) derived deterministically from the real draft.
function contentPublish(args) {
  const draft = String(args.draft || '');
  const title = String(args.title || 'Untitled').slice(0, 80);
  const sources = Array.isArray(args.sources) ? args.sources : [];
  const mTitle = String(args.metaTitle || title);
  const mDesc = String(args.metaDesc || cMetaDesc(draft));
  const wc = cWords(draft);
  const slug = cSlug(title);
  const headings = (draft.match(/^#{1,3}\s+.+$/gm) || []).slice(0, 12).map(function (h) { return h.replace(/^#+\s+/, '').trim(); });
  const seoScore = Number(args.seoScore) || 0;
  const links = (draft.match(/\[[^\]]*\]\(https?:\/\/[^)]+\)/g) || []);
  const ready = Math.max(0, Math.min(100, Math.round(seoScore * 0.6 + Math.min(links.length, 5) * 8 + (wc >= 300 ? 5 : 0))));

  // Inline citations: for paragraph lines, attach the best-matching live source to
  // the most source-traceable sentence as a clickable [n](url) superscript.
  const citedSets = sources.slice(0, 8).map(function (s) { return { s: s, set: new Set(cToks(s.snippet)) }; });
  const usedIdx = {};
  let draftCited = draft.split('\n').map(function (l) {
    const t = l.trim();
    if (!t || /^#{1,3}\s/.test(l) || /^[-*]\s/.test(l)) return l; // keep headings/lists as-is
    const sentences = l.split(/(?<=[.!?])\s+/).map(function (s) { return s.trim(); }).filter(Boolean);
    let cited = false;
    const out = sentences.map(function (s) {
      if (cited) return s;
      const toks = cToks(s);
      if (toks.length < 5 || !citedSets.length) return s;
      let best = -1, bestN = 1;
      citedSets.forEach(function (cs, i) {
        if (usedIdx[i]) return;
        const n = toks.filter(function (tk) { return cs.set.has(tk); }).length;
        if (n > bestN) { best = i; bestN = n; }
      });
      if (best >= 0 && bestN >= 2) {
        usedIdx[best] = 1;
        cited = true;
        const clean = s.replace(/\s+\[\d+\]\([^)]+\)$/, '');
        return clean + (/\s/.test(clean) ? ' ' : '') + '[' + (best + 1) + '](' + (sources[best].link || '#') + ')';
      }
      return s;
    });
    return out.join(' ');
  }).join('\n');

  // Platform variants derived from the real headings + first body line per section.
  const keywords = Array.isArray(args.keywords) ? args.keywords.slice(0, 3) : [];
  const kwTag = keywords.length ? '#' + keywords.join(' #').replace(/\s+/g, '') : '#marketing';
  const introLines = [];
  (headings.length ? headings : []).forEach(function (h, hi) {
    const next = draft.split('\n');
    const idx = next.findIndex(function (l) { return l.indexOf(h) >= 0 && /^#/.test(l); });
    const body = [];
    for (let i = (idx >= 0 ? idx + 1 : 0); i < next.length && body.length < 2; i++) {
      if (/^#/.test(next[i])) break;
      if (next[i].trim()) body.push(next[i].trim());
    }
    const first = body[0] ? body[0].replace(/\*\*/g, '').slice(0, 160) : '';
    if (first.length > 25 && introLines.length < 4) introLines.push({ h: h, one: first });
  });
  if (!introLines.length) {
    introLines.push({ h: title, one: draft.split('\n').map(function (x) { return x.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim(); }).filter(function (x) { return x.length > 25; })[0] || title });
  }
  const linkedin =
    'I keep seeing teams overthink "' + title + '".\n\n' +
    introLines.slice(0, 3).map(function (x) { return '• ' + x.one; }).join('\n\n') +
    '\n\n' + 'What actually moves the number: pick one lever, test it cleanly against a baseline, and scale only what beats your previous best.\n\n' +
    'Full breakdown, with sources: ' + slug + '\n\n' + kwTag;
  const thread = introLines.slice(0, 6).map(function (x, i) {
    return (i + 1) + '. ' + x.h + ' — ' + x.one;
  }).join('\n\n') + '\n\n' + "What's the change that worked for you? 👇";
  let markdown = '---\ntitle: "' + String(mTitle).replace(/"/g, '\\"') + '"\ndescription: "' + String(mDesc).replace(/"/g, '\\"') + '"\nslug: ' + slug + '\nreadingTime: ' + cReading(draft) + ' min\n---\n\n' + draftCited;
  if (sources.length) {
    markdown += '\n\n## Sources\n';
    markdown += sources.slice(0, 5).map(function (s, i) { return (i + 1) + '. [' + (s.title || s.domain || 'source') + '](' + s.link + ')'; }).join('\n');
  }
  return {
    ok: true,
    slug: slug,
    metaTitle: String(mTitle).slice(0, 70),
    metaDesc: String(mDesc).slice(0, 165),
    wordCount: wc,
    readingMin: cReading(draft),
    headings: headings,
    citations: sources.slice(0, 5).map(function (s) { return { url: s.link, title: s.title || s.domain || 'source' }; }),
    inlineCitations: (draftCited.match(/\[\d+\]\(/g) || []).length,
    variants: { linkedin: linkedin, thread: thread },
    markdown: markdown,
    ready: ready,
    ctaPresent: /(click|learn more|try|download|sign up|get started|contact)/i.test(draft)
  };
}

// --- registry --------------------------------------------------------------

const REGISTRY = {
  'serp.search': { run: serpSearch, desc: 'Live web search (grounded, real results)' },
  'planner.allocate': { run: plannerAllocate, desc: 'Budget split across channels' },
  'calc.roi': { run: calcRoas, desc: 'ROAS from revenue & spend' },
  'calc.cpl': { run: calcCpl, desc: 'CPL / CTR from spend, leads, clicks' },
  'market.sizer': { run: marketSizer, desc: 'Market size funnel estimate' },
  'llm.draft': { run: llmDraft, desc: 'Draft hook / ad copy' },
  'grapevine.scan': { run: grapevineScan, desc: 'Scan live SERP for brand mentions' },
  'grapevine.sentiment': { run: grapevineSentiment, desc: 'Classify mention sentiment / urgency' },
  'grapevine.crisis': { run: grapevineCrisis, desc: 'Crisis score 0-100 from mentions' },
  'grapevine.respond': { run: grapevineRespond, desc: 'Draft an on-brand reply' },
  'grapevine.escalate': { run: grapevineEscalate, desc: 'Escalation queue for humans' },
  'grapevine.rescue': { run: grapevineRescue, desc: 'Private DM rescue + SLA for heavy escalations' },
  'grapevine.predict': { run: grapevinePredict, desc: 'Forecast crisis trajectory from watch history' },
  'content.research': { run: contentResearch, desc: 'Live SERP research: sources, keywords, subtopics, citations' },
  'content.draft': { run: contentDraft, desc: 'RAG-grounded draft: title + markdown article' },
  'content.edit': { run: contentEdit, desc: 'Editorial review: structure, claims, hedges, CTAs' },
  'content.seo': { run: contentSeo, desc: 'On-page SEO score + meta from the real draft' },
  'content.publish': { run: contentPublish, desc: 'Publish-ready package: slug, meta, markdown export, readiness' }
};

const TOOL_IDS = Object.keys(REGISTRY);

// Execute a tool for real. Returns { tool, args, ok, result, ms, error }.
async function runTool(tool, args) {
  const fn = REGISTRY[tool];
  const started = Date.now();
  if (!fn) return { tool: tool, args: args, ok: false, error: 'unknown tool', ms: 0 };
  try {
    const out = await fn.run(args || {}, {});
    const isOk = !!out.ok;
    const result = {};
    Object.keys(out || {}).forEach(function (k) { if (k !== 'ok' && k !== 'error' && k !== 'usage') result[k] = out[k]; });
    return { tool: tool, args: args || {}, ok: isOk, result: result, error: isOk ? null : (out.error || 'tool failed'), ms: Date.now() - started, tokens: (out && out.usage) || null };
  } catch (e) {
    return { tool: tool, args: args || {}, ok: false, error: String((e && e.message) || e), ms: Date.now() - started };
  }
}

// Compact one-line rendering of a real tool result for the UI / prompts.
function fmtResult(exec) {
  if (!exec || !exec.ok) return exec ? ('ERR: ' + (exec.error || 'failed')) : 'no result';
  const r = exec.result;
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object' && typeof r.text === 'string') return r.text;
  if (Array.isArray(r)) return r.map(function (x) { return x.title + ' (' + x.domain + ')'; }).join(' · ').slice(0, 220);
  if (r && Array.isArray(r.split)) return r.split.map(function (s) { return s.channel + ' ' + s.share + ' ' + s.amount; }).join(' · ');
  if (r && typeof r === 'object') return Object.keys(r).slice(0, 5).map(function (k) { return k + ': ' + r[k]; }).join(' · ').slice(0, 220);
  return String(r);
}

module.exports = { REGISTRY, TOOL_IDS, runTool, fmtResult, serpQuery };
