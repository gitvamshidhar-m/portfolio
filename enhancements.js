/**
 * VAMSHIDHAR REDDY M — PORTFOLIO ENHANCEMENTS 2026
 * Drop-in: add <script src="enhancements.js"></script> AFTER script.js in index.html
 * Requires: Anthropic Claude API proxied at /api/chat (see README below)
 *
 * ──────────────────────────────────────────────────────────────
 * ZERO files from the original are changed. Just append two tags.
 * ──────────────────────────────────────────────────────────────
 */

(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════
     CONFIG — edit these to match your deployment
     ════════════════════════════════════════════════════════ */
  const CONFIG = {
    // If you deploy a serverless proxy (e.g. Vercel /api/chat), set this.
    // For GitHub Pages demo mode set to null → AI will use pre-scripted answers.
    AI_PROXY_URL: null, // e.g. 'https://your-vercel-app.vercel.app/api/chat'

    PERSONA_SYSTEM_PROMPT: `You are Vamshidhar Reddy M — an AI-Powered Digital Marketing Specialist with 8+ years of experience in SEO, PPC, AI Automation, and Growth Marketing, based in Hyderabad, India. You are answering questions from potential employers and clients visiting your portfolio site.

Key facts about you:
- Currently: Digital Marketing Specialist at Autozilla Software Solutions Pvt Ltd (May 2023–Present)
- Grew organic traffic 15%, secured first-page Google rankings, generated 70+ leads/month, managed Rs.2L+/month Google Ads budgets
- Built AI tools: AI Newsletter Digest (Python), AI Web Summarizer (Chrome Extension + Groq AI), AI Security Intelligence Platform (TypeScript + Gemini AI + MCP)
- Skills: SEO, Google Ads, LinkedIn Ads, PPC, GA4, Looker Studio, Prompt Engineering, TypeScript, JavaScript, Node.js
- Education: M.Tech Power Electronics (VTU), B.E. ECE (VTU)
- Certifications: Generative AI Mastermind (Outskill), Advanced SEO (LinkedIn Learning)
- Languages: English (Professional), Hindi (Fluent), Telugu (Native), Kannada (Fluent)
- Email: digitalVamshidhar@gmail.com | LinkedIn: vamshidharreddym | GitHub: mvamshi56
- Available for: Full-time roles, consulting, AI+marketing projects

Be warm, concise, and confident. If asked about salary, say you're open to discussing based on scope and fit. Keep answers to 2–4 sentences max. Always end with a light invitation to connect.`,

    // Pre-scripted fallback answers for GitHub Pages (no backend needed)
    SCRIPTED_ANSWERS: {
      default: "Great question! I bring 8+ years of digital marketing expertise fused with hands-on AI development — a rare combo that turns strategy into measurable growth. I'd love to walk you through my work. Feel free to email me at digitalVamshidhar@gmail.com or connect on LinkedIn!",
      experience: "I'm currently a Digital Marketing Specialist at Autozilla Software Solutions, where I've driven a 15% traffic lift, secured first-page rankings for competitive keywords, and generate 70+ qualified leads every month on a Rs.2L+ monthly ad budget. Before that, I've worked across campaign management and technical SEO at Pranathi Software Services and FAMA Technologies.",
      ai: "I've built several AI tools from scratch — an AI Newsletter Digest in Python, a Chrome extension powered by Groq AI that summarizes any web page in real-time, and an AI Security Intelligence Platform using TypeScript and Gemini AI with MCP server architecture. These aren't side projects — they're tools I use to give my marketing work a real edge.",
      seo: "SEO is where I started and where I consistently deliver results. At Autozilla I run structured SEO audits, keyword gap analysis, and technical fixes that have landed us on page one for high-value terms. I layer GA4 data and Looker Studio dashboards on top so every decision is tied to real numbers.",
      hire: "I'm actively open to new opportunities — roles where I can bring AI thinking into a marketing team (or vice versa). I'm comfortable leading strategy independently and collaborating closely with dev teams. Want to start a conversation? Drop me a line at digitalVamshidhar@gmail.com 🚀",
      skills: "My core stack spans SEO, Google Ads, LinkedIn Ads, CRO, GA4, and Looker Studio on the marketing side — plus TypeScript, JavaScript, Node.js, Prompt Engineering, and AI tool development on the tech side. That dual fluency is what lets me build automation workflows most marketers can only dream of.",
    }
  };

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
    injectROICalculator();
    injectAIChat();
    initWordReveals();
  });

  /* ════════════════════════════════════════════════════════
     1. AMBIENT MESH BLOBS IN HERO
     ════════════════════════════════════════════════════════ */
  function injectHeroMeshBlobs() {
    const heroBg = document.querySelector('.hero-bg');
    if (!heroBg) return;
    const mesh = document.createElement('div');
    mesh.className = 'hero-mesh';
    mesh.innerHTML = `<div class="mesh-blob"></div><div class="mesh-blob"></div><div class="mesh-blob"></div>`;
    heroBg.prepend(mesh);

    // Subtle mouse-parallax for the mesh
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
     2. HERO NAME LETTER-HOVER ANIMATION
     ════════════════════════════════════════════════════════ */
  

  /* ════════════════════════════════════════════════════════
     3. HIRE BEACON — replaces the plain badge in hero
     ════════════════════════════════════════════════════════ */
  function injectHireBeacon() {
    const badge = document.querySelector('.hero-badge');
    if (!badge) return;
    badge.innerHTML = `
      <span class="hire-beacon">
        <span class="beacon-ring"></span>
        Available for Opportunities — Let's talk!
      </span>`;
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
              <a href="https://linkedin.com/in/vamshidharreddym" target="_blank" class="btn btn-secondary magnetic-btn" style="flex:1;justify-content:center;">
                <i class="fab fa-linkedin"></i> Connect
              </a>
            </div>
          </div>
        </div>
      </div>`;

    skillsSection.parentNode.insertBefore(section, skillsSection);

    // Wiring
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

      const trafficLift  = visits * 0.15;
      const leadsGain    = trafficLift * conv;
      const croLift      = visits * (conv * 1.12 - conv) * revenue;
      const roasLift     = budget * 0.25;
      const total        = leadsGain * revenue + croLift + roasLift;

      document.getElementById('roiTrafficLift').textContent = fmtNum(trafficLift);
      document.getElementById('roiLeadsGain').textContent   = fmtNum(leadsGain);
      document.getElementById('roiCroLift').textContent     = fmt(croLift);
      document.getElementById('roiRoasLift').textContent    = fmt(roasLift);
      document.getElementById('roiTotal').textContent       = fmt(total);

      // Update slider fill track visual
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
      <div class="chat-powered-by">Powered by Groq AI · Always verify important info directly</div>`;
    document.body.appendChild(panel);

    const trigger   = document.getElementById('aiChatTrigger');
    const closeBtn  = document.getElementById('aiChatClose');
    const chatInput = document.getElementById('chatInput');
    const sendBtn   = document.getElementById('chatSend');
    const messagesEl= document.getElementById('chatMessages');
    const quickEl   = document.getElementById('chatQuickReplies');

    let isOpen = false;
    let isThinking = false;
    const history = [];

    // Open / Close
    trigger.addEventListener('click', () => togglePanel());
    closeBtn.addEventListener('click', () => togglePanel(false));

    function togglePanel(forceState) {
      isOpen = forceState !== undefined ? forceState : !isOpen;
      panel.classList.toggle('open', isOpen);
      if (isOpen && messagesEl.children.length === 0) {
        addBotMessage("Hi! I'm Vamshidhar's AI assistant. Ask me about my experience, AI projects, or why I'd be a great fit for your team 👋");
      }
    }

    // Quick replies
    quickEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chat-quick-reply');
      if (!btn) return;
      sendMessage(btn.dataset.q);
      quickEl.style.display = 'none';
    });

    // Send
    sendBtn.addEventListener('click', () => {
      const text = chatInput.value.trim();
      if (text) { sendMessage(text); chatInput.value = ''; }
    });
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = chatInput.value.trim();
        if (text) { sendMessage(text); chatInput.value = ''; }
      }
    });

    function addBotMessage(text) {
      const div = document.createElement('div');
      div.className = 'chat-msg bot';
      div.innerHTML = `
        <div class="chat-msg-avatar">VR</div>
        <div class="chat-msg-bubble">${text}</div>`;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addUserMessage(text) {
      const div = document.createElement('div');
      div.className = 'chat-msg user';
      div.innerHTML = `
        <div class="chat-msg-avatar"><i class="fas fa-user" style="font-size:0.75rem"></i></div>
        <div class="chat-msg-bubble">${escapeHtml(text)}</div>`;
      messagesEl.appendChild(div);
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
      const res = await fetch(CONFIG.AI_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: CONFIG.PERSONA_SYSTEM_PROMPT,
          messages: msgs,
          max_tokens: 200
        })
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      // Support both direct Anthropic and proxy responses
      if (data.content && data.content[0]) return data.content[0].text;
      if (data.reply) return data.reply;
      throw new Error('Unexpected response format');
    }

    async function mockAIReply(text) {
      // Simulate network latency
      await sleep(900 + Math.random() * 600);
      const lower = text.toLowerCase();
      const s = CONFIG.SCRIPTED_ANSWERS;
      if (/experience|work|job|company|career|background/.test(lower)) return s.experience;
      if (/ai|artificial|tool|build|built|automat|python|chrome|extension/.test(lower)) return s.ai;
      if (/seo|search|rank|organic|keyword|traffic/.test(lower)) return s.seo;
      if (/hire|why you|skills overview|what can you|capabilities/.test(lower)) return s.hire;
      if (/skill|tech|stack|google ads|ppc|analytics|looker|typescript/.test(lower)) return s.skills;
      return s.default;
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    function escapeHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
  }

  /* ════════════════════════════════════════════════════════
     6. WORD-BY-WORD REVEAL FOR SECTION DESCRIPTIONS
     ════════════════════════════════════════════════════════ */
  function initWordReveals() {
    document.querySelectorAll('.section-desc').forEach((el) => {
      el.classList.add('word-reveal');
      el.setAttribute('data-animate', 'word-reveal');
      const words = el.textContent.trim().split(' ');
      el.textContent = '';
      words.forEach((w, i) => {
        const span = document.createElement('span');
        span.className = 'word';
        span.textContent = w + ' ';
        span.style.transitionDelay = `${i * 0.04}s`;
        el.appendChild(span);
      });
    });

    // Wire into existing IntersectionObserver pattern
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

})();
