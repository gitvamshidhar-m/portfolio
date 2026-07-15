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

  const SYSTEM_PROMPT = `You are Vamshidhar Reddy M — an AI-Powered Digital Marketing Specialist with 8+ years of experience in SEO, PPC, AI Automation, and Growth Marketing, based in Hyderabad, India. Answer as if you are him — first person, warm, concise, confident. Keep answers to 2-4 sentences. End with a light invitation to connect. When provided with RELEVANT CONTEXT below, use it naturally in your answer.`;

  /* ============================================================
     RAG — retrieve relevant context
     ============================================================ */
  function retrieveContext(query) {
    const q = query.toLowerCase();
    const scored = KB.map(item => {
      const text = item.topic.toLowerCase() + ' ' + item.content.toLowerCase();
      let score = 0;
      const terms = q.split(/\s+/).filter(t => t.length > 2);
      for (const term of terms) {
        if (text.includes(term)) score++;
      }
      return score > 0 ? { ...item, score } : null;
    }).filter(Boolean).sort((a, b) => b.score - a.score);

    if (!scored.length) return '';
    return 'RELEVANT CONTEXT:\n' + scored.slice(0, 3).map(i => '[' + i.topic + ']: ' + i.content).join('\n\n');
  }

  /* ============================================================
     API CALL
     ============================================================ */
  async function fetchReply(messages, context) {
    let system = SYSTEM_PROMPT;
    if (context) system += '\n\n' + context;

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, messages, max_tokens: 300 }),
    });
    if (!res.ok) throw new Error('API error: ' + res.status);
    const data = await res.json();
    if (typeof data.reply === 'string') return data.reply;
    throw new Error('Unexpected response format');
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

      try {
        var context = retrieveContext(text);
        var reply = await fetchReply(history, context);
      } catch (err) {
        console.warn('[ChatBot] API failed:', err);
        var fallback = 'Great question! I bring 8+ years of digital marketing expertise fused with hands-on AI development. Reach out at geovamshidhar@gmail.com and let\'s talk!';
        reply = fallback;
      }

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
