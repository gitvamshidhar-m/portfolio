const KEY = 'profile:views';

function kvRequest(baseUrl, token) {
  const url = String(baseUrl).replace(/\/$/, '') + '/incr/' + KEY;
  return fetch(url, {
    method: 'POST',
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
  kvRequest(url, token).then(function (j) {
    const v = j && typeof j.result === 'number' ? j.result : (j.value || j);
    const n = (typeof v === 'number') ? v : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: n });
  }).catch(function () {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: null });
  });
};