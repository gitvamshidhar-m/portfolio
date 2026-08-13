const USER = 'gitvamshidhar-m';
const KV_URL = (process.env.KV_REST_API_URL || '').trim();
const KV_TOKEN = (process.env.KV_REST_API_TOKEN || '').trim();
const CACHE_KEY = 'github:cache';

function base(u) { return String(u || '').replace(/\/+$/, ''); }
function kvCmd(action, parts) {
  if (!KV_URL || !KV_TOKEN) return Promise.reject(new Error('kv off'));
  const path = (Array.isArray(parts) ? parts : [parts]).map(encodeURIComponent).join('/');
  return fetch(base(KV_URL) + '/' + action + '/' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KV_TOKEN }
  }).then(function (r) { return r.json(); });
}

function mapData(arr) {
  const user = arr[0];
  const list = (arr[1] || []).map(function (r) {
    return {
      name: r.name,
      description: r.description || '',
      html_url: r.html_url,
      language: r.language || 'code',
      stargazers_count: r.stargazers_count || 0,
      forks_count: r.forks_count || 0,
      updated_at: r.updated_at || null,
      archived: r.archived
    };
  }).filter(function (r) { return !r.archived; }).slice(0, 6);
  const commits = (arr[2] || []).map(function (c) {
    return {
      sha: (c.sha || '').slice(0, 7),
      message: String(((c.commit && c.commit.message) || '').split('\n')[0]),
      date: (c.commit && c.commit.committer && c.commit.committer.date) || null,
      author: (c.author && c.author.login) || 'gitvamshidhar-m',
      url: c.html_url || null
    };
  });
  return {
    login: USER,
    name: user.name || USER,
    bio: user.bio || null,
    public_repos: user.public_repos ?? list.length,
    avatar_url: user.avatar_url || null,
    html_url: user.html_url || 'https://github.com/' + USER,
    repos: list,
    commits: commits
  };
}

function staticFallback() {
  return {
    login: USER,
    name: USER,
    bio: null,
    public_repos: 0,
    repos: [],
    commits: [],
    cached: 'static'
  };
}

module.exports = async function handler(req, res) {
  const info = 'https://api.github.com/users/' + USER;
  const repos = 'https://api.github.com/users/' + USER + '/repos?sort=updated&per_page=8';
  const commits = 'https://api.github.com/repos/' + USER + '/portfolio/commits?per_page=40';
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vamshidharm-portfolio' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;

  try {
    const arr = await Promise.all([
      fetch(info, { headers: headers }).then(function (r) { return r.json(); }),
      fetch(repos, { headers: headers }).then(function (r) { return r.json(); }),
      fetch(commits, { headers: headers }).then(function (r) { return r.json(); })
    ]);
    const data = mapData(arr);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
    if (KV_URL && KV_TOKEN) {
      try { await kvCmd('set', [CACHE_KEY, JSON.stringify({ name: data.name, repos: data.repos, commits: data.commits })]); } catch (e) {}
    }
    res.json(data);
  } catch (err) {
    if (KV_URL && KV_TOKEN) {
      try {
        const j = await kvCmd('get', [CACHE_KEY]);
        const v = j && j.result;
        if (v) {
          const c = JSON.parse(v);
          if (c && Array.isArray(c.commits) && c.commits.length) {
            c.cached = 'kv';
            res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
            return res.json(c);
          }
        }
      } catch (e) {}
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json(staticFallback());
  }
};
