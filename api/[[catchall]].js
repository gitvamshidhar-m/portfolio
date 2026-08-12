// Single catch-all API router (Vercel Hobby caps at 12 serverless functions).
// All endpoint handlers live in ../libs and are lazy-required by path,
// so this whole API surface counts as ONE function.
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
    case 'live': return require('../libs/live');
    case 'og': return require('../libs/og');
    case 'rag': return require('../libs/rag');
    case 'resume': return require('../libs/resume');
    case 'stats': return require('../libs/stats');
    case 'track': return require('../libs/track');
    case 'views': return require('../libs/views');
    default: return null;
  }
}

function send404(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'not found' }));
}

module.exports = function handler(req, res) {
  let pathname = '';
  try { pathname = new URL(req.url || '/', 'http://localhost').pathname; } catch (e) { pathname = req.url || ''; }
  pathname = pathname.replace(/^\/api/, ''); // tolerate either /api/rag or /rag
  const key = pathname.replace(/^\/+/, '').split('?')[0].split('/')[0] || 'index';
  const fn = getHandler(key);
  if (!fn) return send404(res);
  try { return fn(req, res); } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'handler error: ' + key }));
  }
  try { return fn(req, res); } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'handler error: ' + key }));
  }
};
