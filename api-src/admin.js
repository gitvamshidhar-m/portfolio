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
function zparse(result) {
  // zrevrange returns {result: [member1, score1, member2, score2, ...]}
  const arr = result && result.result;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    let member = arr[i];
    try { member = JSON.parse(member); } catch (e) {}
    out.push({ name: member, count: parseInt(arr[i + 1], 10) || 0 });
  }
  return out;
}

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!ADMIN_TOKEN) return res.status(503).json({ error: 'ADMIN_DASHBOARD_TOKEN is not configured' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });
  if (!KV_URL || !KV_TOKEN) return res.status(503).json({ error: 'KV storage is not configured' });

  const days = Array.from({ length: 14 }, function (_, i) { return { day: isoDay(i - 13), key: 'views:daily:' + isoDay(i - 13) }; });
  const today = isoDay(0);
  const hours = Array.from({ length: 24 }, function (_, i) { return { hour: i, key: 'analytics:views:hour:' + today + ':' + i }; });

  Promise.all([
    command(['get', 'profile:views']), command(['get', 'profile:resume']), command(['get', 'profile:messages']), command(['get', 'profile:spam']),
    command(['lrange', 'leads:recent', '0', '49'])
  ].concat(
    days.map(function (d) { return command(['get', d.key]); }),
    hours.map(function (h) { return command(['get', h.key]); }),
    [
      command(['zrevrange', 'analytics:pages', '0', '9']),
      command(['zrevrange', 'analytics:refs', '0', '9']),
      command(['zrevrange', 'analytics:devices', '0', '4']),
      command(['get', 'analytics:views'])
    ]
  ))
    .then(function (items) {
      const leads = (items[4].result || []).map(function (item) { try { return JSON.parse(item); } catch (e) { return null; } }).filter(Boolean);
      const series = days.map(function (d, i) { return { day: d.day, views: number(items[5 + i]) }; });
      const hOffset = 5 + days.length;
      const hourly = hours.map(function (h, i) { return { hour: h.hour, views: number(items[hOffset + i]) }; });
      const aOffset = hOffset + hours.length;
      const pages = zparse(items[aOffset]);
      const refs = zparse(items[aOffset + 1]);
      const devices = zparse(items[aOffset + 2]);
      const totalViews = number(items[aOffset + 3]);
      res.json({
        metrics: { views: totalViews || number(items[0]), resumes: number(items[1]), messages: number(items[2]), spamBlocked: number(items[3]) },
        leads: leads, views14: series, hourly: hourly, pages: pages, refs: refs, devices: devices
      });
    }).catch(function (e) {
      res.status(502).json({ error: 'Unable to load dashboard data' });
    });
};
