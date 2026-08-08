const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const ADMIN_TOKEN = (process.env.ADMIN_DASHBOARD_TOKEN || '').trim();

function base(url) {
  return String(url || '').replace(/\/+$/, '');
}
function command(parts) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('KV not configured'));
  return fetch(base(KV_URL) + '/' + parts.map(encodeURIComponent).join('/'), {
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { if (!r.ok) throw new Error('KV request failed'); return r.json(); });
}
function number(result) {
  const value = result && result.result;
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return isNaN(parsed) ? 0 : parsed;
}
function isoDay(offset) {
  const d = new Date(Date.now() + (offset || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}
function authorized(req) {
  const header = String((req.headers && (req.headers.authorization || req.headers['x-admin-token'])) || '');
  const token = header.replace(/^Bearer\s+/i, '').trim();
  return ADMIN_TOKEN && token === ADMIN_TOKEN;
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'ADMIN_DASHBOARD_TOKEN is not configured' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!KV_URL || !KV_TOKEN) return res.status(503).json({ error: 'KV storage is not configured' });

  // last 14 days, oldest first
  const days = Array.from({ length: 14 }, function (_, i) { return { day: isoDay(i - 13), key: 'views:daily:' + isoDay(i - 13) }; });

  Promise.all([
    command(['get', 'profile:views']), command(['get', 'profile:resume']), command(['get', 'profile:messages']), command(['get', 'profile:spam']),
    command(['lrange', 'leads:recent', '0', '49'])
  ].concat(days.map(function (d) { return command(['get', d.key]); })))
    .then(function (items) {
      const leads = (items[4].result || []).map(function (item) { try { return JSON.parse(item); } catch (e) { return null; } }).filter(Boolean);
      const series = days.map(function (d, i) { return { day: d.day, views: number(items[5 + i]) }; });
      res.json({ metrics: { views: number(items[0]), resumes: number(items[1]), messages: number(items[2]), spamBlocked: number(items[3]) }, leads: leads, views14: series });
    }).catch(function () {
      res.status(502).json({ error: 'Unable to load dashboard data' });
    });
};
