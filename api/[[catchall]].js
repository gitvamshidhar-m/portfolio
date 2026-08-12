// Single catch-all API router (Vercel Hobby caps at 12 serverless functions).
// All endpoint handlers live in ../api-src and are lazy-required by path,
// so this whole API surface counts as ONE function.
const ROUTES = {
  admin: '../api-src/admin',
  ama: '../api-src/ama',
  analytics: '../api-src/analytics',
  audit: '../api-src/audit',
  capture: '../api-src/capture',
  casestudy: '../api-src/casestudy',
  contact: '../api-src/contact',
  coverletter: '../api-src/coverletter',
  github: '../api-src/github',
  live: '../api-src/live',
  og: '../api-src/og',
  rag: '../api-src/rag',
  resume: '../api-src/resume',
  stats: '../api-src/stats',
  track: '../api-src/track',
  views: '../api-src/views',
};

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
  const mod = ROUTES[key];
  if (!mod) return send404(res);
  let fn;
  try { fn = require(mod); } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'handler load failed: ' + key }));
    return;
  }
  try { return fn(req, res); } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'handler error: ' + key }));
  }
};
