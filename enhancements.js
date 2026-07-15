/**
 * VAMSHIDHAR REDDY M — PORTFOLIO ENHANCEMENTS 2026
 * With RAG (Retrieval-Augmented Generation) over GitHub README knowledge base
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════
     CONFIG
     ════════════════════════════════════════════════════════ */
  const CONFIG = {
    AI_PROXY_URL: '/api/chat',

    GITHUB_USERNAME: 'mvamshi56',

    PROJECT_REPOS: [
      { name: 'AI SEO Agent', owner: 'mvamshi56', repo: 'seoagent' },
      { name: 'AI Web Summarizer', owner: 'mvamshi56', repo: 'AI-Web-Summarizer' },
      { name: 'AI Security Intelligence Platform', owner: 'mvamshi56', repo: 'AI-SECURITY' }
    ],

    PERSONA_SYSTEM_PROMPT: `You are Vamshidhar Reddy M — an AI-Powered Digital Marketing Specialist with 8+ years of experience in SEO, PPC, AI Automation, and Growth Marketing, based in Hyderabad, India. You are answering questions from potential employers and clients visiting your portfolio site.

Key facts about you:
- Currently: Digital Marketing Specialist at Autozilla Software Solutions Pvt Ltd (May 2023–Present)
- Grew organic traffic 15%, secured first-page Google rankings, generated 70+ leads/month, managed Rs.2L+/month Google Ads budgets
- Built three AI tools: AI SEO Agent (TypeScript + Gemini AI + Playwright, live on Google AI Studio), AI Web Summarizer (Chrome Extension + Groq AI), AI Security Intelligence Platform (TypeScript + Gemini AI + MCP Server)
- Skills: SEO, Google Ads, LinkedIn Ads, PPC, GA4, Looker Studio, Prompt Engineering, TypeScript, JavaScript, Node.js
- Education: M.Tech Power Electronics (VTU), B.E. ECE (VTU)
- Certifications: Generative AI Mastermind (Outskill), Advanced SEO (LinkedIn Learning)
- Languages: English (Professional), Hindi (Fluent), Telugu (Native), Kannada (Fluent)
- Email: geovamshidhar@gmail.com | LinkedIn: vamshidharreddym | GitHub: mvamshi56
- Available for: Full-time roles, consulting, AI+marketing projects

Be warm, concise, and confident. If asked about salary, say you're open to discussing based on scope and fit. Keep answers to 2-4 sentences max. Always end with a light invitation to connect. When you have access to specific project context below, use it to give precise technical answers.`,

    SCRIPTED_ANSWERS: {
      default: "Great question! I bring 8+ years of digital marketing expertise fused with hands-on AI development — a rare combo that turns strategy into measurable growth. I'd love to walk you through my work. Feel free to email me at geovamshidhar@gmail.com or connect on LinkedIn!",
      experience: "I'm currently a Digital Marketing Specialist at Autozilla Software Solutions, where I've driven a 15% traffic lift, secured first-page rankings for competitive keywords, and generate 70+ qualified leads every month on a Rs.2L+ monthly ad budget. Before that, I've worked across campaign management and technical SEO at Pranathi Software Services and FAMA Technologies.",
      ai: "I've built three AI tools from scratch — the AI SEO Agent (TypeScript + Gemini AI with Playwright crawling, live on Google AI Studio), a Chrome extension powered by Groq AI that summarizes any web page in real-time, and an AI Security Intelligence Platform built on the MCP server architecture. These aren't side projects — they're tools I use to give my marketing work a real edge.",
      seo: "SEO is where I started and where I consistently deliver results. At Autozilla I run structured SEO audits, keyword gap analysis, and technical fixes that have landed us on page one for high-value terms. I layer GA4 data and Looker Studio dashboards on top so every decision is tied to real numbers.",
      hire: "I'm actively open to new opportunities — roles where I can bring AI thinking into a marketing team (or vice versa). I'm comfortable leading strategy independently and collaborating closely with dev teams. Want to start a conversation? Drop me a line at geovamshidhar@gmail.com →",
      skills: "My core stack spans SEO, Google Ads, LinkedIn Ads, CRO, GA4, and Looker Studio on the marketing side — plus TypeScript, JavaScript, Node.js, Prompt Engineering, and AI tool development on the tech side. That dual fluency is what lets me build automation workflows most marketers can only dream of."
    }
  };

  // Newline character used everywhere we need real newlines in strings.
  // Built via String.fromCharCode to survive any copy-paste decoding.
  const NL = String.fromCharCode(10);

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
     RAG — knowledge base from GitHub READMEs
     ════════════════════════════════════════════════════════ */
  const KNOWLEDGE_CACHE_KEY = 'project_knowledge_v1';
  const KNOWLEDGE_CACHE_TTL = 24 * 60 * 60 * 1000;

  const STOP_WORDS = new Set([
    'the','a','an','and','or','but','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'i','you','he','she','it','we','they','me','my','your','his','her','our','their',
    'this','that','these','those','tell','about','what','how','why','when','where','who','which',
    'in','on','at','to','from','with','by','for','of','as','than','then','so','too','very',
    'can','am','any','some','all','more','most','other','same','such','only','own','also',
    'just','here','there','if','no','not','out','up','down','over','under','again'
  ]);

  function tokenize(text) {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t));
  }

  function chunkText(text, chunkSize, overlap) {
    chunkSize = chunkSize || 400;
    overlap = overlap || 100;
    // Strip markdown noise and collapse all whitespace (including newlines) to single spaces.
    const cleaned = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]*`/g, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*_>]+/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const chunks = [];
    let i = 0;
    while (i < cleaned.length) {
      const end = Math.min(i + chunkSize, cleaned.length);
      const slice = cleaned.slice(i, end).trim();
      if (slice.length >= 50) chunks.push(slice);
      if (end >= cleaned.length) break;
      i += (chunkSize - overlap);
    }
    return chunks;
  }

  async function fetchProjectReadme(owner, repo) {
    for (const branch of ['main', 'master']) {
      try {
        const res = await fetch('https://raw.githubusercontent.com/' + owner + '/' + repo + '/' + branch + '/README.md');
        if (res.ok) return await res.text();
      } catch (e) { /* try next */ }
    }
    return null;
  }

  async function loadProjectKnowledge() {
    try {
      const cached = JSON.parse(localStorage.getItem(KNOWLEDGE_CACHE_KEY) || 'null');
      if (cached && (Date.now() - cached.timestamp) < KNOWLEDGE_CACHE_TTL && Array.isArray(cached.data)) {
        return cached.data;
      }
    } catch (e) { /* ignore */ }

    const results = await Promise.all(
      CONFIG.PROJECT_REPOS.map(async (proj) => {
        const readme = await fetchProjectReadme(proj.owner, proj.repo);
        if (!readme) return [];
        return chunkText(readme).map(text => ({ project: proj.name, text: text }));
      })
    );
    const knowledge = results.reduce((acc, arr) => acc.concat(arr), []);

    try {
      localStorage.setItem(KNOWLEDGE_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: knowledge }));
    } catch (e) { /* ignore */ }

    return knowledge;
  }

  function retrieveRelevantChunks(query, knowledge, k) {
    k = k || 3;
    const queryTokens = tokenize(query);
    if (!queryTokens.length || !knowledge.length) return [];

    const scored = knowledge.map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;
      queryTokens.forEach(term => {
        const wordRe = new RegExp('\\b' + term + '\\b', 'gi');
        const matches = text.match(wordRe);
        if (matches) score += matches.length;
      });
      return { project: chunk.project, text: chunk.text, score: score };
    });

    return scored
      .filter(c => c.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  /* ════════════════════════════════════════════════════════
     WAIT FOR DOM
     ════════════════════════════════════════════════════════ */
  const ready = (fn) => {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  };

  /* ════════════════════════════════════════════════════════
     CASE STUDIES DATA (must be defined before use)
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

  ready(() => {
    injectHeroMeshBlobs();
    injectHireBeacon();
    injectGitHubStats();
    injectROICalculator();

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
        b.style.transform = 'translate(' + (x * factor) + 'px, ' + (y * factor) + 'px)';
      });
    }, { passive: true });
  }

  /* ════════════════════════════════════════════════════════
     2. HIRE BEACON
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
     3. LIVE GITHUB STATS (with stale-cache fallback)
     ════════════════════════════════════════════════════════ */
  function injectGitHubStats() {
    const USERNAME = CONFIG.GITHUB_USERNAME;
    const CACHE_KEY = 'github_stats_v1';
    const CACHE_TTL = 6 * 60 * 60 * 1000;

    const grid = document.getElementById('ghStatsGrid');
    if (!grid) return;

    fetchAndRender();

    async function fetchAndRender() {
      let cachedData = null;
      let cacheAge = Infinity;
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && cached.data) {
          cachedData = cached.data;
          cacheAge = Date.now() - (cached.timestamp || 0);
        }
      } catch (e) { /* ignore */ }

      if (cachedData && cacheAge < CACHE_TTL) {
        renderGitHubStats(cachedData);
        return;
      }

      try {
        const [userRes, reposRes] = await Promise.all([
          fetch('https://api.github.com/users/' + USERNAME),
          fetch('https://api.github.com/users/' + USERNAME + '/repos?per_page=100&sort=pushed')
        ]);
        if (!userRes.ok || !reposRes.ok) throw new Error('GitHub API HTTP ' + userRes.status);

        const user = await userRes.json();
        const repos = await reposRes.json();

        const totalStars = repos.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentlyActive = repos.filter(r => new Date(r.pushed_at).getTime() > thirtyDaysAgo).length;

        let lastCommitRepo = repos[0] || null;
        let lastCommitTime = 0;
        repos.forEach(r => {
          const t = new Date(r.pushed_at).getTime();
          if (t > lastCommitTime) { lastCommitTime = t; lastCommitRepo = r; }
        });

        const data = {
          repos: user.public_repos,
          stars: totalStars,
          recentlyActive: recentlyActive,
          lastCommitTime: lastCommitTime,
          lastCommitRepoName: lastCommitRepo ? lastCommitRepo.name : null
        };

        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data }));
        } catch (e) { /* ignore */ }

        renderGitHubStats(data);
      } catch (err) {
        console.warn('[GitHub Stats] Fetch failed:', err.message);
        if (cachedData) {
          renderGitHubStats(cachedData);
        } else {
          renderGitHubFallback();
        }
      }
    }

    function renderGitHubStats(stats) {
      const grid = document.getElementById('ghStatsGrid');
      if (!grid) return;
      const lastCommitHref = stats.lastCommitRepoName
        ? 'https://github.com/' + USERNAME + '/' + stats.lastCommitRepoName
        : 'https://github.com/' + USERNAME;
      const lastCommitSub = stats.lastCommitRepoName
        ? '<span class="gh-stat-sublabel">→ ' + escapeHtml(stats.lastCommitRepoName) + '</span>'
        : '';
      grid.innerHTML =
        '<a href="https://github.com/' + USERNAME + '?tab=repositories" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-code-branch"></i></div>' +
          '<div class="gh-stat-value">' + stats.repos + '</div>' +
          '<div class="gh-stat-label">Public Repos</div>' +
        '</a>' +
        '<a href="https://github.com/' + USERNAME + '" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-star"></i></div>' +
          '<div class="gh-stat-value">' + stats.stars + '</div>' +
          '<div class="gh-stat-label">Stars Earned</div>' +
        '</a>' +
        '<div class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-fire"></i></div>' +
          '<div class="gh-stat-value">' + stats.recentlyActive + '</div>' +
          '<div class="gh-stat-label">Active in 30 Days</div>' +
        '</div>' +
        '<a href="' + lastCommitHref + '" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-clock"></i></div>' +
          '<div class="gh-stat-value">' + relativeTime(stats.lastCommitTime) + '</div>' +
          '<div class="gh-stat-label">Last Commit ' + lastCommitSub + '</div>' +
        '</a>';
    }

    function renderGitHubFallback() {
      const grid = document.getElementById('ghStatsGrid');
      if (!grid) return;
      const ghHref = 'https://github.com/' + USERNAME;
      grid.innerHTML =
        '<a href="' + ghHref + '?tab=repositories" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-code-branch"></i></div>' +
          '<div class="gh-stat-value">View</div>' +
          '<div class="gh-stat-label">Public Repos</div>' +
        '</a>' +
        '<a href="' + ghHref + '" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-star"></i></div>' +
          '<div class="gh-stat-value">View</div>' +
          '<div class="gh-stat-label">Stars on GitHub</div>' +
        '</a>' +
        '<a href="' + ghHref + '" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fas fa-fire"></i></div>' +
          '<div class="gh-stat-value">Active</div>' +
          '<div class="gh-stat-label">Builder</div>' +
        '</a>' +
        '<a href="' + ghHref + '" target="_blank" rel="noopener noreferrer" class="github-stat-card">' +
          '<div class="gh-stat-icon"><i class="fab fa-github"></i></div>' +
          '<div class="gh-stat-value">→</div>' +
          '<div class="gh-stat-label">See all on GitHub</div>' +
        '</a>';
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
    const roiVisits = document.getElementById('roiVisits');
    if (!roiVisits) return;
    const roiConv = document.getElementById('roiConv');
    const roiRevenue = document.getElementById('roiRevenue');
    const roiBudget = document.getElementById('roiBudget');

    if (!roiConv || !roiRevenue || !roiBudget) return;

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
        sl.style.background = 'linear-gradient(to right, #6366f1 ' + pct + '%, var(--bg-tertiary) ' + pct + '%)';
      });
    }

    [roiVisits, roiConv, roiRevenue, roiBudget].forEach(sl => {
      sl.addEventListener('input', recalc);
    });
    recalc();
  }

  /* ════════════════════════════════════════════════════════
     5. AI CHAT WIDGET (with RAG)
     ════════════════════════════════════════════════════════ */
  function injectAIChat() {
    const beacon = document.createElement('div');
    beacon.className = 'ai-chat-beacon';
    beacon.innerHTML =
      '<div class="ai-chat-tooltip">Ask me anything — I will answer as Vamshidhar!</div>' +
      '<button class="ai-chat-trigger" id="aiChatTrigger" aria-label="Open AI chat"><i class="fas fa-robot"></i><span class="chat-badge"></span></button>';
    document.body.appendChild(beacon);

    const panel = document.createElement('div');
    panel.className = 'ai-chat-panel';
    panel.id = 'aiChatPanel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat with Vamshidhar AI assistant');
    panel.innerHTML =
      '<div class="chat-panel-header">' +
        '<div class="chat-avatar">VR</div>' +
        '<div class="chat-header-info">' +
          '<p class="chat-header-name">Vamshidhar Reddy M</p>' +
          '<span class="chat-header-status">AI-Powered · RAG · Online</span>' +
        '</div>' +
        '<button class="chat-close" id="aiChatClose" aria-label="Close chat"><i class="fas fa-times"></i></button>' +
      '</div>' +
      '<div class="chat-messages" id="chatMessages"></div>' +
      '<div class="chat-quick-replies" id="chatQuickReplies">' +
        '<button class="chat-quick-reply" data-q="How does the AI SEO Agent work?">SEO Agent</button>' +
        '<button class="chat-quick-reply" data-q="Tell me about the Web Summarizer">Web Summarizer</button>' +
        '<button class="chat-quick-reply" data-q="What is the Security Platform built with?">Security Platform</button>' +
        '<button class="chat-quick-reply" data-q="Why should I hire you?">Why Hire You?</button>' +
      '</div>' +
      '<div class="chat-input-row">' +
        '<input type="text" class="chat-input" id="chatInput" placeholder="Ask about my projects, experience..." maxlength="300" autocomplete="off">' +
        '<button class="chat-send" id="chatSend" aria-label="Send message"><i class="fas fa-paper-plane"></i></button>' +
      '</div>' +
      '<div class="chat-powered-by">AI + RAG over my project READMEs · Always verify important info directly</div>';
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
          addBotMessage("Hi! I'm Vamshidhar's AI assistant — I have access to my actual project READMEs, so ask me anything specific about my AI tools or experience 👋");
        }
        if (!window.__knowledgeLoaded) {
          window.__knowledgeLoaded = true;
          loadProjectKnowledge().catch(() => { window.__knowledgeLoaded = false; });
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

    function addBotMessage(text, sources) {
      const wrap = document.createElement('div');
      wrap.className = 'chat-msg bot';
      const avatar = document.createElement('div');
      avatar.className = 'chat-msg-avatar';
      avatar.textContent = 'VR';
      const content = document.createElement('div');
      content.style.flex = '1';
      const bubble = document.createElement('div');
      bubble.className = 'chat-msg-bubble';
      bubble.textContent = text;
      content.appendChild(bubble);

      if (sources && sources.length) {
        const srcRow = document.createElement('div');
        srcRow.className = 'chat-msg-sources';
        const label = document.createElement('span');
        label.className = 'chat-msg-sources-label';
        label.textContent = 'Referenced:';
        srcRow.appendChild(label);
        sources.forEach(s => {
          const tag = document.createElement('span');
          tag.className = 'chat-msg-source-tag';
          tag.textContent = s;
          srcRow.appendChild(tag);
        });
        content.appendChild(srcRow);
      }

      wrap.appendChild(avatar);
      wrap.appendChild(content);
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

    function showTyping(label) {
      const div = document.createElement('div');
      div.className = 'chat-msg bot';
      div.id = 'chatTyping';
      div.innerHTML =
        '<div class="chat-msg-avatar">VR</div>' +
        '<div class="chat-typing-wrap">' +
          '<div class="chat-typing"><span></span><span></span><span></span></div>' +
          (label ? '<div class="chat-typing-label">' + escapeHtml(label) + '</div>' : '') +
        '</div>';
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

      await sleep(200);

      showTyping('Searching my project READMEs...');
      let relevantChunks = [];
      try {
        const knowledge = await loadProjectKnowledge();
        relevantChunks = retrieveRelevantChunks(text, knowledge, 3);
      } catch (e) {
        console.warn('[RAG] Knowledge load failed:', e);
      }

      removeTyping();
      await sleep(150);
      showTyping(relevantChunks.length ? 'Composing answer with context...' : 'Thinking...');

      let reply;
      let sourcesUsed = [];
      try {
        if (relevantChunks.length) {
          const seen = {};
          sourcesUsed = [];
          relevantChunks.forEach(c => {
            if (!seen[c.project]) { seen[c.project] = true; sourcesUsed.push(c.project); }
          });
        }
        if (CONFIG.AI_PROXY_URL) {
          reply = await fetchAIReply(history, relevantChunks);
        } else {
          reply = await mockAIReply(text);
        }
      } catch (err) {
        console.error('[Chat] Error:', err);
        reply = "Sorry, I hit a snag! Please email geovamshidhar@gmail.com directly — I'll respond promptly 🙂";
        sourcesUsed = [];
      }

      await sleep(200);
      removeTyping();
      addBotMessage(reply, sourcesUsed);
      history.push({ role: 'assistant', content: reply });

      isThinking = false;
      sendBtn.disabled = false;
    }

    async function fetchAIReply(msgs, relevantChunks) {
      let systemPrompt = CONFIG.PERSONA_SYSTEM_PROMPT;
      if (relevantChunks && relevantChunks.length) {
        const sep = NL + NL + '---' + NL + NL;
        const contextBlock = relevantChunks
          .map(c => '[From ' + c.project + ' README]:' + NL + c.text)
          .join(sep);
        systemPrompt = systemPrompt + NL + NL + 'RELEVANT PROJECT CONTEXT (use this when answering, speak naturally in first person):' + NL + contextBlock;
      }

      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), 20000);
      try {
        const res = await fetch(CONFIG.AI_PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system: systemPrompt,
            messages: msgs,
            max_tokens: 250
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

  function injectCaseStudyModals() {
    const cards = document.querySelectorAll('.project-card');
    if (!cards.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'case-study-overlay';
    overlay.id = 'caseStudyOverlay';
    overlay.innerHTML =
      '<div class="case-study-modal" role="dialog" aria-modal="true" aria-labelledby="csTitle">' +
        '<button class="case-study-close" id="caseStudyClose" aria-label="Close case study"><i class="fas fa-times"></i></button>' +
        '<div class="case-study-content" id="caseStudyContent"></div>' +
      '</div>';
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
      content.innerHTML =
        '<div class="cs-header">' +
          '<div class="cs-icon"><i class="fas ' + escapeHtml(study.icon) + '"></i></div>' +
          '<h2 class="cs-title" id="csTitle">' + escapeHtml(title) + '</h2>' +
        '</div>' +
        '<div class="cs-tech-row">' +
          study.tech.map(t => '<span class="cs-tech-tag">' + escapeHtml(t) + '</span>').join('') +
        '</div>' +
        '<div class="cs-section">' +
          '<div class="cs-section-label"><i class="fas fa-exclamation-circle"></i> The problem</div>' +
          '<p class="cs-section-text">' + escapeHtml(study.problem) + '</p>' +
        '</div>' +
        '<div class="cs-section">' +
          '<div class="cs-section-label"><i class="fas fa-cogs"></i> The approach</div>' +
          '<p class="cs-section-text">' + escapeHtml(study.approach) + '</p>' +
        '</div>' +
        '<div class="cs-section">' +
          '<div class="cs-section-label"><i class="fas fa-trophy"></i> The result</div>' +
          '<p class="cs-section-text">' + escapeHtml(study.result) + '</p>' +
        '</div>' +
        '<a href="' + escapeHtml(study.link) + '" target="_blank" rel="noopener noreferrer" class="cs-github-link"><i class="fab fa-github"></i> View source on GitHub</a>';
      overlay.classList.add('open');
      document.body.style.overflow = 'hidden';
    }
  }

})();
