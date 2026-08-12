// SERP tool — grounds the Research Agent in real web search results.
// Provider: SerpAPI (https://serpapi.com) by default. Configure via env:
//   SERP_API_KEY  (required to run; otherwise the tool is a no-op)
//   SERP_ENGINE   (optional, default 'google')
// Returns an array of { title, link, snippet } or null if unavailable.
function serp(query, opts) {
  const key = (process.env.SERP_API_KEY || '').trim();
  if (!key || !query) return Promise.resolve(null);
  const num = String((opts && opts.num) || 8);
  const url = new URL('https://serpapi.com/search.json');
  url.searchParams.set('api_key', key);
  url.searchParams.set('engine', (process.env.SERP_ENGINE || 'google'));
  url.searchParams.set('q', query);
  url.searchParams.set('num', num);
  return fetch(url.toString(), { method: 'GET' })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const organic = (j && j.organic_results) || [];
      if (!organic.length) return [];
      return organic.slice(0, 8).map(function (o) {
        let domain = '';
        try { domain = new URL(o.link || '').hostname.replace(/^www\./, ''); } catch (e) {}
        return { title: o.title || '', link: o.link || '', domain: domain, snippet: o.snippet || '' };
      });
    })
    .catch(function () { return null; });
}

function serpQuery(m) {
  const parts = [];
  if (m.niche) parts.push(m.niche);
  parts.push(m.goal);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 200).trim();
}

function formatSerp(results) {
  if (!Array.isArray(results) || !results.length) return 'No live search results returned.';
  return results.map(function (r, i) {
    return (i + 1) + '. ' + (r.title || '') + (r.domain ? ' (' + r.domain + ')' : '') + (r.snippet ? ' — ' + r.snippet : '');
  }).join('\n');
}

module.exports = { serp, serpQuery, formatSerp };
