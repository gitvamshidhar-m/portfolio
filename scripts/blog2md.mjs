import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const blog = JSON.parse(readFileSync(join(root, 'public', 'blog.json'), 'utf8'));
const outDir = join(root, 'src', 'content', 'blog');
mkdirSync(outDir, { recursive: true });

const fm = (key, val) => `${key}: ${JSON.stringify(String(val))}`;
let count = 0;
for (const post of blog) {
  const tags = post.tags && Array.isArray(post.tags) && post.tags.length
    ? post.tags
    : [post.tag || 'General'];
  const md = `---
${fm('title', post.title)}
${fm('description', post.excerpt || '')}
${fm('date', post.date)}
${fm('tag', post.tag || 'General')}
${fm('read', post.read || '4 min read')}
tags: ${JSON.stringify(tags)}
---

${post.body}
`;
  const file = join(outDir, `${post.slug}.md`);
  writeFileSync(file, md, 'utf8');
  count++;
}
console.log(`wrote ${count} markdown posts to src/content/blog/`);