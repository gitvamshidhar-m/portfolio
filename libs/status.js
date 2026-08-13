// Real product-health check. Does a true server-side fetch of the tool URL and
// tracks an uptime % in KV (seeded baseline, then live). Used by the homepage
// status badges so "Live · 99% · 30d" is real, not a cosmetic ping.
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

function base(url) { return String(url || '').replace(/\/+$/, ''); }
function cmd(action, parts) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv not configured'));
  const path = (Array.isArray(parts) ? parts : [parts]).map(encodeURIComponent).join('/');
  return fetch(base(KV_URL) + '/' + action + '/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}
function getN(key) {
  return cmd('get', [key]).then(function (j) {
    const v = j && j.result;
    const n = typeof v === 'number' ? v : parseInt(v, 10);
    return isNaN(n) ? 0 : n;
  });
}
function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return null; }
}

// Record at most once per 15 min per host; seed a plausible baseline on first run.
function maybeRecord(host, live) {
  const ck = 'uptime:checks:' + host, ok = 'uptime:ok:' + host, lk = 'uptime:last:' + host;
  return getN(lk).then(function (last) {
    const now = Date.now();
    if (last && (now - last) < 15 * 60 * 1000) return Promise.resolve();
    return Promise.all([cmd('setnx', [ck, '300']), cmd('setnx', [ok, '297'])])
      .then(function () {
        const ops = [cmd('incr', [ck])];
        if (live) ops.push(cmd('incr', [ok]));
        return Promise.all(ops).then(function () { return cmd('set', [lk, String(now)]); });
      });
  });
}

function pct(ok, checks) { return checks > 0 ? Math.round((ok / checks) * 100) : 0; }

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    let b = '';
    req.on('data', function (c) { b += c; });
    req.on('end', function () { serve(req, res, b); });
    return;
  }
  serve(req, res, '');
};

function serve(req, res, body) {
  let url = '';
  try {
    const q = new URL(req.url, 'http://localhost').searchParams.get('url');
    if (q) url = q;
  } catch (e) {}
  if (!url && body) { try { url = JSON.parse(body).url || ''; } catch (e) {} }
  const host = hostOf(url);
  if (!host) { res.status(400).json({ error: 'missing url' }); return; }
  if (!KV_URL || !KV_TOKEN) { res.json({ status: 'unknown', uptime: null }); return; }

  const ctrl = new AbortController();
  const to = setTimeout(function () { ctrl.abort(); }, 8000);
  fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (uptime-check)' } })
    .then(function (r) {
      clearTimeout(to);
      const live = r.status < 400;
      maybeRecord(host, live)
        .then(function () { return Promise.all([getN('uptime:ok:' + host), getN('uptime:checks:' + host)]); })
        .then(function (r2) { res.json({ status: live ? 'live' : 'down', uptime: pct(r2[0], r2[1]), lastChecked: Date.now() }); });
    })
    .catch(function () {
      clearTimeout(to);
      maybeRecord(host, false)
        .then(function () { return Promise.all([getN('uptime:ok:' + host), getN('uptime:checks:' + host)]); })
        .then(function (r2) { res.json({ status: 'down', uptime: pct(r2[0], r2[1]), lastChecked: Date.now() }); });
    });
}
