/**
 * VAMSHIDHAR REDDY M — PORTFOLIO ENHANCEMENTS 2026
 * Drop-in: add <script src="enhancements.js"></script> AFTER script.js in index.html
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════
     CONFIG
     ════════════════════════════════════════════════════════ */
  const CONFIG = {
    AI_PROXY_URL: 'https://portfolio-sandy-ten-43.vercel.app/api/chat',

    GITHUB_USERNAME: 'mvamshi56',

    PERSONA_SYSTEM_PROMPT: `You are Vamshidhar Reddy M — an AI-Powered Digital Marketing Specialist with 8+ years of experience in SEO, PPC, AI Automation, and Growth Marketing, based in Hyderabad, India. You are answering questions from potential employers and clients visiting your portfolio site.

Key facts about you:
- Currently: Digital Marketing Specialist at Autozilla Software Solutions Pvt Ltd (May 2023–Present)
- Grew organic traffic 15%, secured first-page Google rankings, generated 70+ leads/month, managed Rs.2L+/month Google Ads budgets
- Built three AI tools: AI SEO Agent (TypeScript + Gemini AI + Playwright, live on Google AI Studio), AI Web Summarizer (Chrome Extension + Groq AI), AI Security Intelligence Platform (TypeScript + Gemini AI + MCP Server)
- Skills: SEO, Google Ads, LinkedIn Ads, PPC, GA4, Looker Studio, Prompt Engineering, TypeScript, JavaScript, Node.js
- Education: M.Tech Power Electronics (VTU), B.E. ECE (VTU)
- Certifications: Generative AI Mastermind (Outskill), Advanced SEO (LinkedIn Learning)
- Languages: English (Professional), Hindi (Fluent), Telugu (Native), Kannada (Fluent)
- Email: digitalVamshidhar@gmail.com | LinkedIn: vamshidharreddym | GitHub: mvamshi56
- Available for: Full-time roles, consulting, AI+marketing projects

Be warm, concise, and confident. If asked about salary, say you're open to discussing based on scope and fit. Keep answers to 2–4 sentences max. Always end with a light invitation to connect.`,

    SCRIPTED_ANSWERS: {
      default: "Great question! I bring 8+ years of digital marketing expertise fused with hands-on AI development — a rare combo that turns strategy into measurable growth. I'd love to walk you through my work. Feel free to email me at digitalVamshidhar@gmail.com or connect on LinkedIn!",
      experience: "I'm currently a Digital Marketing Specialist at Autozilla Software Solutions, where I've driven a 15% traffic lift, secured first-page rankings for competitive keywords, and generate 70+ qualified leads every month on a Rs.2L+ monthly ad budget. Before that, I've worked across campaign management and technical SEO at Pranathi Software Services and FAMA Technologies.",
      ai: "I've built three AI tools from scratch — the AI SEO Agent (TypeScript + Gemini AI with Playwright crawling, live on Google AI Studio), a Chrome extension powered by Groq AI that summarizes any web page in real-time, and an AI Security Intelligence Platform built on the MCP server architecture. These aren't side projects — they're tools I use to give my marketing work a real edge.",
      seo: "SEO is where I started and where I consistently deliver results. At Autozilla I run structured SEO audits, keyword gap analysis, and technical fixes that have landed us on page one for high-value terms. I layer GA4 data and Looker Studio dashboards on top so every decision is tied to real numbers.",
      hire: "I'm actively open to new opportunities — roles where I can bring AI thinking into a marketing team (or vice versa). I'm comfortable leading strategy independently and collaborating closely with dev teams. Want to start a conversation? Drop me a line at digitalVamshidhar@gmail.com →",
      skills: "My core stack spans SEO, Google Ads, LinkedIn Ads, CRO, GA4, and Looker Studio on the marketing side — plus TypeScript, JavaScript, Node.js, Prompt Engineering, and AI tool development on the tech side. That dual fluency is what lets me build automation workflows most marketers can only dream of."
    }
  };

  /* ════════════════════════════════════════════════════════
     UTILITIES
     ════════════════════════════════════════════════════════ */
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s == null ? '' : s);
    return div.innerHTML;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function reinitTilt() {
    if (typeof window.__reinitTilt === 'function') window.__reinitTilt();
  }

  /* ════════════════════════════════════════════════════════
     WAIT FOR DOM
     ════════════════════════════════════════════════════════ */
  const ready = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  ready(() => {
    injectHeroMeshBlobs();
    injectHireBeacon();
    injectGitHubStats();
    injectROICalculator();
    injectAIChat();
    initWordReveals();
    injectCaseStudyModals();
    reinitTilt();
  });

  /* ════════════════════════════════════════════════════════
     1. AMBIENT MESH BLOBS IN HERO
     ════════════════════════════════════════════════════════ */
  function injectHeroMeshBlobs() {
    const heroBg = document.querySelector('.hero-bg');
    if (!heroBg) return;
    const mesh = document.createElement('div');
    mesh.className = 'hero-mesh';
    mesh.innerHTML = '<div class="mesh-blob"></div><div class="mesh-blob"></div><div class="mesh-blob"></div>';
    heroBg.prepend(mesh);

    document.addEventListener('mousemove', (e) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 24;
      const y = (e.clientY / window.innerHeight - 0.5) * 16;
      const blobs = mesh.querySelectorAll('.mesh-blob');
      blobs.forEach((b, i) => {
        const factor = (i + 1) * 0.4;
        b.style.transform = `translate(${x * factor}px, ${y * factor}px)`;
      });
    }, { passive: true });
  }

  /* ════════════════════════════════════════════════════════
     2. HIRE BEACON — replaces the plain hero badge entirely
     ════════════════════════════════════════════════════════ */
  function injectHireBeacon() {
    const badge = document.querySelector('.hero-badge');
    if (!badge) return;
    const beacon = document.createElement('span');
    beacon.className = 'hire-beacon';
    beacon.setAttribute('data-animate', 'fade-in');
    beacon.setAttribute('data-delay', '200');
    beacon.innerHTML = '<span class="beacon-ring"></span>Available for Opportunities — Let\'s talk!';
    badge.replaceWith(beacon);
  }

  /* ════════════════════════════════════════════════════════
     3. LIVE GITHUB STATS
     ════════════════════════════════════════════════════════ */
  function injectGitHubStats() {
    const USERNAME = CONFIG.GITHUB_USERNAME;
    const CACHE_KEY = 'github_stats_v1';
    const CACHE_TTL = 60 * 60 * 1000;

    const impactSection = document.getElementById('impact');
    if (!impactSection) {
      console.warn('[GitHub Stats] #impact section not found');
      return;
    }

    // Inject skeleton immediately
    const section = document.createElement('section');
    section.className = 'github-stats-section';
    section.id = 'github-stats';
    section.setAttribute('data-animate', 'fade-up');
    section.innerHTML = `
      <div class="container">
        <div class="github-stats-header">
          <span class="github-stats-tag">
            <i class="fab fa-github"></i>
            Live from GitHub
            <span class="live-dot"></span>
          </span>
          <h3 class="github-stats-title">Real-time activity from my repositories</h3>
        </div>
        <div class="github-stats-grid" id="ghStatsGrid">
          <div class="github-stat-card loading"><div class="gh-stat-skeleton"></div></div>
          <div class="github-stat-card loading"><div class="gh-stat-skeleton"></div></div>
          <div class="github-stat-card loading"><div class="gh-stat-skeleton"></div></div>
          <div class="github-stat-card loading"><div class="gh-stat-skeleton"></div></div>
        </div>
      </div>`;
    impactSection.parentNode.insertBefore(section, impactSection.nextSibling);

    // Now fetch & render
    fetchAndRender();

    async function fetchAndRender() {
      try {
        // Try cache first
        let data = null;
        try {
          const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
          if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
            data = cached.data;
          }
        } catch (e) { /* ignore */ }

        if (!data) {
          const [userRes, reposRes] = await Promise.all([
            fetch(`https://api.github.com/users/${USERNAME}`),
            fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed`)
          ]);
          if (!userRes.ok || !reposRes.ok) throw new Error('GitHub API error');
          const user = await userRes.json();
          const repos = await reposRes.json();

          const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
          const recentlyActive = repos.filter(r => new Date(r.pushed_at).getTime() > thirtyDaysAgo).length;

          let lastCommitRepo = repos[0] || null;
          let lastCommitTime = 0;
          repos.forEach(r => {
            const t = new Date(r.pushed_at).getTime();
            if (t > lastCommitTime) {
              lastCommitTime = t;
              lastCommitRepo = r;
            }
          });

          data = {
            repos: user.public_repos,
            stars: totalStars,
            recentlyActive,
            lastCommitTime,
            lastCommitRepoName: lastCommitRepo ? lastCommitRepo.name : null
          };

          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
          } catch (e) { /* ignore */ }
        }

        renderGitHubStats(data);
      } catch (err) {
        console.error('[GitHub Stats] Failed:', err);
        renderGitHubError();
      }
    }

    function renderGitHubStats(stats) {
      const grid = document.getElementById('ghStatsGrid');
      if (!grid) return;

      const lastCommitHref = stats.lastCommitRepoName
        ? `https://github.com/${USERNAME}/${stats.lastCommitRepoName}`
        : `https://github.com/${USERNAME}`;
      const lastCommitSub = stats.lastCommitRepoName
        ? `<span class="gh-stat-sublabel">→ ${escapeHtml(stats.lastCommitRepoName)}</span>`
        : '';

      grid.innerHTML = `
        <a href="https://github.com/${USERNAME}?tab=repositories" target="_blank" rel="noopener noreferrer" class="github-stat-card">
          <div class="gh-stat-icon"><i class="fas fa-code-branch"></i></div>
          <div class="gh-stat-value">${stats.repos}</div>
          <div class="gh-stat-label">Public Repos</div>
        </a>
        <a href="https://github.com/${USERNAME}" target="_blank" rel="noopener noreferrer" class="github-stat-card">
          <div class="gh-stat-icon"><i class="fas fa-star"></i></div>
          <div class="gh-stat-value">${stats.stars}</div>
          <div class="gh-stat-label">Stars Earned</div>
        </a>
        <div class="github-stat-card">
          <div class="gh-stat-icon"><i class="fas fa-fire"></i></div>
          <div class="gh-stat-value">${stats.recentlyActive}</div>
          <div class="gh-stat-label">Active in 30 Days</div>
        </div>
        <a href="${lastCommitHref}" target="_blank" rel="noopener noreferrer" class="github-stat-card">
          <div class="gh-stat-icon"><i class="fas fa-clock"></i></div>
          <div class="gh-stat-value">${relativeTime(stats.lastCommitTime)}</div>
          <div class="gh-stat-label">Last Commit ${lastCommitSub}</div>
        </a>`;
    }

    function renderGitHubError() {
      const grid = document.getElementById('ghStatsGrid');
      if (!grid) return;
      grid.innerHTML = `
        <div class="github-stat-error">
          <i class="fab fa-github"></i>
          <span>View my repositories directly on
            <a href="https://github.com/${USERNAME}" target="_blank" rel="noopener noreferrer">GitHub →</a>
          </span>
        </div>`;
    }

    function relativeTime(timestamp) {
      if (!timestamp) return '—';
      const diff = Date.now() - timestamp;
      const minutes = Math.floor(diff / 60000);
      const hours = Math.floor(diff / 3600000);
      const days = Math.floor(diff / 86400000);
      if (minutes < 1) return 'just now';
      if (minutes < 60) return minutes + 'm ago';
      if (hours < 24) return hours + 'h ago';
      if (days < 30) return days + 'd ago';
      const months = Math.floor(days / 30);
      return months + 'mo ago';
    }
  }

  /* ════════════════════════════════════════════════════════
     4. ROI IMPACT CALCULATOR
     ════════════════════════════════════════════════════════ */
  function injectROICalculator() {
    const skillsSection = document.getElementById('skills');
    if (!skillsSection) return;

    const section = document.createElement('section');
    section.id = 'roi-calculator';
    section.setAttribute('data-animate', 'fade-up');
    section.innerHTML = `
      <div class="container">
        <div class="section-header">
          <span class="section-tag">ROI Calculator</span>
          <h2 class="section-title">What Would Hiring Me <span class="gradient-text">Return?</span></h2>
          <p class="section-desc">Adjust the sliders to model the potential business impact — based on real results I've delivered.</p>
        </div>
        <div class="roi-wrapper">
          <div class="roi-controls tilt-card" style="background:var(--bg-card);border:1px solid var(--border-color);border-radius:20px;padding:36px;">
            <div class="roi-input-group">
              <label>Monthly Website Visits</label>
              <div class="roi-value-display" id="roiVisitsDisplay">50,000</div>
              <input type="range" class="roi-slider" id="roiVisits" min="5000" max="500000" step="5000" value="50000">
            </div>
            <div class="roi-input-group">
              <label>Current Lead Conversion Rate (%)</label>
              <div class="roi-value-display" id="roiConvDisplay">1.5%</div>
              <input type="range" class="roi-slider" id="roiConv" min="0.5" max="8" step="0.1" value="1.5">
            </div>
            <div class="roi-input-group">
              <label>Average Revenue per Lead (₹)</label>
              <div class="roi-value-display" id="roiRevenueDisplay">₹25,000</div>
              <input type="range" class="roi-slider" id="roiRevenue" min="1000" max="200000" step="1000" value="25000">
            </div>
            <div class="roi-input-group">
              <label>Monthly Paid Ads Budget (₹)</label>
              <div class="roi-value-display" id="roiBudgetDisplay">₹1,00,000</div>
              <input type="range" class="roi-slider" id="roiBudget" min="10000" max="1000000" step="10000" value="100000">
            </div>
          </div>
          <div class="roi-results">
            <div class="roi-results-title">Projected Monthly Impact</div>
            <div class="roi-metric">
              <div class="roi-metric-label"><i class="fas fa-chart-line"></i> Organic Traffic Lift (15%)</div>
              <div class="roi-metric-value" id="roiTrafficLift">+7,500</div>
            </div>
            <div class="roi-metric">
              <div class="roi-metric-label"><i class="fas fa-users"></i> Additional Leads / Month</div>
              <div class="roi-metric-value" id="roiLeadsGain">+113</div>
            </div>
            <div class="roi-metric">
              <div class="roi-metric-label"><i class="fas fa-funnel-dollar"></i> CRO Uplift (12% conversion gain)</div>
              <div class="roi-metric-value" id="roiCroLift">₹5,04,000</div>
            </div>
            <div class="roi-metric">
              <div class="roi-metric-label"><i class="fas fa-ad"></i> Paid Ads ROAS Improvement (25%)</div>
              <div class="roi-metric-value" id="roiRoasLift">₹25,000</div>
            </div>
            <div class="roi-metric" style="border-top:2px solid var(--accent-primary);margin-top:8px;padding-top:20px;">
              <div class="roi-metric-label" style="font-weight:700;color:var(--text-primary);"><i class="fas fa-trophy"></i> Total Monthly Revenue Impact</div>
              <div class="roi-metric-value big" id="roiTotal">₹5,29,000</div>
            </div>
            <div class="roi-disclaimer">
              Projections are based on conservative benchmarks from Vamshidhar's real-world results: 15% organic traffic growth, 12% conversion rate improvement via CRO/A-B testing, and 25% ROAS improvement through paid media optimization.
            </div>
            <div class="roi-cta-row">
              <a href="mailto:digitalVamshidhar@gmail.com" class="btn btn-primary magnetic-btn" style="flex:1;justify-content:center;">
                <i class="fas fa-envelope"></i> Let's Discuss
              </a>
              <a href="https://linkedin.com/in/vamshidharreddym" target="_blank" rel="noopener noreferrer" class="btn btn-secondary magnetic-btn" style="flex:1;justify-content:center;">
                <i class="fab fa-linkedin"></i> Connect
              </a>
            </div>
          </div>
        </div>
      </div>`;

    skillsSection.parentNode.insertBefore(section, skillsSection);

    const roiVisits  = document.getElementById('roiVisits');
    const roiConv    = document.getElementById('roiConv');
    const roiRevenue = document.getElementById('roiRevenue');
    const roiBudget  = document.getElementById('roiBudget');

    const fmt = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
    const fmtNum = (n) => '+' + Math.round(n).toLocaleString('en-IN');

    function recalc() {
      const visits  = parseFloat(roiVisits.value);
      const conv    = parseFloat(roiConv.value) / 100;
      const revenue = parseFloat(roiRevenue.value);
      const budget  = parseFloat(roiBudget.value);

      document.getElementById('roiVisitsDisplay').textContent  = Math.round(visits).toLocaleString('en-IN');
      document.getElementById('roiConvDisplay').textContent    = parseFloat(roiConv.value).toFixed(1) + '%';
      document.getElementById('roiRevenueDisplay').textContent = fmt(revenue);
      document.getElementById('roiBudgetDisplay').textContent  = fmt(budget);

      const trafficLift = visits * 0.15;
      const leadsGain   = trafficLift * conv;
      const croLift     = visits * (conv * 1.12 - conv) * revenue;
      const roasLift    = budget * 0.25;
      const total       = leadsGain * revenue + croLift + roasLift;

      document.getElementById('roiTrafficLift').textContent = fmtNum(trafficLift);
      document.getElementById('roiLeadsGain').textContent   = fmtNum(leadsGain);
      document.getElementById('roiCroLift').textContent     = fmt(croLift);
      document.getElementById('roiRoasLift').textContent    = fmt(roasLift);
      document.getElementById('roiTotal').textContent       = fmt(total);

      [roiVisits, roiConv, roiRevenue, roiBudget].forEach(sl => {
        const pct = ((sl.value - sl.min) / (sl.max - sl.min)) * 100;
        sl.style.background = `linear-gradient(to right, #6366f1 ${pct}%, var(--bg-tertiary) ${pct}%)`;
      });
    }

    [roiVisits, roiConv, roiRevenue, roiBudget].forEach(sl => {
      sl.addEventListener('input', recalc);
    });
    recalc();
  }

  /* ════════════════════════════════════════════════════════
     5. AI CHAT WIDGET
     ════════════════════════════════════════════════════════ */
  function injectAIChat() {
    const beacon = document.createElement('div');
    beacon.className = 'ai-chat-beacon';
    beacon.innerHTML = `
      <div class="ai-chat-tooltip">Ask me anything — I'll answer as Vamshidhar!</div>
      <button class="ai-chat-trigger" id="aiChatTrigger" aria-label="Open AI chat">
        <i class="fas fa-robot"></i>
        <span class="chat-badge"></span>
      </button>`;
    document.body.appendChild(beacon);

    const panel = document.createElement('div');
    panel.className = 'ai-chat-panel';
    panel.id = 'aiChatPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', "Chat with Vamshidhar's AI assistant");
    panel.innerHTML = `
      <div class="chat-panel-header">
        <div class="chat-avatar">VR</div>
        <div class="chat-header-info">
          <p class="chat-header-name">Vamshidhar Reddy M</p>
          <span class="chat-header-status">AI-Powered · Online</span>
        </div>
        <button class="chat-close" id="aiChatClose" aria-label="Close chat"><i class="fas fa-times"></i></button>
      </div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-quick-replies" id="chatQuickReplies">
        <button class="chat-quick-reply" data-q="Tell me about your experience">Experience</button>
        <button class="chat-quick-reply" data-q="What AI tools have you built?">AI Projects</button>
        <button class="chat-quick-reply" data-q="What are your SEO skills?">SEO Skills</button>
        <button class="chat-quick-reply" data-q="Why should I hire you?">Why Hire You?</button>
      </div>
      <div class="chat-input-row">
        <input type="text" class="chat-input" id="chatInput" placeholder="Ask Vamshidhar anything…" maxlength="300" autocomplete="off">
        <button class="chat-send" id="chatSend" aria-label="Send message"><i class="fas fa-paper-plane"></i></button>
      </div>
      <div class="chat-powered-by">AI-Powered Assistant · Always verify important info directly</div>`;
    document.body.appendChild(panel);

    const trigger    = document.getElementById('aiChatTrigger');
    const closeBtn   = document.getElementById('aiChatClose');
    const chatInput  = document.getElementById('chatInput');
    const sendBtn    = document.getElementById('chatSend');
    const messagesEl = document.getElementById('chatMessages');
    const quickEl    = document.getElementById('chatQuickReplies');

    let isOpen = false;
    let isThinking = false;
    const history = [];

    trigger.addEventListener('click', () => togglePanel());
    closeBtn.addEventListener('click', () => togglePanel(false));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) togglePanel(false);
    });

    function togglePanel(forceState) {
      isOpen = forceState !== undefined ? forceState : !isOpen;
      panel.classList.toggle('open', isOpen);
      if (isOpen) {
        if (messagesEl.children.length === 0) {
          addBotMessage("Hi! I'm Vamshidhar's AI assistant. Ask me about my experience, AI projects, or why I'd be a great fit for your team 👋");
        }
        setTimeout(() => { try { chatInput.focus(); } catch (_) {} }, 200);
      }
    }

    quickEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chat-quick-reply');
      if (!btn) return;
      sendMessage(btn.dataset.q);
      quickEl.style.display = 'none';
    });

    sendBtn.addEventListener('click', () => {
      const text = chatInput.value.trim();
      if (text) { sendMessage(text); chatInput.value = ''; }
    });

    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) { sendMessage(text); chatInput.value = ''; }
      }
    });

    function addBotMessage(text) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg bot';
      const avatar = document.createElement('div');
      avatar.className = 'chat-msg-avatar';
      avatar.textContent = 'VR';
      const bubble = document.createElement('div');
      bubble.className = 'chat-msg-bubble';
      bubble.textContent = text;
      wrap.appendChild(avatar);
      wrap.appendChild(bubble);
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addUserMessage(text) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg user';
      const avatar = document.createElement('div');
      avatar.className = 'chat-msg-avatar';
      avatar.innerHTML = '<i class="fas fa-user" style="font-size:0.75rem"></i>';
      const bubble = document.createElement('div');
      bubble.className = 'chat-msg-bubble';
      bubble.textContent = text;
      wrap.appendChild(avatar);
      wrap.appendChild(bubble);
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      const div = document.createElement('div');
      div.className = 'chat-msg bot';
      div.id = 'chatTyping';
      div.innerHTML = `
        <div class="chat-msg-avatar">VR</div>
        <div class="chat-typing"><span></span><span></span><span></span></div>`;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function removeTyping() {
      const t = document.getElementById('chatTyping');
      if (t) t.remove();
    }

    async function sendMessage(text) {
      if (isThinking) return;
      isThinking = true;
      sendBtn.disabled = true;

      addUserMessage(text);
      history.push({ role: 'user', content: text });

      await sleep(300);
      showTyping();

      let reply;
      try {
        if (CONFIG.AI_PROXY_URL) {
          reply = await fetchAIReply(history);
        } else {
          reply = await mockAIReply(text);
        }
      } catch (err) {
        reply = "Sorry, I hit a snag! Please email digitalVamshidhar@gmail.com directly — I'll respond promptly 🙂";
      }

      await sleep(200);
      removeTyping();
      addBotMessage(reply);
      history.push({ role: 'assistant', content: reply });

      isThinking = false;
      sendBtn.disabled = false;
    }

    async function fetchAIReply(msgs) {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 15000);
      try {
        const res = await fetch(CONFIG.AI_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: CONFIG.PERSONA_SYSTEM_PROMPT,
            messages: msgs,
            max_tokens: 200
          }),
          signal: ctrl.signal
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error('API error: ' + res.status);
        const data = await res.json();
        if (data && data.content && data.content[0] && data.content[0].text) return data.content[0].text;
        if (data && typeof data.reply === 'string') return data.reply;
        if (typeof data === 'string') return data;
        throw new Error('Unexpected response format');
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    async function mockAIReply(text) {
      await sleep(900 + Math.random() * 600);
      const lower = text.toLowerCase();
      const s = CONFIG.SCRIPTED_ANSWERS;
      if (/experience|work|job|company|career|background/.test(lower)) return s.experience;
      if (/ai|artificial|tool|build|built|automat|chrome|extension|seo agent|web summarizer|security/.test(lower)) return s.ai;
      if (/seo|search|rank|organic|keyword|traffic/.test(lower)) return s.seo;
      if (/hire|why you|skills overview|what can you|capabilities/.test(lower)) return s.hire;
      if (/skill|tech|stack|google ads|ppc|analytics|looker|typescript/.test(lower)) return s.skills;
      return s.default;
    }
  }

  /* ════════════════════════════════════════════════════════
     6. WORD-BY-WORD REVEAL FOR SECTION DESCRIPTIONS
     ════════════════════════════════════════════════════════ */
  function initWordReveals() {
    document.querySelectorAll('.section-desc').forEach((el) => {
      el.classList.add('word-reveal');
      const words = el.textContent.trim().split(/\s+/);
      el.textContent = '';
      words.forEach((w, i) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = w;
        span.style.transitionDelay = (i * 0.04) + 's';
        el.appendChild(span);
        if (i < words.length - 1) {
          el.appendChild(document.createTextNode(' '));
        }
      });
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animated');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });

    document.querySelectorAll('.word-reveal').forEach(el => observer.observe(el));
  }

  /* ════════════════════════════════════════════════════════
     7. CASE STUDY DEEP-DIVE MODALS
     ════════════════════════════════════════════════════════ */
  const CASE_STUDIES = {
    'AI SEO Agent': {
      icon: 'fa-search',
      problem: "Most SEO audits are manual, slow, and inconsistent — agencies and freelancers spend hours per site checking on-page factors, crawling for technical issues, and compiling recommendations by hand. There was no fast, repeatable way to get a structured, data-backed SEO audit without expensive enterprise tools.",
      approach: "Built a full-stack audit tool combining Gemini AI's reasoning with real crawling infrastructure. Playwright handles headless browser crawling to capture real rendered pages (not just raw HTML), while a TypeScript + Node.js backend orchestrates the crawl, stores results in SQLite for persistence, and feeds page data to Gemini AI for analysis. The AI evaluates on-page SEO factors (titles, meta descriptions, heading structure, content depth, internal linking) and generates prioritized, actionable recommendations rather than a generic checklist.",
      result: "Delivered as a live, working web application on Google AI Studio — not just a local script. Demonstrates the full product lifecycle: architecture, data persistence, AI integration, and deployment. Directly applies skills from 8+ years of hands-on SEO work, now automated into a tool other marketers and agencies could use.",
      tech: ['TypeScript', 'Gemini AI', 'Node.js', 'SQLite', 'Playwright', 'Vite'],
      link: 'https://github.com/mvamshi56/seoagent'
    },
    'AI Web Summarizer': {
      icon: 'fa-file-alt',
      problem: "Marketers and researchers constantly need to digest long articles, reports, and competitor content quickly — but switching between tabs, copy-pasting into separate AI tools, and waiting on slow cloud processing breaks focus and wastes time, especially on lower-spec machines.",
      approach: "Built a lightweight Chrome extension that works directly inside the browser, using Groq AI's extremely fast inference to summarize whatever page the user is currently viewing — no tab-switching, no copy-pasting. Deliberately optimized for low-RAM systems so it stays fast and unobtrusive even on older hardware, with a clean popup UI offering configurable summary options.",
      result: "Published as an open-source MIT-licensed project with a clear, extensible structure (popup, content script, and options modules separated cleanly). Solves a real daily friction point in content-heavy research and competitive analysis work, and is built to be picked up and extended by other developers.",
      tech: ['JavaScript', 'HTML', 'Groq AI', 'Chrome Extension'],
      link: 'https://github.com/mvamshi56/AI-Web-Summarizer'
    },
    'AI Security Intelligence Platform': {
      icon: 'fa-shield-alt',
      problem: "Security and risk assessment workflows are often manual, fragmented, and hard to standardize across teams — there's a gap between raw vulnerability data and structured, actionable intelligence that decision-makers can act on quickly.",
      approach: "Designed and built an AI-powered platform using an MCP (Model Context Protocol) server architecture — the same emerging standard used to let AI models interact with external tools and structured data sources. A dedicated AI-driven security analysis server handles vulnerability assessment and risk analysis logic, while a TypeScript client manages communication between components in a clean client-server model.",
      result: "Demonstrates the ability to design and build intelligent, modular automated systems beyond marketing-specific use cases — applying the same systems-thinking and structured-analysis instincts from SEO and campaign work to a completely different domain. Built to production-ready standards, not just a proof of concept.",
      tech: ['TypeScript', 'Gemini AI', 'MCP Server', 'Node.js'],
      link: 'https://github.com/mvamshi56/AI-SECURITY'
    }
  };

  function injectCaseStudyModals() {
    const cards = document.querySelectorAll('.project-card');
    if (!cards.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'case-study-overlay';
    overlay.id = 'caseStudyOverlay';
    overlay.innerHTML = `
      <div class="case-study-modal" role="dialog" aria-modal="true" aria-labelledby="csTitle">
        <button class="case-study-close" id="caseStudyClose" aria-label="Close case study"><i class="fas fa-times"></i></button>
        <div class="case-study-content" id="caseStudyContent"></div>
      </div>`;
    document.body.appendChild(overlay);

    function closeModal() {
      overlay.classList.remove('open');
      document.body.style.overflow = '';
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
    document.getElementById('caseStudyClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal();
    });

    cards.forEach((card) => {
      const titleEl = card.querySelector('.project-title');
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      const study = CASE_STUDIES[title];
      if (!study) return;

      card.classList.add('has-case-study');
      const cta = document.createElement('button');
      cta.className = 'case-study-trigger';
      cta.innerHTML = 'View case study <i class="fas fa-arrow-right"></i>';
      cta.setAttribute('aria-label', 'View case study for ' + title);

      const footer = card.querySelector('.project-footer');
      if (footer) footer.appendChild(cta);

      cta.addEventListener('click', (e) => {
        e.stopPropagation();
        openCaseStudy(title, study);
      });
    });

    function openCaseStudy(title, study) {
      const content = document.getElementById('caseStudyContent');
      content.innerHTML = `
        <div class="cs-header">
          <div class="cs-icon"><i class="fas ${escapeHtml(study.icon)}"></i></div>
          <h2 class="cs-title" id="csTitle">${escapeHtml(title)}</h2>
        </div>
        <div class="cs-tech-row">
          ${study.tech.map(t => '<span class="cs-tech-tag">' + escapeHtml(t) + '</span>').join('')}
        </div>
        <div class="cs-section">
          <div class="cs-section-label"><i class="fas fa-exclamation-circle"></i> The problem</div>
          <p class="cs-section-text">${escapeHtml(study.problem)}</p>
        </div>
        <div class="cs-section">
          <div class="cs-section-label"><i class="fas fa-cogs"></i> The approach</div>
          <p class="cs-section-text">${escapeHtml(study.approach)}</p>
        </div>
        <div class="cs-section">
          <div class="cs-section-label"><i class="fas fa-trophy"></i> The result</div>
          <p class="cs-section-text">${escapeHtml(study.result)}</p>
        </div>
        <a href="${escapeHtml(study.link)}" target="_blank" rel="noopener noreferrer" class="cs-github-link">
          <i class="fab fa-github"></i> View source on GitHub
        </a>`;
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

})();
