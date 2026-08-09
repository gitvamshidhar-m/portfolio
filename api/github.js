const USER = 'gitvamshidhar-m';

module.exports = function handler(req, res) {
  const info = 'https://api.github.com/users/' + USER;
  const repos = 'https://api.github.com/users/' + USER + '/repos?sort=updated&per_page=8';
  const commits = 'https://api.github.com/repos/' + USER + '/portfolio/commits?per_page=40';
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'vamshidharm-portfolio' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = 'Bearer ' + process.env.GITHUB_TOKEN;

  Promise.all([fetch(info, { headers: headers }), fetch(repos, { headers: headers }), fetch(commits, { headers: headers })])
    .then(function (rs) { return Promise.all(rs.map(function (r) { return r.json(); })); })
    .then(function (arr) {
      var user = arr[0];
      var list = (arr[1] || []).map(function (r) {
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
      var changelog = (arr[2] || []).map(function (c) {
        return {
          sha: (c.sha || '').slice(0, 7),
          message: String(((c.commit && c.commit.message) || '').split('\n')[0]),
          date: (c.commit && c.commit.committer && c.commit.committer.date) || null,
          author: (c.author && c.author.login) || 'gitvamshidhar-m',
          url: c.html_url || null
        };
      });
      res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
      res.json({
        login: USER,
        name: user.name || USER,
        bio: user.bio || null,
        public_repos: user.public_repos ?? list.length,
        avatar_url: user.avatar_url || null,
        html_url: user.html_url || 'https://github.com/' + USER,
        repos: list,
        commits: changelog
      });
    })
    .catch(function (err) {
      res.status(502).json({ error: 'github fetch failed', repos: [] });
    });
};