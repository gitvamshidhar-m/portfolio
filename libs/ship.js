// AI "this week I shipped" summary — reads recent commits from the GitHub cache
// (populated by libs/github.js) and asks Groq to narrate them like a human build log.
// No Groq key? Falls back to a clean rule-based summary so it never dead-ends.
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const CACHE_KEY = 'ship:summary';

function base(u) { return String(u || '').replace(/\/+$/, ''); }
function kvCmd(action, parts) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv off'));
  const path = (Array.isArray(parts) ? parts : [parts]).map(encodeURIComponent).join('/');
  return fetch(base(KV_URL) + '/' + action + '/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}

async function readCommits() {
  try {
    const j = await kvCmd('get', ['github:cache']);
    const v = j && j.result;
    if (v) {
      const c = JSON.parse(v);
      if (c && Array.isArray(c.commits) && c.commits.length) return c.commits;
    }
  } catch (e) {}
  return [];
}

function ruleSummary(commits) {
  const msgs = commits.slice(0, 6).map(function (c) { return String(c.message || '').split('\n')[0].trim(); }).filter(Boolean);
  if (!msgs.length) return 'Shipping weekly — new builds, experiments and fixes landing here.';
  const recent = msgs.slice(0, 4).map(function (m) { return m.length > 52 ? m.slice(0, 52) + '…' : m; }).join(', ');
  return 'Latest builds: ' + recent + '.';
}

function llmSummary(commits, key) {
  const msgs = commits.slice(0, 12).map(function (c) { return '- ' + String(c.message || '').trim(); }).join('\n');
  return fetch(GROQ, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.6,
      max_tokens: 130,
      messages: [
        { role: 'system', content: 'You write one warm, plain-English 1-2 sentence update titled "What I shipped recently" for a performance marketer\'s portfolio, from a list of git commit messages. Sound specific and human, never hype-y, no lists, no emojis, no hashtags.' },
        { role: 'user', content: 'Recent commits:\n' + msgs }
      ]
    })
  }).then(function (r) { return r.json(); }).then(function (j) {
    const t = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return t.trim();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  try {
    const j = await kvCmd('get', [CACHE_KEY]);
    if (j && j.result) {
      const d = JSON.parse(j.result);
      if (d && d.summary && d.at && (Date.now() - d.at) < 6 * 3600 * 1000) {
        res.json({ summary: d.summary, cached: true });
        return;
      }
    }
  } catch (e) {}
  const commits = await readCommits();
  const key = (process.env.GROQ_API_KEY || '').trim();
  let summary = '';
  if (key && commits.length) { try { summary = await llmSummary(commits, key); } catch (e) { summary = ''; } }
  if (!summary) summary = ruleSummary(commits);
  try { await kvCmd('set', [CACHE_KEY, JSON.stringify({ summary: summary, at: Date.now() })]); } catch (e) {}
  res.json({ summary: summary, cached: false, count: commits.length });
};
