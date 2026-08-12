const KEYS = { views: 'profile:views', resume: 'profile:resume', messages: 'profile:messages', spam: 'profile:spam' };

let cache = { vals: null, at: 0 };
const CACHE_MS = 10000;

function base(url) {
  return String(url || '').replace(/\/+$/, '');
}
function kvFetch(url, token, action, key, method) {
  const target = base(url) + '/' + action + '/' + key;
  return fetch(target, { method: method || 'GET', headers: { Authorization: 'Bearer ' + token } }).then(function (r) { return r.json(); });
}
function readKey(url, token, key) {
  return kvFetch(url, token, 'get', key).then(function (j) {
    if (j && typeof j.result === 'number') return j.result;
    const v = j && typeof j.result === 'string' ? parseInt(j.result, 10) : NaN;
    return isNaN(v) ? 0 : v;
  });
}
function readAll(url, token) {
  const now = Date.now();
  if (cache.at && now - cache.at < CACHE_MS) {
    return Promise.resolve(cache.vals);
  }
  return Promise.all(['views', 'resume', 'messages', 'spam'].map(function (k) { return readKey(url, token, KEYS[k]); }))
    .then(function (vals) { cache = { vals: vals, at: Date.now() }; return vals; });
}

module.exports = function handler(req, res) {
  const url = (process.env.KV_REST_API_URL || '').trim();
  const token = (process.env.KV_REST_API_TOKEN || '').trim();
  if (!url || !token) {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: null, resume: null, messages: null, note: 'KV not configured' });
    return;
  }
  const respond = function (vals) {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ views: vals[0], resume: vals[1], messages: vals[2], spam: vals[3] });
  };

  if (req.method === 'POST') {
    let event = '';
    try { event = String((req.body && req.body.event) || '').trim(); } catch (e) { /* ignore */ }
    const key = KEYS[event] || KEYS.messages;
    kvFetch(url, token, 'incr', key, 'POST').then(function () {
      return readAll(url, token);
    }).then(respond).catch(function () {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ views: null, resume: null, messages: null });
    });
  } else {
    readAll(url, token).then(respond).catch(function () {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ views: null, resume: null, messages: null });
    });
  }
};