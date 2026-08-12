const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

function base(url) { return String(url || '').replace(/\/+$/, ''); }
function cmd(parts) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv not configured'));
  return fetch(base(KV_URL) + '/' + parts.map(encodeURIComponent).join('/'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}
function num(j) {
  const v = j && j.result;
  const p = typeof v === 'number' ? v : parseInt(v, 10);
  return isNaN(p) ? 0 : p;
}
function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }
function zparse(result) {
  const arr = result && result.result;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    let member = arr[i];
    try { member = JSON.parse(member); } catch (e) {}
    out.push({ name: String(member).slice(0, 90), count: parseInt(arr[i + 1], 10) || 0 });
  }
  return out;
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET only' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.json({ ok: true, note: 'kv not configured', views: null }); return; }

  const now = Date.now();
  const day = isoDay(now);
  const hour = String(new Date(now).getHours());

  Promise.all([
    cmd(['get', 'analytics:views']),
    cmd(['get', 'analytics:views:' + day]),
    cmd(['get', 'analytics:views:hour:' + day + ':' + hour]),
    cmd(['zrevrange', 'analytics:pages', '0', '5']),
    cmd(['zrevrange', 'analytics:refs', '0', '7']),
    cmd(['zrevrange', 'analytics:devices', '0', '2']),
    cmd(['lrange', 'visitors:recent', '0', '14'])
  ]).then(function (items) {
    const pages = zparse(items[3]).filter(function (p) { return p.name !== '/'; });
    const refs = zparse(items[4]).slice(0, 6);
    const devices = zparse(items[5]).slice(0, 3);
    const visitors = (items[6].result || []).map(function (item) {
      try { return JSON.parse(item); } catch (e) { return null; }
    }).filter(Boolean).slice(0, 10);
    res.json({
      ok: true,
      views: { total: num(items[0]), today: num(items[1]), hour: num(items[2]) },
      pages: pages.slice(0, 5), refs: refs, devices: devices,
      visitors: visitors
    });
  }).catch(function (e) {
    res.json({ ok: true, note: 'unavailable', error: String(e) });
  });
};