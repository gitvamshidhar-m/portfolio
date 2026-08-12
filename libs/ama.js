const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
function base(url) { return String(url || '').replace(/\/+$/, ''); }
function kv(action, args) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv not configured'));
  const path = (Array.isArray(args) ? args : [args]).map(encodeURIComponent).join('/');
  return fetch(base(KV_URL) + '/' + action + '/' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN } }).then(function (r) { return r.json(); });
}

// A few evergreen, genuine questions people ask the chat (grounded in the real KB).
const SEED = [
  { q: "Are you open to remote roles?", a: "Yes — I'm based in Hyderabad (IST) and open to remote for the right team. I usually reply within 24h.", topic: "hire" },
  { q: "How is AI automation different from generic SaaS?", a: "Mine is built on your context and data — your offers, tone and playbooks — so outputs stay on-brand instead of generic. See the Hook AI copy engine, live on this site.", topic: "ai" },
  { q: "What ROI can a performance marketer who builds tools deliver?", a: "On record: ROAS 3.2x to 5.5x by consolidating 40+ ad groups into 8; CPL cut from Rs.1,100 to Rs.770 (-30%); organic traffic +15%.", topic: "results" },
  { q: "How did you cut CPL 30%?", a: "Consolidated the account structure, tightened the top-funnel creative angle, and moved spend to the landing page variant that converted best. Full breakdown in the audit tool.", topic: "results" }
];

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!KV_URL || !KV_TOKEN) return res.json({ ok: true, items: SEED, note: 'kv not configured, seed only' });
  kv('lrange', ['ama:recent', '0', '39']).then(function (j) {
    const arr = (j && j.result) || [];
    const items = arr.map(function (item) {
      try { return JSON.parse(item); } catch (e) { return null; }
    }).filter(Boolean).filter(function (x) { return x && x.q && x.a; }).map(function (x) {
      return { q: x.q, a: x.a, topic: x.topic, ts: x.ts };
    });
    const out = (items.length ? items : SEED).slice(0, 6);
    res.json({ ok: true, items: out, stored: items.length });
  }).catch(function () { res.json({ ok: true, items: SEED, note: 'unavailable' }); });
};