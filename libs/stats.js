module.exports = function handler(req, res) {
  var data = {
    stats: [
      { label: 'Years Experience', target: 10, suffix: '+' },
      { label: 'Organic Traffic Growth', target: 15, suffix: '%' },
      { label: 'Qualified Leads / Mo', target: 70, suffix: '' },
      { label: 'Monthly Ad Budget', target: 0, suffix: '', text: 'Rs.2L+' },
      { label: 'Live AI Products', target: 3, suffix: '' }
    ],
    ticker: [
      '70+ qualified leads / month',
      '15% organic traffic growth',
      'Rs.2L+ monthly ad budget',
      '3 live AI products shipped solo',
      '3.2x → 5.5x client ROAS',
      'Rs.1,100 → Rs.770 cost-per-lead'
    ],
    testimonials: []
  };
  var over = (process.env.STATS_JSON || '').trim();
  if (over) {
    try { var parsed = JSON.parse(over); if (parsed.stats) data.stats = parsed.stats; if (parsed.ticker) data.ticker = parsed.ticker; if (parsed.testimonials) data.testimonials = parsed.testimonials; } catch (e) {}
  }
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600, stale-while-revalidate=86400');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json(data);
};