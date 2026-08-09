---
title: "Technical SEO on My Own Portfolio: How to Inspect It"
description: "I ran the same technical-SEO checklist I use for clients on my own site: semantic HTML, one h1 per page, JSON-LD Person + FAQ schema, canonical URLs, Open Graph, sitemap and robots. Here is the checklist, and how you can verify each item."
date: "2026-08-07"
tag: "SEO"
read: "6 min read"
tags: ["SEO"]
---

<p>Every week I tell clients the same thing: technical SEO isn't about hacks, it's about removing friction between a crawler and the words you want it to understand. This site is my laboratory — it runs the exact same checklist, and you can inspect every box I ticked by opening the developer tools.</p><h2>1. One semantic outline per page</h2><p>A page should read like a document: a single h1, then h2s, then h3s — never skipping levels. My headings follow that tree so Google and AI crawlers can map the page structure.</p><pre>&lt;h1&gt;Vamshidhar Reddy | Digital Marketing Specialist&lt;/h1&gt;
  &lt;h2&gt;Skills&lt;/h2&gt;
    &lt;h3&gt;Paid Media / PPC 95%&lt;/h3&gt;</pre><h2>2. Structured data (JSON-LD)</h2><p>Schema tells engines who the page is about before they read a word. This site ships a Person snippet and an FAQPage snippet. You can test them in the Rich Results Test or check the raw JSON in view-source.</p><h2>3. canonical, sitemap and robots</h2><p>A canonical URL stops duplicate-content confusion; sitemap.xml tells crawlers what URLs exist; robots.txt controls access. All three live at <code>/sitemap.xml</code> and <code>/robots.txt</code>.</p><h2>4. Answer-engine ready</h2><p>The old keyword game is being joined by answer engines. So the same facts live in the FAQ markup and the FAQPage schema, my llms.txt, and the AI chat's knowledge base — consistent entity data is what modern ranking rewards.</p><blockquote>SEO now reads like a conversation: give one source, give it clean structure, and let every engine quote you correctly.</blockquote><p>The real browser open on this page and press F12 — you'll find all of the above.</p>
