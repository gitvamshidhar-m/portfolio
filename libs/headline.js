// Live A/B headline votes, persisted in Vercel KV (Upstash Redis REST).
// GET  -> { a, b } current global counts
// POST { v: 'a' | 'b' } -> records one vote, returns new counts
const KA = 'abtest:a';
const KB = 'abtest:b';

function kvCmd(baseUrl, token, command, key) {
  const url = String(baseUrl).replace(/\/$/, '') + '/' + command + '/' + encodeURIComponent(key);
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token }
  }).then(function (r) { return r.json(); });
}

function env() {
  return {
    url: (process.env.KV_REST_API_URL || '').trim(),
    token: (process.env.KV_REST_API_TOKEN || '').trim()
  };
}

function send(res, payload) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

module.exports = function handler(req, res) {
  const e = env();
  if (!e.url || !e.token) return send(res, { a: 0, b: 0, note: 'KV not configured' });

  const getNum = function (j) {
    if (j && typeof j.result === 'number') return j.result;
    if (j && typeof j.value === 'number') return j.value;
    return j && typeof j.result === 'string' ? parseInt(j.result, 10) || 0 : 0;
  };

  if (req.method === 'POST') {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      let v = 'a';
      try { v = (JSON.parse(body || '{}').v === 'b') ? 'b' : 'a'; } catch (e) { v = 'a'; }
      const key = v === 'a' ? KA : KB;
      kvCmd(e.url, e.token, 'incr', key)
        .then(function (j) {
          const n = getNum(j);
          return Promise.all([
            Promise.resolve(v === 'a' ? n : null),
            kvCmd(e.url, e.token, 'get', v === 'a' ? KB : KA).then(getNum)
          ]).then(function (r) {
            send(res, { a: v === 'a' ? n : r[1], b: v === 'b' ? n : r[1] });
          });
        })
        .catch(function () { send(res, { a: 0, b: 0 }); });
    });
    return;
  }

  Promise.all([kvCmd(e.url, e.token, 'get', KA), kvCmd(e.url, e.token, 'get', KB)])
    .then(function (items) {
      send(res, { a: getNum(items[0]), b: getNum(items[1]) });
    })
    .catch(function () { send(res, { a: 0, b: 0 }); });
};
