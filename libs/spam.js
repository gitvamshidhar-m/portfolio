const GROQ = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const MAX_TOKENS = 220;

function clean(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 900);
}

function parseVerdict(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\{[\s\S]*\}/);
  const src = m ? m[0].replace(/```json|```/g, '') : String(raw);
  try {
    const j = JSON.parse(src);
    const score = Math.max(0, Math.min(1, parseFloat(j.score) || (j.spam ? 1 : 0)));
    const spam = !!(j.spam === true || j.spam === 'true' || (typeof j.score === 'number' && j.score >= 0.5));
    return { spam: spam, score: score, reason: String(j.reason || '').slice(0, 160) };
  } catch (e) { return null; }
}

function classify(msg) {
  const key = (process.env.GROQ_API_KEY || '').trim();
  if (!key || !msg) return Promise.resolve({ spam: false, score: 0, reason: '(AI off — not configured)' });
  const prompt = 'Classify this inbound message to a portfolio contact form. A real message = a recruiter, hiring manager or potential client discussing an actual role, project or experience. Spam = mass-sent offers, SEO ranking bribery, cold "social media manager" gigs, web-design services, bitcoin/crypto, generic praise with no specifics, or anything that reads templated and unrelated to hiring Vamshidhar Reddy for digital marketing (SEO / PPC / paid media / AI marketing) work.\n\nReturn ONLY one JSON object, no commentary:\n{"spam": true|false, "score": 0.0-1.0 (1.0 = certain spam), "reason": "10-word reason"}\n\nFROM: ' + msg.name + '\nEMAIL: ' + msg.email + '\nSUBJECT: ' + msg.subject + '\nMESSAGE:\n' + msg.message;
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, 9000);
  return fetch(GROQ, {
    method: 'POST',
    signal: controller.signal,
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: 'system', content: 'You are a precise, conservative spam filter for a job-seeker\'s portfolio. Never let a real recruiter be blocked. When unsure, set score < 0.5. Reply only JSON.' },
        { role: 'user', content: prompt }
      ]
    })
  }).then(function (r) { return r.json(); }).then(function (j) {
    clearTimeout(timer);
    const raw = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return parseVerdict(raw) || { spam: false, score: 0, reason: 'unparseable verdict — allowed through' };
  }).catch(function () {
    clearTimeout(timer);
    return { spam: false, score: 0, reason: 'AI timed out — allowed through' };
  });
}

module.exports = { classify: classify };