const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

function base(url) { return String(url || '').replace(/\/+$/, ''); }
function kv(action, args, method) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv not configured'));
  const path = (Array.isArray(args) ? args : [args]).map(encodeURIComponent).join('/');
  return fetch(base(KV_URL) + '/' + action + '/' + path, {
    method: method || 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}
function safe(s, len) {
  return String(s || '').replace(/[^\w@.\-/:#?&=+%\s]/g, '').slice(0, len || 80);
}
function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  if (!KV_URL || !KV_TOKEN) {
    res.json({ ok: true, note: 'kv not configured, skipped' });
    return;
  }

  let body = {};
  try { body = (req.body && typeof req.body === 'object') ? req.body : {}; } catch (e) {}
  const now = Date.now();
  const day = isoDay(now);
  const hour = String(new Date(now).getHours());
  const path = safe(body.path || '/', 80) || '/';
  const referrer = String(body.referrer || '').slice(0, 200);
  const refHost = referrer && /^https?:\/\//i.test(referrer)
    ? safe(new URL(referrer).hostname.replace(/^www\./, '') || 'direct', 80)
    : 'direct';
  const ua = String(body.ua || '');
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const device = mobile ? 'mobile' : 'desktop';
  const cityRaw = (req.headers && (req.headers['x-vercel-ip-city'] || req.headers['x-vercel-ip-country'])) || '';
  const city = (function () {
    if (!cityRaw) return '';
    try { return decodeURIComponent(String(cityRaw)).replace(/[^\w\s\-]/g, '').slice(0, 40); } catch (e) { return String(cityRaw).slice(0, 40); }
  })();

  // counts (plain counters)
  const counters = [
    kv('incr', ['analytics:views']),
    kv('incr', ['analytics:views:' + day]),
    kv('incr', ['analytics:views:hour:' + day + ':' + hour])
  ];
  // weighted sorted sets for ranking (zincrby +1 per member)
  const zsets = [
    kv('zincrby', ['analytics:pages', '1', path]),
    kv('zincrby', ['analytics:refs', '1', refHost]),
    kv('zincrby', ['analytics:devices', '1', device])
  ];

  Promise.all(counters.concat(zsets)).then(function () {
    return fetch(base(KV_URL) + '/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify([
        ['LPUSH', 'visitors:recent', JSON.stringify({ t: now, day: day, hour: hour, ref: refHost.slice(0, 60), path: path.slice(0, 60), device: device, city: city.slice(0, 40) })],
        ['LTRIM', 'visitors:recent', 0, 19]
      ])
    }).then(function () { res.json({ ok: true }); }).catch(function () { res.json({ ok: true, note: 'partial' }); });
  }).catch(function () {
    res.json({ ok: true, note: 'partial' });
  });
};
