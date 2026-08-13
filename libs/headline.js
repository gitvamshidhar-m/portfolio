// Live A/B headline votes, persisted in Vercel KV (Upstash Redis REST).
// GET  -> { a, b } current global counts (seeds a baseline on first read)
// POST { v: 'a' | 'b' } -> records one vote, returns new counts
const KA = 'abtest:a';
const KB = 'abtest:b';
const SEED_A = 46;
const SEED_B = 54;

function kvCmd(baseUrl, token, command, path) {
  const url = String(baseUrl).replace(/\/$/, '') + '/' + command + '/' + path;
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

function getNum(j) {
  if (j && typeof j.result === 'number') return j.result;
  if (j && typeof j.value === 'number') return j.value;
  if (j && typeof j.result === 'string') return parseInt(j.result, 10) || 0;
  return 0;
}

function counts(url, token) {
  return Promise.all([kvCmd(url, token, 'get', KA), kvCmd(url, token, 'get', KB)])
    .then(function (items) { return { a: getNum(items[0]), b: getNum(items[1]) }; });
}

// Seed a baseline once (setnx is a no-op if the key already exists).
function ensureSeed(url, token) {
  return Promise.all([
    kvCmd(url, token, 'setnx', KA + '/' + SEED_A),
    kvCmd(url, token, 'setnx', KB + '/' + SEED_B)
  ]).then(function () { return counts(url, token); });
}

module.exports = function handler(req, res) {
  const e = env();
  if (!e.url || !e.token) return send(res, { a: SEED_A, b: SEED_B, note: 'KV not configured' });

  if (req.method === 'POST') {
    let body = '';
    req.on('data', function (c) { body += c; });
    req.on('end', function () {
      let v = 'a';
      try { v = (JSON.parse(body || '{}').v === 'b') ? 'b' : 'a'; } catch (e) { v = 'a'; }
      const key = v === 'a' ? KA : KB;
      const other = v === 'a' ? KB : KA;
      // Ensure baseline exists before incrementing.
      kvCmd(e.url, e.token, 'setnx', key + '/' + (v === 'a' ? SEED_A : SEED_B))
        .then(function () {
          return kvCmd(e.url, e.token, 'incr', key);
        })
        .then(function (j) {
          const n = getNum(j);
          return kvCmd(e.url, e.token, 'get', other).then(function (oj) {
            return send(res, v === 'a' ? { a: n, b: getNum(oj) } : { a: getNum(oj), b: n });
          });
        })
        .catch(function () { send(res, { a: SEED_A, b: SEED_B }); });
    });
    return;
  }

  counts(e.url, e.token)
    .then(function (c) {
      if (c.a === 0 && c.b === 0) return ensureSeed(e.url, e.token);
      return c;
    })
    .then(function (c) { send(res, c); })
    .catch(function () { send(res, { a: SEED_A, b: SEED_B }); });
};
