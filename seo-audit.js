/**
 * VAMSHIDHAR REDDY M — MINI SEO AUDIT TOOL
 * Client-side mini version of the AI SEO Agent.
 * Real SEO checks on any URL via CORS proxy + DOMParser. No backend.
 */

(function () {
  'use strict';

  // Reordered: allorigins is most reliable, codetabs is solid backup,
  // corsproxy.io kept as final fallback (has been rate-limiting lately).
  const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://api.codetabs.com/v1/proxy/?quest=',
    'https://corsproxy.io/?'
  ];

  const ready = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  ready(injectSEOAuditTool);

  function injectSEOAuditTool() {
    const projects = document.getElementById('projects');
    if (!projects) return;

    const section = document.createElement('section');
    section.id = 'seo-audit-demo';
    section.className = 'seo-audit-section';
    section.setAttribute('data-animate', 'fade-up');
    section.innerHTML = `
      <div class="container">
        <div class="section-header">
          <span class="section-tag"><i class="fas fa-bolt"></i> Live Demo</span>
          <h2 class="section-title">Try My SEO Agent <span class="gradient-text">Live</span></h2>
          <p class="section-desc">Paste any URL to run an instant SEO audit. This is a mini version of my AI SEO Agent running right in your browser — no signup, no backend.</p>
        </div>

        <div class="seo-audit-card">
          <form class="seo-audit-form" id="seoAuditForm">
            <div class="seo-input-wrap">
              <i class="fas fa-globe seo-input-icon"></i>
              <input type="text" id="seoAuditUrl" placeholder="example.com or https://example.com" autocomplete="off" spellcheck="false" />
            </div>
            <button type="submit" class="btn btn-primary seo-audit-btn" id="seoAuditBtn">
              <i class="fas fa-play"></i>
              <span class="seo-audit-btn-text">Run Audit</span>
            </button>
          </form>

          <div class="seo-audit-hint">
            <i class="fas fa-lightbulb"></i> Try: github.com, stripe.com, your own site
          </div>

          <div class="seo-audit-results" id="seoAuditResults" hidden></div>
        </div>
      </div>
    `;

    projects.parentNode.insertBefore(section, projects.nextSibling);
    document.getElementById('seoAuditForm').addEventListener('submit', handleSubmit);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    let url = document.getElementById('seoAuditUrl').value.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    const btn = document.getElementById('seoAuditBtn');
    const btnText = btn.querySelector('.seo-audit-btn-text');
    btn.disabled = true;
    btnText.textContent = 'Running...';

    const results = document.getElementById('seoAuditResults');
    results.hidden = false;
    results.innerHTML = renderLoading(url);

    try {
      const html = await fetchPageHtml(url);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const checks = runChecks(doc, url);
      results.innerHTML = renderResults(checks, url);
    } catch (err) {
      console.error('[SEO Audit] Failed:', err);
      results.innerHTML = renderError(err.message || 'Unknown error');
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Run Audit';
    }
  }

  async function fetchPageHtml(url) {
    let lastError;
    for (const proxy of CORS_PROXIES) {
      const proxyUrl = proxy + encodeURIComponent(url);
      const proxyName = new URL(proxy).hostname;
      console.log('[SEO Audit] Trying proxy:', proxyName);

      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 12000);

      try {
        const res = await fetch(proxyUrl, { signal: ctrl.signal });
        clearTimeout(timeoutId);

        if (!res.ok) {
          console.warn('[SEO Audit] ' + proxyName + ' returned HTTP ' + res.status);
          lastError = new Error('HTTP ' + res.status);
          continue;
        }

        const text = await res.text();
        if (text && text.length > 100) {
          console.log('[SEO Audit] Success via ' + proxyName + ' (' + text.length + ' bytes)');
          return text;
        }
        lastError = new Error('Empty response');
      } catch (e) {
        clearTimeout(timeoutId);
        console.warn('[SEO Audit] ' + proxyName + ' error:', e.message);
        lastError = e;
      }
    }
    throw lastError || new Error('All proxies failed');
  }

  function runChecks(doc, url) {
    const checks = [];

    // 1. Title
    const titleEl = doc.querySelector('title');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!title) checks.push({ status: 'fail', label: 'Title tag', detail: 'Missing — critical for search rankings' });
    else if (title.length < 30) checks.push({ status: 'warn', label: 'Title tag', detail: 'Too short (' + title.length + ' chars). Ideal: 50-60' });
    else if (title.length > 65) checks.push({ status: 'warn', label: 'Title tag', detail: 'Too long (' + title.length + ' chars). Will get truncated' });
    else checks.push({ status: 'pass', label: 'Title tag', detail: 'Present, ' + title.length + ' chars' });

    // 2. Meta description
    const descEl = doc.querySelector('meta[name="description"]');
    const desc = descEl ? (descEl.getAttribute('content') || '').trim() : '';
    if (!desc) checks.push({ status: 'fail', label: 'Meta description', detail: 'Missing — affects SERP appearance' });
    else if (desc.length < 120) checks.push({ status: 'warn', label: 'Meta description', detail: 'Too short (' + desc.length + ' chars). Ideal: 140-160' });
    else if (desc.length > 165) checks.push({ status: 'warn', label: 'Meta description', detail: 'Too long (' + desc.length + ' chars). Will be truncated' });
    else checks.push({ status: 'pass', label: 'Meta description', detail: 'Present, ' + desc.length + ' chars' });

    // 3. H1
    const h1s = doc.querySelectorAll('h1');
    if (h1s.length === 0) checks.push({ status: 'fail', label: 'H1 heading', detail: 'No H1 found — page lacks topic hierarchy' });
    else if (h1s.length === 1) checks.push({ status: 'pass', label: 'H1 heading', detail: 'Exactly 1 H1 found' });
    else checks.push({ status: 'warn', label: 'H1 heading', detail: h1s.length + ' H1s found. Recommend exactly 1' });

    // 4. Viewport
    const viewport = doc.querySelector('meta[name="viewport"]');
    checks.push(viewport
      ? { status: 'pass', label: 'Mobile viewport', detail: 'Mobile-friendly viewport set' }
      : { status: 'fail', label: 'Mobile viewport', detail: 'Missing — poor mobile experience' });

    // 5. Canonical
    const canonical = doc.querySelector('link[rel="canonical"]');
    checks.push(canonical
      ? { status: 'pass', label: 'Canonical URL', detail: 'Set — prevents duplicate content' }
      : { status: 'warn', label: 'Canonical URL', detail: 'Missing — can cause duplicate content issues' });

    // 6. HTTPS
    checks.push(url.toLowerCase().startsWith('https://')
      ? { status: 'pass', label: 'HTTPS', detail: 'Secure connection' }
      : { status: 'fail', label: 'HTTPS', detail: 'Not using HTTPS — Google penalizes HTTP' });

    // 7. Image alt text
    const images = doc.querySelectorAll('img');
    const imgsNoAlt = Array.from(images).filter(img => img.getAttribute('alt') === null);
    if (images.length === 0) {
      checks.push({ status: 'pass', label: 'Image alt text', detail: 'No images on page' });
    } else if (imgsNoAlt.length === 0) {
      checks.push({ status: 'pass', label: 'Image alt text', detail: 'All ' + images.length + ' images have alt text' });
    } else if (imgsNoAlt.length / images.length < 0.3) {
      checks.push({ status: 'warn', label: 'Image alt text', detail: imgsNoAlt.length + '/' + images.length + ' images missing alt' });
    } else {
      checks.push({ status: 'fail', label: 'Image alt text', detail: imgsNoAlt.length + '/' + images.length + ' images missing alt' });
    }

    // 8. Open Graph
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    const ogDesc = doc.querySelector('meta[property="og:description"]');
    const ogImage = doc.querySelector('meta[property="og:image"]');
    const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
    if (ogCount === 3) checks.push({ status: 'pass', label: 'Open Graph tags', detail: 'Complete OG setup for social sharing' });
    else if (ogCount > 0) checks.push({ status: 'warn', label: 'Open Graph tags', detail: ogCount + '/3 essential OG tags found' });
    else checks.push({ status: 'fail', label: 'Open Graph tags', detail: 'Missing — social link previews will be plain' });

    // 9. Twitter Card
    const twitterCard = doc.querySelector('meta[name="twitter:card"]');
    checks.push(twitterCard
      ? { status: 'pass', label: 'Twitter Card', detail: 'Set — Twitter shares look polished' }
      : { status: 'warn', label: 'Twitter Card', detail: 'Missing — Twitter shares use fallback' });

    // 10. Structured data
    const ldJson = doc.querySelectorAll('script[type="application/ld+json"]');
    const microdata = doc.querySelectorAll('[itemscope]');
    if (ldJson.length > 0) checks.push({ status: 'pass', label: 'Structured data', detail: ldJson.length + ' JSON-LD schema(s) found' });
    else if (microdata.length > 0) checks.push({ status: 'pass', label: 'Structured data', detail: 'Microdata schema found' });
    else checks.push({ status: 'warn', label: 'Structured data', detail: 'No Schema.org markup — missing rich results' });

    // 11. Content depth
    let text = '';
    if (doc.body) {
      const clone = doc.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    const wordCount = text ? text.split(/\s+/).length : 0;
    if (wordCount >= 600) checks.push({ status: 'pass', label: 'Content depth', detail: '~' + wordCount.toLocaleString() + ' words — solid' });
    else if (wordCount >= 300) checks.push({ status: 'pass', label: 'Content depth', detail: '~' + wordCount.toLocaleString() + ' words' });
    else if (wordCount >= 100) checks.push({ status: 'warn', label: 'Content depth', detail: '~' + wordCount + ' words — thin content' });
    else checks.push({ status: 'fail', label: 'Content depth', detail: '~' + wordCount + ' words — very thin' });

    // 12. Language
    const lang = doc.documentElement.getAttribute('lang');
    checks.push(lang
      ? { status: 'pass', label: 'Language declared', detail: 'lang="' + lang + '" set on HTML' }
      : { status: 'warn', label: 'Language declared', detail: 'Missing lang attribute on HTML' });

    return checks;
  }

  function renderLoading(url) {
    return '<div class="seo-audit-loading">' +
      '<div class="seo-audit-loading-spinner"></div>' +
      '<p>Crawling <strong>' + escapeHtml(prettyUrl(url)) + '</strong> — running 12 SEO checks...</p>' +
      '</div>';
  }

  function renderError(message) {
    return '<div class="seo-audit-error">' +
      '<i class="fas fa-exclamation-triangle"></i>' +
      '<div>' +
        '<h4>Could not audit this URL</h4>' +
        '<p>' + escapeHtml(message) + '. The CORS proxy may be rate-limited. Try refreshing in a minute, or test with a different URL like github.com or stripe.com.</p>' +
      '</div></div>';
  }

  function renderResults(checks, url) {
    const passed = checks.filter(c => c.status === 'pass').length;
    const total = checks.length;
    const pct = Math.round((passed / total) * 100);
    const dashoffset = 283 - (283 * pct / 100);
    const scoreColor = pct >= 75 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

    const iconMap = { pass: 'fa-check-circle', warn: 'fa-exclamation-circle', fail: 'fa-times-circle' };
    const checksHtml = checks.map(c =>
      '<div class="seo-check ' + c.status + '">' +
        '<i class="fas ' + iconMap[c.status] + ' seo-check-icon"></i>' +
        '<div class="seo-check-content">' +
          '<h4>' + escapeHtml(c.label) + '</h4>' +
          '<p>' + escapeHtml(c.detail) + '</p>' +
        '</div></div>'
    ).join('');

    return '<div class="seo-audit-score">' +
      '<div class="score-ring" style="--score-color: ' + scoreColor + '; --final-offset: ' + dashoffset + ';">' +
        '<svg viewBox="0 0 100 100" class="score-ring-svg">' +
          '<circle cx="50" cy="50" r="45" class="score-track"/>' +
          '<circle cx="50" cy="50" r="45" class="score-fill"/>' +
        '</svg>' +
        '<div class="score-text">' +
          '<strong>' + passed + '/' + total + '</strong>' +
          '<small>Passed</small>' +
        '</div>' +
      '</div>' +
      '<div class="score-summary">' +
        '<h3>' + escapeHtml(prettyUrl(url)) + '</h3>' +
        '<p>' + getSummary(pct) + '</p>' +
      '</div>' +
      '</div>' +
      '<div class="seo-checks-grid">' + checksHtml + '</div>' +
      '<div class="seo-audit-footer">' +
        '<div>' +
          '<strong>Want a deeper audit?</strong>' +
          '<p>My production AI SEO Agent uses Playwright for headless crawling + Gemini AI to generate prioritized fixes.</p>' +
        '</div>' +
        '<a href="https://github.com/mvamshi56/seoagent" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">' +
          '<i class="fab fa-github"></i> See the full version' +
        '</a>' +
      '</div>';
  }

  function getSummary(pct) {
    if (pct >= 85) return 'Excellent — strong SEO fundamentals.';
    if (pct >= 70) return 'Good — solid basics with room to optimize.';
    if (pct >= 50) return 'Average — several important issues to fix.';
    return 'Needs significant SEO improvements.';
  }

  function prettyUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname !== '/' ? u.pathname : '');
    } catch (e) { return url; }
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }
})();
