---
title: "I Built a Cover-Letter Generator That Writes in My Voice"
description: "Every job seeker sends the same template CV. I built a tool that turns a pasted job description into a personalized outreach email and a first-30-days plan grounded in my real track record. Here is the funnel, the prompt, and why it works."
date: "2026-08-09"
tag: "Build"
read: "5 min read"
tags: ["Build", "Hiring"]
---

<p>Most candidates send the same CV to every company, tweak the greeting, and hope. I built the opposite: a generator, live on this site, that takes a pasted job description and writes a tailored outreach email plus a concrete first-30-days plan in my voice. It works because it is grounded in my real track record — not generic AI flattery.</p><h2>Why a tool instead of a template</h2><p>A template saves effort but signals nothing. A tool proves something: that I can take an unstructured input, run it through a retrieval-plus-generation pipeline, and return a usable deliverable. That is exactly the kind of marketing-build hybrid my portfolio is about. When a recruiter lands on /hire.html, they do not just read my claims — they experience the pipeline that turns their job post into a pitch.</p><h2>How it actually works</h2><p>The endpoint takes a mode and a few inputs. In JD mode it reads the pasted description; in quiz mode it takes four answers — role focus, company stage, and the KPI they most mention. It retrieves only the relevant pieces of my knowledge base (results, experience, products, approach), so every claim stays traceable, then asks Groq to produce two things: a short outreach email, max 160 words, ending with a low-friction ask; and up to five specific "first 30 days" bullets. If the model is unavailable, a smart template falls back with the same structure — the experience never breaks.</p>

<pre style="white-space:pre-wrap;background:rgba(139,123,255,.06);border:1px solid var(--line);border-radius:12px;padding:14px;font-size:13px;line-height:1.7">Sample output for a paid-media role:
Subject: Accelerating Acme's Digital Growth with Proven Paid Media Expertise

Hi Acme Team, I'm Vamshidhar, a performance marketer with 10+ years in SEO,
PPC and automation, and three live AI products shipped solo... (30-day plan below)</pre>

<h2>Grounding beats prompting</h2><p>Four rules shaped the prompt: use only facts in context, never invent numbers, first person, end with a 15-minute call. That one rule — "never invent numbers" — is the differentiator. Generic AI cover letters invent impressive-sounding stats. This one refuses to, which is the entire point: my numbers are real, and they are clickable on this site. ROAS 3.2x to 5.5x, a cost-per-lead cut from Rs.1,100 to 770, organic up 15%, three products live.</p><blockquote>Don't make candidates invent enthusiasm. Make them prove their record.</blockquote>

<h2>What I learned building it</h2><ul><li>Retrieval first, LLM second. Feed the model only what is relevant to that job, or every pitch sounds alike.</li><li>JSON-enforced output, then repair. Ask for strict JSON, parse it, and fall back to the raw text if needed.</li><li>The 30-day plan is the closer. Recruiters skip prose; they read the plan. Lead with execution.</li><li>Track it. The generator logs every attempt and I can see which mode (JD vs quiz) converts and fires the site's own funnels — the tool measures itself.</li><li>Under a serverless limit, make helpers modules, not entrypoints. Every file in /api becomes a function; two helpers crossed a 12-function cap I hit on the Hobby plan. Move them out.</li></ul>

<p>Try it yourself: <a href="/hire.html">paste a real job description and generate your pitch</a>. If a candidate can't build the tool that writes their own pitch, they shouldn't be running campaigns for you.</p>