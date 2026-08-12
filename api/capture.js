const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
function kvPipe(pipe) {
  if (!KV_URL || !KV_TOKEN) return Promise.resolve();
  return fetch(String(KV_URL).replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(pipe) }).catch(function () {});
}
function ipOf(req) { return String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.headers['x-real-ip'] || 'unknown').slice(0, 40); }

module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  let b = {};
  try { b = req.body || {}; } catch (e) {}
  const email = String(b.email || '').trim().slice(0, 130).toLowerCase();
  const name = String(b.name || '').trim().slice(0, 120);
  const source = String(b.source || 'capture').slice(0, 40);
  const honey = String(b.hp_three || '').slice(0, 80);
  if (honey) return res.json({ ok: true, captured: false, spamBlocked: true }); // honeypot
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ ok: false, error: 'valid email required' });
  const lead = { email: email, name: name, source: source, ip: ipOf(req), at: new Date().toISOString() };
  kvPipe([
    ['LPUSH', 'leads:recent', JSON.stringify(lead)],
    ['LPUSH', 'captures:' + source, JSON.stringify(lead)],
    ['LTRIM', 'leads:recent', 0, 49],
    ['LTRIM', 'captures:' + source, 0, 199]
  ]);
  // echo to configured delivery channel if present
  const webhook = (process.env.CONTACT_WEBHOOK || '').trim();
  const tgToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const tgChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
  const targets = [];
  const text = '[Capture] ' + source + '\nEmail: ' + email + (name ? '\nName: ' + name : '') + '\nAt: ' + lead.at;
  if (webhook) targets.push(fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text, email: email, source: source }) }).then(function (r) { if (!r.ok) throw new Error('webhook ' + r.status); return 'webhook'; }));
  if (tgToken && tgChat) targets.push(fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChat, text: text }) }).then(function (r) { if (!r.ok) throw new Error('tg ' + r.status); return 'tg'; }));
  Promise.allSettled(targets).finally(function () { res.json({ ok: true, captured: true, email: email, source: source }); });
};
