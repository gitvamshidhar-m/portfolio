// SERP tool — grounds the Research Agent in real web search results.
// Providers (first available wins):
//   SERP_API_KEY  -> SerpAPI (https://serpapi.com), engine via SERP_ENGINE (default 'google')
//   BRAVE_API_KEY -> Brave Search API (https://brave.com/search/api), free tier 2k queries/mo
//   (none)        -> best-effort DuckDuckGo HTML scrape (no key, but may be rate-limited/blocked)
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

function decodeEnt(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); });
}
function stripTags(s) { return decodeEnt(String(s || '').replace(/<[^>]*>/g, '')); }

function serpNoKey(query, num) {
  const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
  return fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', Accept: 'text/html' }
  })
    .then(function (r) { return r.text(); })
    .then(function (html) {
      const titleRe = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      const titles = [];
      let m;
      while ((m = titleRe.exec(html))) {
        const href = m[1] || '';
        const um = href.match(/uddg=([^&]+)/);
        let link = '';
        if (um) { try { link = decodeURIComponent(um[1]); } catch (e) {} }
        titles.push({ title: stripTags(m[2]), link: link });
      }
      const snips = (html.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g) || [])
        .map(function (s) { return stripTags(s.replace(/^<a[^>]*>/, '').replace(/<\/a>$/, '')); });
      const out = [];
      for (let i = 0; i < titles.length && out.length < (num || 8); i++) {
        let domain = '';
        try { domain = new URL(titles[i].link || '').hostname.replace(/^www\./, ''); } catch (e) {}
        out.push({ title: titles[i].title, link: titles[i].link, domain: domain, snippet: snips[i] || '' });
      }
      return out;
    });
}

function serp(query, opts) {
  if (!query) return Promise.resolve(null);
  const num = String((opts && opts.num) || 8);
  const serpKey = (process.env.SERP_API_KEY || '').trim();
  const braveKey = (process.env.BRAVE_API_KEY || '').trim();
  if (serpKey) return serpApi(query, num, serpKey).catch(function () { return null; });
  if (braveKey) return brave(query, num, braveKey).catch(function () { return null; });
  return serpNoKey(query, num).catch(function () { return null; });
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
