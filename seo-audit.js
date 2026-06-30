/**
 * VAMSHIDHAR REDDY M — MINI SEO AUDIT TOOL (Hybrid)
 * Primary: Google PageSpeed Insights API (real Lighthouse SEO audits)
 * Fallback: Jina AI Reader + CORS proxies (works when PSI rate-limits)
 *
 * OPTIONAL: For unlimited PSI usage, get a free Google API key:
 *   1. Visit https://console.cloud.google.com/apis/credentials
 *   2. Create project → Enable "PageSpeed Insights API"
 *   3. Create credentials → API Key
 *   4. Paste key into PSI_API_KEY below
 */

(function () {
  'use strict';

  // Paste your Google API key here for unlimited PSI usage (optional)
  const PSI_API_KEY = '';

  const PSI_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
  const CACHE_KEY = 'seo_audit_cache_v1';
  const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

  const CORS_PROXIES = [
    'https://api.codetabs.com/v1/proxy/?quest=',
    'https://corsproxy.io/?',
    'https://api.allorigins.win/raw?url='
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
          <p class="section-desc">Paste any URL to run a real SEO audit. Powered by Google Lighthouse with a smart client-side fallback for reliability.</p>
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
            <i class="fas fa-info-circle"></i> Try github.com, stripe.com, or your own site
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

    const setMsg = (msg) => {
      const msgEl = document.getElementById('seoAuditLoadingMsg');
      if (msgEl) msgEl.textContent = msg;
    };

    try {
      const data = await runAudit(url, setMsg);
      results.innerHTML = renderResults(data, url);
    } catch (err) {
      console.error('[SEO Audit] Failed:', err);
      results.innerHTML = renderError(err.message || 'Unknown error');
    } finally {
      btn.disabled = false;
      btnText.textContent = 'Run Audit';
    }
  }

  async function runAudit(url, setMsg) {
    // 1. Check cache first
    const cached = getCached(url);
    if (cached) {
      console.log('[SEO Audit] Using cached result');
      setMsg('Loading cached audit...');
      await sleep(300);
      return cached;
    }

    // 2. Try Google PageSpeed Insights API
    try {
      setMsg('Running Google Lighthouse audit (~20s)...');
      const lhResult = await runPSIAudit(url);
      const data = extractFromPSI(lhResult);
      setCache(url, data);
      return data;
    } catch (psiErr) {
      console.warn('[SEO Audit] PSI failed:', psiErr.message);
      const isRateLimit = /rate limit|quota|429/i.test(psiErr.message);
      setMsg(isRateLimit ? 'Quick audit (PSI rate-limited)...' : 'Switching to quick audit...');
    }

    // 3. Fallback: Fetch page HTML + client-side checks
    const html = await fetchPageHtml(url);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const data = runClientChecks(doc, url);
    setCache(url, data);
    return data;
  }

  /* ════════════ PSI ════════════ */

  async function runPSIAudit(url) {
    const params = new URLSearchParams({
      url: url,
      category: 'SEO',
      strategy: 'mobile'
    });
    if (PSI_API_KEY) params.set('key', PSI_API_KEY);

    console.log('[SEO Audit] Calling PSI...');
    const res = await fetch(PSI_API + '?' + params.toString());

    if (!res.ok) {
      let errMsg = 'HTTP ' + res.status;
      try {
        const errData = await res.json();
        if (errData && errData.error && errData.error.message) {
          errMsg = errData.error.message;
        }
      } catch (e) { /* ignore */ }

      if (res.status === 429) throw new Error('Rate limit');
      throw new Error(errMsg);
    }

    const data = await res.json();
    if (!data.lighthouseResult) throw new Error('No Lighthouse data');
    return data.lighthouseResult;
  }

  function extractFromPSI(lhResult) {
    const cat = lhResult.categories && lhResult.categories.seo;
    if (!cat) throw new Error('No SEO data');
    const score = Math.round((cat.score || 0) * 100);
    const audits = lhResult.audits || {};

    const checks = [];
    for (const ref of (cat.auditRefs || [])) {
      const audit = audits[ref.id];
      if (!audit) continue;
      if (audit.scoreDisplayMode === 'notApplicable') continue;

      let status;
      if (audit.score === 1) status = 'pass';
      else if (audit.score === 0) status = 'fail';
      else if (audit.scoreDisplayMode === 'manual' || audit.scoreDisplayMode === 'informative') status = 'info';
      else status = 'warn';

      checks.push({
        status: status,
        label: cleanText(audit.title),
        detail: cleanDescription(audit.description)
      });
    }

    return { score: score, checks: checks, source: 'Google Lighthouse' };
  }

  /* ════════════ FETCH (Jina + CORS proxies fallback) ════════════ */

  async function fetchPageHtml(url) {
    let lastError;

    // Try Jina AI Reader first — most reliable for heavy/JS-rendered sites
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch('https://r.jina.ai/' + url, {
        signal: ctrl.signal,
        headers: {
          'Accept': 'text/html',
          'X-Return-Format': 'html'
        }
      });
      clearTimeout(t);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 100) {
          console.log('[SEO Audit] Jina AI Reader succeeded');
          return text;
        }
      }
      lastError = new Error('Jina HTTP ' + res.status);
    } catch (e) {
      console.warn('[SEO Audit] Jina failed:', e.message);
      lastError = e;
    }

    // Fallback: standard CORS proxies with longer timeout
    for (const proxy of CORS_PROXIES) {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(proxy + encodeURIComponent(url), { signal: ctrl.signal });
        clearTimeout(timeoutId);
        if (!res.ok) { lastError = new Error('HTTP ' + res.status); continue; }
        const text = await res.text();
        if (text && text.length > 100) {
          console.log('[SEO Audit] Proxy success:', new URL(proxy).hostname);
          return text;
        }
        lastError = new Error('Empty response');
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') {
          lastError = new Error('Request timed out after 20s');
        } else {
          lastError = e;
        }
      }
    }
    throw lastError || new Error('Could not fetch URL');
  }

  function runClientChecks(doc, url) {
    const checks = [];

    // Title
    const titleEl = doc.querySelector('title');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!title) checks.push({ status: 'fail', label: 'Document has a title', detail: 'Missing — critical for rankings' });
    else if (title.length < 30 || title.length > 65) checks.push({ status: 'warn', label: 'Document has a title', detail: title.length + ' chars (ideal: 50-60)' });
    else checks.push({ status: 'pass', label: 'Document has a title', detail: title.length + ' chars' });

    // Meta description
    const descEl = doc.querySelector('meta[name="description"]');
    const desc = descEl ? (descEl.getAttribute('content') || '').trim() : '';
    if (!desc) checks.push({ status: 'fail', label: 'Document has a meta description', detail: 'Missing — affects search snippets' });
    else if (desc.length < 120 || desc.length > 165) checks.push({ status: 'warn', label: 'Document has a meta description', detail: desc.length + ' chars (ideal: 140-160)' });
    else checks.push({ status: 'pass', label: 'Document has a meta description', detail: desc.length + ' chars' });

    // H1
    const h1s = doc.querySelectorAll('h1');
    if (h1s.length === 0) checks.push({ status: 'fail', label: 'Page has H1 heading', detail: 'No H1 found' });
    else if (h1s.length === 1) checks.push({ status: 'pass', label: 'Page has H1 heading', detail: 'Exactly 1 H1 found' });
    else checks.push({ status: 'warn', label: 'Page has H1 heading', detail: h1s.length + ' H1s found (recommend 1)' });

    // Viewport
    const viewport = doc.querySelector('meta[name="viewport"]');
    checks.push(viewport
      ? { status: 'pass', label: 'Mobile viewport', detail: 'Set — mobile-friendly' }
      : { status: 'fail', label: 'Mobile viewport', detail: 'Missing — poor mobile rendering' });

    // Canonical
    const canonical = doc.querySelector('link[rel="canonical"]');
    checks.push(canonical
      ? { status: 'pass', label: 'Canonical URL set', detail: 'Prevents duplicate content issues' }
      : { status: 'warn', label: 'Canonical URL set', detail: 'Missing — recommended' });

    // HTTPS
    checks.push(url.toLowerCase().startsWith('https://')
      ? { status: 'pass', label: 'HTTPS connection', detail: 'Secure (HTTPS)' }
      : { status: 'fail', label: 'HTTPS connection', detail: 'Not using HTTPS' });

    // Image alt text
    const images = doc.querySelectorAll('img');
    const imgsNoAlt = Array.from(images).filter(img => img.getAttribute('alt') === null);
    if (images.length === 0) checks.push({ status: 'pass', label: 'Image alt attributes', detail: 'No images on page' });
    else if (imgsNoAlt.length === 0) checks.push({ status: 'pass', label: 'Image alt attributes', detail: 'All ' + images.length + ' images have alt' });
    else if (imgsNoAlt.length / images.length < 0.3) checks.push({ status: 'warn', label: 'Image alt attributes', detail: imgsNoAlt.length + '/' + images.length + ' missing alt' });
    else checks.push({ status: 'fail', label: 'Image alt attributes', detail: imgsNoAlt.length + '/' + images.length + ' missing alt' });

    // Open Graph
    const ogTitle = doc.querySelector('meta[property="og:title"]');
    const ogDesc = doc.querySelector('meta[property="og:description"]');
    const ogImage = doc.querySelector('meta[property="og:image"]');
    const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
    if (ogCount === 3) checks.push({ status: 'pass', label: 'Open Graph tags', detail: 'Complete (title, description, image)' });
    else if (ogCount > 0) checks.push({ status: 'warn', label: 'Open Graph tags', detail: ogCount + '/3 essential OG tags' });
    else checks.push({ status: 'fail', label: 'Open Graph tags', detail: 'Missing — social shares look plain' });

    // Twitter Card
    const twitterCard = doc.querySelector('meta[name="twitter:card"]');
    checks.push(twitterCard
      ? { status: 'pass', label: 'Twitter Card meta', detail: 'Set' }
      : { status: 'warn', label: 'Twitter Card meta', detail: 'Missing' });

    // Structured data
    const ldJson = doc.querySelectorAll('script[type="application/ld+json"]');
    if (ldJson.length > 0) checks.push({ status: 'pass', label: 'Structured data', detail: ldJson.length + ' schema(s) found' });
    else checks.push({ status: 'warn', label: 'Structured data', detail: 'No Schema.org markup' });

    // Content depth
    let text = '';
    if (doc.body) {
      const clone = doc.body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
      text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
    }
    const wordCount = text ? text.split(/\s+/).length : 0;
    if (wordCount >= 300) checks.push({ status: 'pass', label: 'Content depth', detail: '~' + wordCount.toLocaleString() + ' words' });
    else if (wordCount >= 100) checks.push({ status: 'warn', label: 'Content depth', detail: '~' + wordCount + ' words (thin)' });
    else checks.push({ status: 'fail', label: 'Content depth', detail: '~' + wordCount + ' words (very thin)' });

    // Language
    const lang = doc.documentElement.getAttribute('lang');
    checks.push(lang
      ? { status: 'pass', label: 'Language declared', detail: 'lang="' + lang + '"' }
      : { status: 'warn', label: 'Language declared', detail: 'Missing lang attribute' });

    const passed = checks.filter(c => c.status === 'pass').length;
    const score = Math.round((passed / checks.length) * 100);
    return { score: score, checks: checks, source: 'Quick client-side audit' };
  }

  /* ════════════ CACHE ════════════ */

  function getCached(url) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const entry = all[url];
      if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
        return entry.data;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function setCache(url, data) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[url] = { timestamp: Date.now(), data: data };
      const keys = Object.keys(all);
      if (keys.length > 20) {
        keys.sort((a, b) => all[a].timestamp - all[b].timestamp);
        keys.slice(0, keys.length - 20).forEach(k => delete all[k]);
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  /* ════════════ HELPERS ════════════ */

  function cleanText(s) {
    if (!s) return '';
    return s.replace(/`/g, '');
  }

  function cleanDescription(desc) {
    if (!desc) return '';
    desc = desc.replace(/\[Learn (more|how)[^\]]*\]\([^)]+\)\.?/gi, '').trim();
    desc = desc.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    desc = desc.replace(/`/g, '');
    desc = desc.replace(/\s+/g, ' ').trim();
    if (desc.length > 140) desc = desc.slice(0, 137) + '...';
    return desc;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /* ════════════ RENDER ════════════ */

  function renderLoading(url) {
    return '<div class="seo-audit-loading">' +
      '<div class="seo-audit-loading-spinner"></div>' +
      '<p>Auditing <strong>' + escapeHtml(prettyUrl(url)) + '</strong></p>' +
      '<p id="seoAuditLoadingMsg" class="seo-audit-loading-status">Starting...</p>' +
      '</div>';
  }

  function renderError(message) {
    const isTimeout = /timed out|aborted/i.test(message);
    const isRateLimit = /rate limit|quota|429/i.test(message);

    let tip;
    if (isTimeout) {
      tip = 'This site is too heavy or slow for free proxies. For unlimited audits, add a free Google API key (instructions at the top of seo-audit.js).';
    } else if (isRateLimit) {
      tip = 'Google rate-limited your IP. Try again in ~1 hour, or add a free Google API key for unlimited usage.';
    } else {
      tip = 'Try a different URL like github.com or stripe.com.';
    }

    return '<div class="seo-audit-error">' +
      '<i class="fas fa-exclamation-triangle"></i>' +
      '<div>' +
        '<h4>Could not audit this URL</h4>' +
        '<p>' + escapeHtml(message) + '.</p>' +
        '<p style="margin-top:8px;font-size:0.82rem;">' + escapeHtml(tip) + '</p>' +
      '</div></div>';
  }

  function renderResults(data, url) {
    const pct = data.score;
    const dashoffset = 283 - (283 * pct / 100);
    const scoreColor = pct >= 90 ? '#10b981' : pct >= 70 ? '#f59e0b' : '#ef4444';
    const grade = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';

    const iconMap = { pass: 'fa-check-circle', warn: 'fa-exclamation-circle', fail: 'fa-times-circle', info: 'fa-info-circle' };
    const checksHtml = data.checks.map(c =>
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
          '<strong>' + pct + '</strong>' +
          '<small>SEO Score</small>' +
        '</div>' +
      '</div>' +
      '<div class="score-summary">' +
        '<h3>' + escapeHtml(prettyUrl(url)) + '</h3>' +
        '<p>' + getSummary(pct) + '</p>' +
        '<div class="score-meta">Grade: <strong>' + grade + '</strong> · ' + escapeHtml(data.source || '') + '</div>' +
      '</div>' +
      '</div>' +
      '<div class="seo-checks-grid">' + checksHtml + '</div>' +
      '<div class="seo-audit-footer">' +
        '<div>' +
          '<strong>Want a deeper audit?</strong>' +
          '<p>My production AI SEO Agent uses Playwright + Gemini AI to crawl entire sites and generate prioritized action items.</p>' +
        '</div>' +
        '<a href="https://github.com/mvamshi56/seoagent" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">' +
          '<i class="fab fa-github"></i> See the full version' +
        '</a>' +
      '</div>';
  }

  function getSummary(pct) {
    if (pct >= 90) return 'Excellent — strong SEO fundamentals.';
    if (pct >= 80) return 'Good — solid basics with minor improvements possible.';
    if (pct >= 70) return 'Decent — several SEO issues worth addressing.';
    if (pct >= 50) return 'Below average — important SEO problems found.';
    return 'Significant SEO improvements needed.';
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
