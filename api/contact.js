const Spam = require('./spam');

const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();

const kv = kvFetch;

function kvFetch(action, key, method) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv not configured'));
  return fetch(String(KV_URL).replace(/\/$/, '') + '/' + action + '/' + encodeURIComponent(key), {
    method: method || 'GET',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}
function saveLead(lead) {
  if (!KV_URL || !KV_TOKEN) return Promise.resolve();
  const url = String(KV_URL).replace(/\/$/, '') + '/pipeline';
  const commands = [['LPUSH', 'leads:recent', JSON.stringify(lead)], ['LTRIM', 'leads:recent', 0, 49]];
  return fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + KV_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) }).then(function (r) {
    if (!r.ok) throw new Error('lead storage failed');
    return r.json();
  });
}
function ipOf(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xf) return xf;
  return (req.headers['x-real-ip'] || 'unknown').toString().slice(0, 40);
}

module.exports = function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  let body = {};
  try { body = (req.body && typeof req.body === 'object') ? req.body : {}; } catch (e) { /* ignore */ }
  const name = String(body.name || '').slice(0, 120);
  const email = String(body.email || '').slice(0, 120);
  const subject = String(body.subject || '').slice(0, 160);
  const message = String(body.message || '').slice(0, 4000);
  const honey = String(body.hp_three || '').slice(0, 120);
  const loadAt = parseInt(body.t, 10) || 0;

  if (!subject && !message) {
    res.status(400).json({ ok: false, error: 'empty message' });
    return;
  }
  const send = function (resBody) { res.setHeader('Cache-Control', 'no-store'); res.json(resBody); };

  const blockGate = function (reason) {
    kv('incr', 'profile:spam', 'POST').then(function () {
      return send({ ok: true, delivered: true, spamBlocked: true, gate: reason });
    }).catch(function () {
      send({ ok: true, delivered: true, spamBlocked: true, gate: reason });
    });
  };

  // Gate 1 — honeypot field (bots auto-fill hidden inputs)
  if (honey) { return blockGate('honeypot'); }
  // Gate 2 — submit too fast for a human (form sends elapsed ms since page load)
  if (loadAt && loadAt < 5000) { return blockGate('too fast'); }
  // Gate 3 — per-IP rate cap (still decremented it per submit; cap 6/day/IP)
  kv('incr', 'limit:ip:' + ipOf(req), 'POST').then(function (j) {
    const n = j && typeof j.result === 'number' ? j.result : 0;
    if (n > 6) return blockGate('rate limit (' + n + '/day)');
    continueHandler(n);
  }).catch(function () { continueHandler(0); });

  function continueHandler() {
    const deliver = function (verdict) {
      const isSpam = !!(verdict && verdict.spam);
      const hardBlock = isSpam && verdict.score >= 0.8;
      const label = hardBlock ? '⛔ SPAM BLOCKED' : (isSpam ? '⚠️ Likely SPAM' : 'New portfolio message');
      const text = label + (verdict ? ' — score ' + (verdict.score || 0).toFixed(2) + ' · ' + (verdict.reason || '') : '') + '\n' +
        'From: ' + (name || '—') + ' <' + (email || '—') + '>\n' +
        'Subject: ' + (subject || '(none)') + '\n' +
        'Message:\n' + message + '\n\n' +
        'Referrer: ' + (req.headers['referer'] || req.headers['referrer'] || 'direct') + '\n' +
        'Time: ' + new Date().toISOString();

      const webhook = (process.env.CONTACT_WEBHOOK || '').trim();
      const tgToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
      const tgChat = (process.env.TELEGRAM_CHAT_ID || '').trim();
      const payload = JSON.stringify({ text: text, name: name, email: email, subject: subject, message: message, spam: isSpam, score: verdict ? verdict.score : undefined, reason: verdict ? verdict.reason : undefined });

      const finalize = function (resBody) {
        if (isSpam) { kv('incr', 'profile:spam', 'POST').then(function () { send(resBody); }).catch(function () { send(resBody); }); return; }
        if (!resBody.delivered) { send(resBody); return; }
        saveLead({ name: name, email: email, subject: subject, message: message, receivedAt: new Date().toISOString(), channels: resBody.channels || [] })
          .then(function () { send(resBody); })
          .catch(function () { send(resBody); });
      };

      if (hardBlock) {
        // drop silently on the owner side; spammer sees success
        return finalize({ ok: true, delivered: true, spamBlocked: true, spam: true, score: verdict.score, reason: verdict.reason });
      }
      const targets = [];
      if (webhook) {
        targets.push(fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }).then(function (r) { if (!r.ok) throw new Error('webhook status ' + r.status); return 'webhook'; }));
      }
      if (tgToken && tgChat) {
        targets.push(fetch('https://api.telegram.org/bot' + tgToken + '/sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: tgChat, text: text }) }).then(function (r) { if (!r.ok) throw new Error('telegram status ' + r.status); return 'telegram'; }));
      }
      if (targets.length) {
        Promise.allSettled(targets).then(function (outcomes) {
          const ok = outcomes.filter(function (o) { return o.status === 'fulfilled'; });
          finalize({ ok: true, delivered: ok.length > 0, channels: outcomes.map(function (o) { return { channel: o.value || 'err', delivered: o.status === 'fulfilled' }; }), spam: isSpam || undefined, score: verdict ? verdict.score : undefined, reason: verdict ? verdict.reason : undefined });
        });
      } else {
        finalize({ ok: false, delivered: false, error: 'no delivery destination configured', spam: isSpam || undefined, score: verdict ? verdict.score : undefined, reason: verdict ? verdict.reason : undefined });
      }
    };
    if (Spam && typeof Spam.classify === 'function') {
      Spam.classify({ name: name, email: email, subject: subject, message: message }).then(deliver).catch(function () { deliver(null); });
    } else {
      deliver(null);
    }
  }
};
