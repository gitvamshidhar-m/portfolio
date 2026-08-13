// Visitor's city from Vercel's x-vercel-ip-city header (no client IP exposed).
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const city = String(req.headers['x-vercel-ip-city'] || '').slice(0, 60);
  const country = String(req.headers['x-vercel-ip-country'] || '').slice(0, 8);
  res.json({ city: city, country: country });
};