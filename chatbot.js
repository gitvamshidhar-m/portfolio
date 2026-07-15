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
     RAG — smarter retrieval (stop words, n-grams, TF-IDF scoring)
     ============================================================ */
  var STOP_WORDS = {
    'a':1,'an':1,'the':1,'is':1,'it':1,'in':1,'on':1,'at':1,'to':1,'for':1,'of':1,'by':1,'with':1,
    'and':1,'or':1,'but':1,'not':1,'are':1,'was':1,'were':1,'be':1,'been':1,'being':1,'do':1,'does':1,
    'did':1,'have':1,'has':1,'had':1,'can':1,'could':1,'will':1,'would':1,'shall':1,'should':1,'may':1,
    'might':1,'must':1,'i':1,'you':1,'we':1,'they':1,'he':1,'she':1,'it':1,'me':1,'my':1,'your':1,'his':1,
    'her':1,'our':1,'their':1,'this':1,'that':1,'these':1,'those':1,'what':1,'which':1,'who':1,'whom':1,
    'how':1,'when':1,'where':1,'why':1,'about':1,'into':1,'over':1,'after':1,'before':1,'between':1,'under':1,
    'up':1,'down':1,'out':1,'off':1,'than':1,'then':1,'also':1,'just':1,'like':1,'so':1,'if':1,'no':1,'yes':1,
    'get':1,'got':1,'tell':1,'make':1,'made':1,'want':1,'need':1,'know':1,'think':1,'see':1,'go':1,'come':1,
    'take':1,'give':1,'use':1,'find':1,'ask':1,'work':1,'look':1,'let':1,'please':1,'thanks':1
  };

  var STEM_MAP = {
    'projects':'project','skills':'skill','tools':'tool','experiences':'experience','technologies':'technology',
    'certificates':'certification','courses':'course','degrees':'degree','companies':'company','roles':'role',
    'languages':'language','summaries':'summary','repos':'repo','links':'link','emails':'email','platforms':'platform',
    'extensions':'extension','queries':'query','results':'result','features':'feature','capabilities':'capability',
    'audits':'audit','keywords':'keyword','recommendations':'recommendation','leads':'lead','pages':'page',
    'pipelines':'pipeline','sources':'source','alerts':'alert','agents':'agent','architectures':'architecture',
    'writing':'write','building':'build','working':'work','managing':'manage','using':'use','crawling':'crawl',
    'powered':'power','automated':'automate','integrated':'integrate','optimized':'optimize','engineered':'engineer',
    'generated':'generate','architected':'architect','summarizes':'summarize','normalizes':'normalize',
    'surfaces':'surface','evaluates':'evaluate','generates':'generate','manages':'manage','handles':'handle',
    'called':'call','titled':'title','based':'base','located':'locate','specialized':'specialize',
    'currently':'current','previously':'previous','primarily':'primary','mainly':'main'
  };

  function tokenize(str) {
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (t) {
      return t.length > 2 && !STOP_WORDS[t];
    });
  }

  function stem(word) {
    return STEM_MAP[word] || word;
  }

  function buildGrams(tokens) {
    var grams = tokens.slice();
    for (var i = 0; i < tokens.length - 1; i++) {
      grams.push(tokens[i] + ' ' + tokens[i + 1]);
    }
    return grams;
  }

  function retrieveContext(query) {
    var qTokens = tokenize(query);
    if (!qTokens.length) return '';

    var qGrams = buildGrams(qTokens.map(stem));
    var numDocs = KB.length;

    var scored = KB.map(function (item) {
      var body = (item.topic + ' ' + item.content).toLowerCase();
      var docTokens = tokenize(body);
      var docGrams = buildGrams(docTokens.map(stem));

      var score = 0;
      var matched = {};

      for (var gi = 0; gi < qGrams.length; gi++) {
        var gram = qGrams[gi];
        if (!gram || gram.length < 2) continue;
        var isBigram = gram.indexOf(' ') > 0;
        var count = 0;
        var corpus = isBigram ? docGrams : docTokens;
        for (var ci = 0; ci < corpus.length; ci++) {
          if (corpus[ci] === gram) count++;
        }

        if (count > 0 && !matched[gram]) {
          matched[gram] = true;
          var weight = 1;
          if (isBigram) weight = 2.5;
          if (count > 1) weight *= 1.3;
          var df = 0;
          for (var di = 0; di < KB.length; di++) {
            var dBody = (KB[di].topic + ' ' + KB[di].content).toLowerCase();
            if ((isBigram ? dBody : tokenize(dBody).map(stem)).some(function (t) { return t === gram; })) df++;
          }
          if (df > 0) weight *= Math.log((numDocs + 1) / (df + 0.5));
          score += weight * count;
        }
      }

      var topicBonus = 0;
      for (var ti = 0; ti < qTokens.length; ti++) {
        if (item.topic.toLowerCase().includes(qTokens[ti])) topicBonus += 2;
      }
      score += topicBonus;

      return score > 0 ? { item: item, score: score } : null;
    }).filter(Boolean).sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) return '';

    var top = scored.slice(0, 4);
    if (top.length > 1 && top[0].score > top[1].score * 3) {
      top = [top[0]];
    }

    return 'RELEVANT CONTEXT:\n' + top.map(function (r) { return '[' + r.item.topic + ']: ' + r.item.content; }).join('\n\n');
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
