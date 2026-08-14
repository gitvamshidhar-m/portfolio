// Single-segment API router (Vercel Hobby caps at 12 serverless functions).
// All endpoint handlers live in ../libs and are lazy-required by path,
// so this whole API surface counts as ONE function.
// NOTE: Vercel filesystem functions only match ONE path segment (no catch-all),
// so any deep sub-path (/api/agentic/stt, /api/agentic/tts) must be collapsed
// by a vercel.json rewrite that forwards the remainder as a ?sub= query param.
// NOTE: use literal require() paths (not variables) so Vercel's bundler (nft)
// can statically trace and include each handler at build time.
function getHandler(key) {
  switch (key) {
    case 'admin': return require('../libs/admin');
    case 'ama': return require('../libs/ama');
    case 'analytics': return require('../libs/analytics');
    case 'agentic': return require('../libs/agentic');
    case 'audit': return require('../libs/audit');
    case 'capture': return require('../libs/capture');
    case 'casestudy': return require('../libs/casestudy');
    case 'contact': return require('../libs/contact');
    case 'coverletter': return require('../libs/coverletter');
    case 'github': return require('../libs/github');
    case 'headline': return require('../libs/headline');
    case 'live': return require('../libs/live');
    case 'og': return require('../libs/og');
    case 'pulse': return require('../libs/pulse');
    case 'rag': return require('../libs/rag');
    case 'ship': return require('../libs/ship');
    case 'resume': return require('../libs/resume');
    case 'stats': return require('../libs/stats');
    case 'status': return require('../libs/status');
    case 'track': return require('../libs/track');
    case 'views': return require('../libs/views');
    case 'who': return require('../libs/who');
    case 'watch': return require('../libs/watch');
    default: return null;
  }
}

function send(res, code, obj) {
  if (res.writableEnded) return;
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

const HANDLER_TIMEOUT_MS = 60000;

module.exports = function handler(req, res) {
  let pathname = '';
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (e) { pathname = req.url || ''; }
  pathname = pathname.replace(/^\/api/, ''); // tolerate either /api/rag or /rag
  const key = pathname.replace(/^\/+/, '').split('?')[0].split('/')[0] || 'index';
  const fn = getHandler(key);
  if (!fn) return send(res, 404, { error: 'not found' });

  // Guard: no handler may run forever. Streamed responses keep the socket open
  // past their internal timeout, so give them comfortable headroom.
  const timer = setTimeout(function () { send(res, 504, { error: 'timeout: ' + key }); }, HANDLER_TIMEOUT_MS);
  try {
    Promise.resolve(fn(req, res)).catch(function () {
      send(res, 500, { error: 'handler error: ' + key });
    }).finally(function () { clearTimeout(timer); });
  } catch (e) {
    clearTimeout(timer);
    send(res, 500, { error: 'handler error: ' + key });
  }
};
