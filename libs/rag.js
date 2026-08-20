const KB = require('../libs/kb');

const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
function kvPipe(pipe) {
  if (!KV_URL || !KV_TOKEN) return Promise.resolve();
  return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {});
}
function sanitize(s, len) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, len || 200);
}

const STOP = new Set('a,an,the,and,or,but,to,of,for,in,on,at,is,are,was,were,am,be,been,being,do,does,did,you,your,youre,me,my,i,we,us,can,could,will,would,should,what,how,why,who,which,when,where,about,with,as,that,this,it,from,not,they,them,have,having,has,tell,me'.split(','));

const TOPIC_META = {
  profile: { label: 'Profile', url: '/#about' },
  experience: { label: 'Experience', url: '/experience.html' },
  products: { label: 'AI Products', url: '/#projects' },
  results: { label: 'Case Studies', url: '/blog.html' },
  skills: { label: 'Skills', url: '/skills.html' },
  approach: { label: 'Approach', url: '/about.html' },
  hire: { label: 'Hire Me', url: '/hire.html' },
  compare: { label: 'Compare Me', url: '/hire-recruiters.html' },
  contact: { label: 'Contact', url: '/#contact' },
  education: { label: 'Education', url: '/resume.html' },
  tools: { label: 'This Site', url: '/about.html' },
  greeting: { label: 'Hello', url: '/' }
};

const rl = { hits: {}, last: Date.now() };
const RL_WIN = 60000, RL_MAX = 20;
function rate(key) {
  const now = Date.now();
  if (now - rl.last > RL_WIN) { rl.hits = {}; rl.last = now; }
  rl.hits[key] = (rl.hits[key] || 0) + 1;
  return rl.hits[key];
}
function ipOf(req) {
  return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40);
}

function toks(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (t) { return t && !STOP.has(t); });
}

function retrieve(question, topN) {
  const q = toks(question);
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

function buildSystem(ctx, who) {
  const whoLine = who
    ? '\nVISITOR: They are from/related to "' + who + '". Tailor the greeting to them and their company, and let them know you are contactable for that context.'
    : '';
  return 'You are \"Vamshidhara\", the AI assistant on Vamshidhar Reddy M\'s personal portfolio.\n\n'
    + 'THE PERSON: Vamshidhar Reddy M is an performance marketer who builds AI tools (10+ years) who also builds his own software tools. He is from Hyderabad, India, and is open to work.\n\n'
    + 'RULES:\n'
    + '- Answer in the FIRST PERSON, as Vamshidhar (say \"I\" / \"my\"). Be concise (2-6 short sentences), warm and professional.\n'
    + '- Ground every answer ONLY in the CONTEXT below. Never invent facts, numbers, tools, or URLs that are not in the context.\n'
    + '- If the context does not contain the answer, say you do not have that detail on hand and offer topics: SEO, PPC/ads, AI tools, products, or hire me.\n'
    + '- Small talk (hi, hello, thanks) -> greet warmly and offer to help.\n'
    + '- For hiring/contact, point to email geovamshidhar@gmail.com, phone +91-7981719085, or the Contact section; include the portfolio URL https://vamshidharm.vercel.app and any live product URLs from the context.\n'
    + 'COMPARE MODE: if the visitor asks to compare me with someone else (e.g. a generalist, an agency, a developer, a junior), answer as an honest that-vs-me matchup: acknowledge where the other side is genuinely strong, then state my landed proof (ROAS 3.2x-to-5.5x, CPL Rs.1,100-to-Rs.770, +15% traffic, 70+ leads/mo, 3 solo AI products) and the trade-offs (e.g. not a giant brand-scale media team). Only use facts present in CONTEXT.\n'
    + 'SPECIAL OPTION: a visitor may identify as being from a specific company (e.g. through a special link I share). If so, greet them personally and tailor your 30-second pitch toward what they do.\n\n'
    + whoLine + '\n\n'
    + 'CONTEXT:\n' + (ctx || '(no relevant context found)');
}

module.exports = function handler(req, res) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, message: 'POST /api/rag with {"question":"..."}', mode: process.env.GROQ_API_KEY ? 'rag' : 'offline' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let question = '';
  let who = '';
  try {
    question = ((req.body && req.body.question) || '').toString().trim().slice(0, 500);
    who = ((req.body && req.body.who) || '').toString().trim().slice(0, 80);
  } catch (e) { question = ''; }
  if (!question) {
    res.status(400).json({ error: 'missing question' });
    return;
  }

  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key) {
    res.json({ answer: null, offline: true });
    return;
  }

  const n = rate(ipOf(req) + ':' + question.slice(0, 32).toLowerCase());
  if (n > RL_MAX) {
    res.status(429).json({ error: 'rate limited', answer: null });
    return;
  }

  const best = retrieve(question, 4);
  const ctx = best.map(function (b, i) { return (i + 1) + '. [' + b.topic + '] ' + b.text; }).join('\n\n');

  fetch(GROQ, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.35,
      max_tokens: 460,
      messages: [
        { role: 'system', content: buildSystem(ctx, who) },
        { role: 'user', content: 'Question: ' + question }
      ]
    })
  }).then(function (r) { return r.json(); }).then(function (j) {
    const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null;
    const citations = best.map(function (b) {
      const meta = TOPIC_META[b.topic] || { label: b.topic, url: null };
      return { topic: b.topic, label: meta.label, url: meta.url };
    });
    res.json({ answer: answer, mode: 'rag', source: (citations[0] ? citations[0].label : null) || null, citations: citations });
    if (answer) {
      const topic = (best.length ? best[0].topic : 'general');
      const q = sanitize(question, 220);
      const a = sanitize(answer, 500);
      if (q.length > 12 && a.length > 12) {
        kvPipe([
          ['LPUSH', 'ama:recent', JSON.stringify({ q: q, a: a, topic: topic, ts: Date.now(), ip: ipOf(req) })],
          ['LTRIM', 'ama:recent', 0, 39]
        ]);
      }
    }
  }).catch(function (err) {
    res.json({ answer: null, offline: true, error: String(err) });
  });
};