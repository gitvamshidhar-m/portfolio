// Single catch-all API router (Vercel Hobby caps at 12 serverless functions).
// All endpoint handlers live in ../libs and are lazy-required by path,
// so this whole API surface counts as ONE function.
const ROUTES = {
  admin: '../libs/admin',
  ama: '../libs/ama',
  analytics: '../libs/analytics',
  audit: '../libs/audit',
  capture: '../libs/capture',
  casestudy: '../libs/casestudy',
  contact: '../libs/contact',
  coverletter: '../libs/coverletter',
  github: '../libs/github',
  live: '../libs/live',
  og: '../libs/og',
  rag: '../libs/rag',
  resume: '../libs/resume',
  stats: '../libs/stats',
  track: '../libs/track',
  views: '../libs/views',
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
