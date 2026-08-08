const KEY = 'profile:views';

function isoDay(offset) {
  const d = new Date(Date.now() + (offset || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

function kvCmd(baseUrl, token, command, key, method) {
  const url = String(baseUrl).replace(/\/$/, '') + '/' + command + '/' + encodeURIComponent(key);
  return fetch(url, {
    method: method || 'POST',
    headers: { Authorization: 'Bearer ' + token }
  }).then(function (r) { return r.json(); });
}

module.exports = function handler(req, res) {
  const url = (process.env.KV_REST_API_URL || '').trim();
  const token = (process.env.KV_REST_API_TOKEN || '').trim();
  if (!url || !token) {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: null, note: 'KV not configured' });
    return;
  }
  const day = isoDay(0);
  Promise.all([
    kvCmd(url, token, 'incr', KEY),
    kvCmd(url, token, 'incr', 'views:daily:' + day)
  ]).then(function (items) {
    const j = items[0];
    const v = j && typeof j.result === 'number' ? j.result : (j.value || j);
    const n = (typeof v === 'number') ? v : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: n, day: day });
  }).catch(function () {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: null });
  });
};