// SERP tool — grounds the Research Agent in real web search results.
// Providers (first key found wins):
//   SERP_API_KEY  -> SerpAPI (https://serpapi.com), engine via SERP_ENGINE (default 'google')
//   BRAVE_API_KEY -> Brave Search API (https://brave.com/search/api), free tier 2k queries/mo
// If neither is set, the tool is a no-op and the agent falls back to its built-in planner.
// Returns an array of { title, link, domain, snippet } or null if unavailable.
function serpApi(query, num, key) {
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
    });
}

function brave(query, num, key) {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', num);
  return fetch(url.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Subscription-Token': key }
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      const res = (j && j.data && j.data.web && j.data.web.results) || [];
      if (!res.length) return [];
      return res.slice(0, 8).map(function (o) {
        let domain = '';
        try { domain = new URL(o.url || '').hostname.replace(/^www\./, ''); } catch (e) {}
        return { title: o.title || '', link: o.url || '', domain: domain, snippet: o.description || '' };
      });
    });
}

function serp(query, opts) {
  if (!query) return Promise.resolve(null);
  const num = String((opts && opts.num) || 8);
  const serpKey = (process.env.SERP_API_KEY || '').trim();
  const braveKey = (process.env.BRAVE_API_KEY || '').trim();
  if (serpKey) return serpApi(query, num, serpKey).catch(function () { return null; });
  if (braveKey) return brave(query, num, braveKey).catch(function () { return null; });
  return Promise.resolve(null);
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
