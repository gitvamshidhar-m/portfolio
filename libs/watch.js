// Competitor watch — checks watched keywords against live SERP on a schedule
// (Vercel Cron hits /api/watch?cron=1) and alerts Telegram/email when a new
// competitor domain appears or an existing one's position shifts meaningfully.
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const TG_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TG_CHAT = (process.env.TELEGRAM_CHAT_ID || '').trim();
const { serp } = require('./tools/serp');

function kvCmd(action, key) {
  if (!KV_URL || !KV_TOKEN) return Promise.resolve(null);
  const base = String(KV_URL).replace(/\/$/, '');
  const url = (Array.isArray(key) ? key : [key]).map(encodeURIComponent).join('/');
  return fetch(base + '/' + action + '/' + url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); }).catch(function () { return null; });
}
function kvGet(key) { return kvCmd('get', key).then(function (j) { return (j && j.result != null) ? j.result : null; }); }
function kvSet(key, val, ttlSec) {
  const base = String(KV_URL).replace(/\/$/, '');
  const url = base + '/set/' + encodeURIComponent(key) + '?value=' + encodeURIComponent(String(val));
  return fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN } })
    .then(function () { return fetch(base + '/expire/' + encodeURIComponent(key) + '/' + (ttlSec || 86400), { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN } }); })
    .catch(function () {});
}
async function getQueries() {
  const v = await kvGet('watch:queries');
  try { const a = JSON.parse(v); return Array.isArray(a) ? a.filter(Boolean) : []; } catch (e) { return []; }
}
async function setQueries(list) { return kvSet('watch:queries', JSON.stringify(list.slice(0, 50)), 31536000); }

function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

// Alert via Telegram, falling back to nothing (webhook email optional).
function sendAlert(message) {
  const parts = [];
  if (TG_TOKEN && TG_CHAT) {
    parts.push(fetch('https://api.telegram.org/bot' + TG_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: String(TG_CHAT), text: message.slice(0, 3900) })
    }).catch(function () {}));
  }
  return Promise.all(parts);
}

// Run the watch: for each query, fetch SERP, diff domains/positions vs the last
// snapshot, and alert on meaningful change. Returns a summary per query.
async function runWatch() {
  const queries = await getQueries();
  const results = [];
  for (const q of queries) {
    const key = 'watch:snap:' + encodeURIComponent(q).slice(0, 120);
    const prev = await kvGet(key);
    let prevDomains = [], prevRank = {};
    try { const p = JSON.parse(prev); prevDomains = p.domains || []; prevRank = p.rank || {}; } catch (e) {}
    const live = await serp(q, { num: 10 });
    const now = Array.isArray(live) ? live : [];
    const domains = now.map(function (r) { return domainOf(r.link); }).filter(Boolean);
    const rank = {};
    now.forEach(function (r, i) { const d = domainOf(r.link); if (d && !(d in rank)) rank[d] = i + 1; });
    const newComps = domains.filter(function (d) { return prevDomains.indexOf(d) < 0; });
    let moveMsg = [];
    for (const d of Object.keys(rank)) {
      if (prevRank[d] && Math.abs(prevRank[d] - rank[d]) >= 3) {
        moveMsg.push(d + ': ' + prevRank[d] + ' → #' + rank[d]);
      }
    }
    await kvSet(key, JSON.stringify({ domains: domains.slice(0, 10), rank: rank }), 31536000);
    results.push({ query: q, results: now.length, newCompetitors: newComps, moves: moveMsg });
    if (newComps.length || moveMsg.length) {
      await sendAlert('🔎 Competitor watch: "' + q + '"\n' +
        (newComps.length ? 'NEW domains: ' + newComps.slice(0, 5).join(', ') + '\n' : '') +
        (moveMsg.length ? 'Rank moves: ' + moveMsg.slice(0, 5).join(', ') + '\n' : ''));
    }
  }
  await kvSet('watch:last', JSON.stringify({ at: Date.now(), results: results }), 86400);
  return results;
}

module.exports = function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.searchParams.get('cron') === '1') {
    // Vercel Cron auth: header is "Bearer <CRON_SECRET>" or the x-vercel-cron header.
    const auth = String(req.headers['authorization'] || '');
    const cronHdr = String(req.headers['x-vercel-cron'] || '');
    const secret = (process.env.CRON_SECRET || '').trim();
    if (secret && auth !== 'Bearer ' + secret) return res.status(401).json({ error: 'unauthorized' });
    if (!secret && cronHdr !== '1') return res.status(401).json({ error: 'unauthorized' });
    return runWatch().then(function (r) { res.json({ ok: true, checked: r.length }); })
      .catch(function (e) { res.status(500).json({ error: String((e && e.message) || 'watch failed') }); });
  }
  if (req.method === 'GET') {
    return Promise.all([getQueries(), kvGet('watch:last')]).then(function (r) {
      let last = null;
      try { last = JSON.parse(r[1]); } catch (e) {}
      return res.json({ queries: r[0], last: last });
    });
  }
  if (req.method === 'POST') {
    // Guard write actions: when WATCH_ADMIN_TOKEN is set, the caller must send it
    // as "Authorization: Bearer <token>" or "x-watch-token: <token>".
    const adminToken = (process.env.WATCH_ADMIN_TOKEN || '').trim();
    if (adminToken) {
      const auth = String(req.headers['authorization'] || '');
      const hdr = String(req.headers['x-watch-token'] || '');
      if (auth !== 'Bearer ' + adminToken && hdr !== adminToken) {
        return res.status(401).json({ error: 'unauthorized' });
      }
    }
    let b = {};
    try { b = req.body || {}; } catch (e) {}
    const action = String(b.action || '');
    const query = String(b.query || '').trim().slice(0, 120);
    if (action === 'add' && query) {
      return getQueries().then(function (list) {
        if (list.indexOf(query) < 0) list.push(query);
        return setQueries(list).then(function () { return res.json({ ok: true, queries: list }); });
      });
    }
    if (action === 'remove' && query) {
      return getQueries().then(function (list) {
        const out = list.filter(function (q) { return q !== query; });
        return setQueries(out).then(function () { return res.json({ ok: true, queries: out }); });
      });
    }
    if (action === 'run') {
      return runWatch().then(function (r) { return res.json({ ok: true, results: r }); })
        .catch(function (e) { res.status(500).json({ error: String((e && e.message) || 'watch failed') }); });
    }
    return res.status(400).json({ error: 'action must be add | remove | run' });
  }
  return res.status(405).json({ error: 'method not allowed' });
};
