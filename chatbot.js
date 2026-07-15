(function () {
  'use strict';

  /* ============================================================
     KNOWLEDGE BASE — used as RAG context for the AI
     ============================================================ */
  const KB = [
    {
      topic: 'About Vamshidhar',
      content: "Vamshidhar Reddy M is an AI-Powered Digital Marketing Specialist with 8+ years of experience in SEO, PPC, AI Automation, and Growth Marketing. Based in Hyderabad, India. He bridges marketing strategy with AI-driven engineering."
    },
    {
      topic: 'Current Role',
      content: "Digital Marketing Specialist at Autozilla Software Solutions Pvt Ltd (May 2023–Present). Grew organic traffic 15%, secured first-page Google rankings, generates 70+ qualified leads/month, manages Rs.2L+/month Google Ads budgets."
    },
    {
      topic: 'Previous Experience',
      content: "Previously worked at Pranathi Software Services and FAMA Technologies in campaign management and technical SEO roles."
    },
    {
      topic: 'Marketing Skills',
      content: "SEO, Google Ads, LinkedIn Ads, PPC, GA4, Looker Studio, CRO, Prompt Engineering, Keyword Research, Competitor Analysis, Technical SEO."
    },
    {
      topic: 'Technical Skills',
      content: "TypeScript, JavaScript, Node.js, Gemini AI, Groq AI, Playwright, Chrome Extensions, MCP Server architecture, REST APIs, SQLite."
    },
    {
      topic: 'AI SEO Agent',
      content: "Built a full-stack SEO audit tool combining Gemini AI with Playwright crawling. It evaluates on-page SEO factors (titles, meta descriptions, heading structure, content depth, internal linking) and generates prioritized, actionable recommendations. Tech: TypeScript, Gemini AI, Node.js, SQLite, Playwright, Vite. Repo: github.com/mvamshi56/seoagent"
    },
    {
      topic: 'AI Web Summarizer',
      content: "A Chrome extension that summarizes web pages using Groq AI's fast inference. Optimized for low-RAM systems. Tech: JavaScript, HTML, Groq AI, Chrome Extension API. Repo: github.com/mvamshi56/AI-Web-Summarizer"
    },
    {
      topic: 'AI Security Intelligence Platform',
      content: "An AI-powered platform using MCP (Model Context Protocol) server architecture. Ingests security alerts from multiple sources, normalizes them, and surfaces high-fidelity incidents with AI-generated context. Tech: TypeScript, Gemini AI, MCP Server, Node.js. Repo: github.com/mvamshi56/AI-SECURITY"
    },
    {
      topic: 'Education',
      content: "M.Tech in Power Electronics from VTU, B.E. in ECE from VTU."
    },
    {
      topic: 'Certifications',
      content: "Generative AI Mastermind (Outskill), Advanced SEO (LinkedIn Learning)."
    },
    {
      topic: 'Languages',
      content: "English (Professional), Hindi (Fluent), Telugu (Native), Kannada (Fluent)."
    },
    {
      topic: 'Contact',
      content: "Email: geovamshidhar@gmail.com | LinkedIn: vamshidharreddym | GitHub: mvamshi56"
    }
  ];

  /* ============================================================
     RESPONSE ENGINE — smart local matching
     ============================================================ */
  function findBestAnswer(query) {
    var q = query.toLowerCase();
    var scores = KB.map(function (item) {
      var text = (item.topic + ' ' + item.content).toLowerCase();
      var score = 0;
      var terms = q.split(/\s+/).filter(function (t) { return t.length > 2; });
      for (var t = 0; t < terms.length; t++) {
        var re = new RegExp(terms[t].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        var matches = text.match(re);
        if (matches) score += matches.length;
      }
      if (item.topic.toLowerCase().split(/\s+/).some(function (w) { return q.indexOf(w) >= 0; })) score += 3;
      return { item: item, score: score };
    });
    scores.sort(function (a, b) { return b.score - a.score; });
    if (!scores.length || scores[0].score === 0) return null;
    return scores[0].item.content;
  }

  var QUICK_ANSWERS = {
    'experience': "I'm a Digital Marketing Specialist at Autozilla Software Solutions (May 2023–Present). I grew organic traffic 15%, secured first-page Google rankings, generate 70+ qualified leads/month, and manage Rs.2L+/month Google Ads budgets. Before that, worked at Pranathi Software Services and FAMA Technologies.",
    'skills': "Marketing: SEO, Google Ads, LinkedIn Ads, PPC, GA4, Looker Studio, CRO, Prompt Engineering. Tech: TypeScript, JavaScript, Node.js, Gemini AI, Groq AI, Playwright, Chrome Extensions, MCP Server.",
    'projects': "I've built 3 AI tools: AI SEO Agent (TypeScript + Gemini + Playwright, live on Google AI Studio), AI Web Summarizer (Chrome Extension + Groq AI), and AI Security Intelligence Platform (TypeScript + Gemini + MCP). Each solves a real problem I faced in marketing work.",
    'contact': "Email: geovamshidhar@gmail.com | LinkedIn: vamshidharreddym | GitHub: mvamshi56. I'm open to full-time roles, consulting, and AI+marketing projects!",
    'default': "I bring 8+ years of digital marketing expertise fused with hands-on AI development. Reach out at geovamshidhar@gmail.com and let's talk!"
  };

  function getReply(text) {
    var lower = text.toLowerCase();
    if (/experience|work|job|career|autozilla|company/.test(lower)) return QUICK_ANSWERS.experience;
    if (/skill|tech|stack|tool|know|learn|expertise/.test(lower)) return QUICK_ANSWERS.skills;
    if (/project|built|build|made|create|github|repo|agent|summarizer|security|seo agent/.test(lower)) return QUICK_ANSWERS.projects;
    if (/contact|email|reach|hire|connect|linkedin/.test(lower)) return QUICK_ANSWERS.contact;
    var best = findBestAnswer(text);
    return best || QUICK_ANSWERS.default;
  }

  /* ============================================================
     CHAT UI
     ============================================================ */
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function injectChat() {
    if (document.getElementById('aiChatBeacon')) return;

    // Beacon
    const beacon = document.createElement('div');
    beacon.id = 'aiChatBeacon';
    beacon.className = 'ai-chat-beacon';
    beacon.innerHTML =
      '<div class="ai-chat-tooltip">Ask me anything!</div>' +
      '<button class="ai-chat-trigger" id="aiChatTrigger" aria-label="Chat"><i class="fas fa-robot"></i><span class="chat-badge"></span></button>';
    document.body.appendChild(beacon);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'aiChatPanel';
    panel.className = 'ai-chat-panel';
    panel.innerHTML =
      '<div class="chat-panel-header">' +
        '<div class="chat-avatar">VR</div>' +
        '<div class="chat-header-info">' +
          '<p class="chat-header-name">Vamshidhar Reddy M</p>' +
          '<span class="chat-header-status">Online</span>' +
        '</div>' +
        '<button class="chat-close" id="aiChatClose" aria-label="Close"><i class="fas fa-times"></i></button>' +
      '</div>' +
      '<div class="chat-messages" id="chatMessages"><div class="chat-msg bot"><div class="chat-msg-avatar">VR</div><div class="chat-msg-bubble">Hi there! Ask me about my experience, projects, skills, or anything else.</div></div></div>' +
      '<div class="chat-quick-replies" id="chatQuickReplies">' +
        '<button class="chat-quick-reply" data-q="What experience do you have?">Experience</button>' +
        '<button class="chat-quick-reply" data-q="Tell me about your AI projects">AI Projects</button>' +
        '<button class="chat-quick-reply" data-q="What skills do you have?">Skills</button>' +
        '<button class="chat-quick-reply" data-q="How can I contact you?">Contact</button>' +
      '</div>' +
      '<div class="chat-input-row">' +
        '<input type="text" class="chat-input" id="chatInput" placeholder="Ask me anything..." maxlength="300" autocomplete="off">' +
        '<button class="chat-send" id="chatSend" aria-label="Send"><i class="fas fa-paper-plane"></i></button>' +
      '</div>' +
      '<div class="chat-powered-by">AI + RAG over project knowledge</div>';
    document.body.appendChild(panel);

    const trigger = document.getElementById('aiChatTrigger');
    const closeBtn = document.getElementById('aiChatClose');
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('chatSend');
    const messagesEl = document.getElementById('chatMessages');
    const quickEl = document.getElementById('chatQuickReplies');

    let isOpen = false;
    let isThinking = false;
    let history = [];

    function toggle() {
      isOpen = !isOpen;
      panel.classList.toggle('open', isOpen);
      if (isOpen) setTimeout(function () { chatInput.focus(); }, 200);
    }

    trigger.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);

    function addMsg(text, role) {
      var wrap = document.createElement('div');
      wrap.className = 'chat-msg ' + role;
      var avatar = role === 'bot' ? 'VR' : '<i class="fas fa-user"></i>';
      wrap.innerHTML = '<div class="chat-msg-avatar">' + avatar + '</div><div class="chat-msg-bubble">' + escapeHtml(text) + '</div>';
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      var el = document.createElement('div');
      el.className = 'chat-msg bot';
      el.id = 'chatTyping';
      el.innerHTML = '<div class="chat-msg-avatar">VR</div><div class="chat-typing-wrap"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function hideTyping() {
      var el = document.getElementById('chatTyping');
      if (el) el.remove();
    }

    async function send(text) {
      if (isThinking || !text.trim()) return;
      isThinking = true;
      sendBtn.disabled = true;
      addMsg(text, 'user');
      history.push({ role: 'user', content: text });
      showTyping();

      await new Promise(function (r) { setTimeout(r, 300 + Math.random() * 400); });
      var reply = getReply(text);

      hideTyping();
      addMsg(reply, 'bot');
      history.push({ role: 'assistant', content: reply });
      isThinking = false;
      sendBtn.disabled = false;
    }

    quickEl.addEventListener('click', function (e) {
      var btn = e.target.closest('.chat-quick-reply');
      if (btn) send(btn.getAttribute('data-q'));
    });

    sendBtn.addEventListener('click', function () {
      var text = chatInput.value.trim();
      if (text) { send(text); chatInput.value = ''; }
    });

    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var text = chatInput.value.trim();
        if (text) { send(text); chatInput.value = ''; }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectChat);
  } else {
    injectChat();
  }
})();
