// Live GitHub "pulse" — how many pushes landed today, derived from the public
// GitHub events API (no token needed) and cached in KV for ~10 minutes.
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const USER = 'gitvamshidhar-m';
const CACHE_KEY = 'pulse:cache';

function base(u) { return String(u || '').replace(/\/+$/, ''); }
function kvCmd(action, parts) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv off'));
  const path = (Array.isArray(parts) ? parts : [parts]).map(encodeURIComponent).join('/');
  return fetch(base(KV_URL) + '/' + action + '/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}

function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  try {
    const j = await kvCmd('get', [CACHE_KEY]);
    if (j && j.result) {
      const d = JSON.parse(j.result);
      if (d && d.data && d.at && (Date.now() - d.at) < 10 * 60 * 1000) {
        res.json(d.data);
        return;
      }
    }
  } catch (e) {}
  try {
    const r = await fetch('https://api.github.com/users/' + USER + '/events/public', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'vamshidharm-portfolio' }
    });
    const ev = (await r.json()) || [];
    const today = isoDay(Date.now());
    const pushesToday = (Array.isArray(ev) ? ev : []).filter(function (e) {
      return e.type === 'PushEvent' && isoDay(e.created_at) === today;
    }).length;
    const last = (Array.isArray(ev) ? ev : []).find(function (e) { return e.type === 'PushEvent'; });
    const data = { pushesToday: pushesToday, lastPushAt: (last && last.created_at) || null };
    try { await kvCmd('set', [CACHE_KEY, JSON.stringify({ data: data, at: Date.now() })]); } catch (e) {}
    res.json(data);
  } catch (e) {
    res.json({ pushesToday: 0, lastPushAt: null });
  }
};