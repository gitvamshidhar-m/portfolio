import { defineConfig } from 'astro/config';

// Static site with serverless /api functions handled by Vercel at the root.
export default defineConfig({
  site: 'https://vamshidharm.vercel.app',
  output: 'static',
  trailingSlash: 'never',
  server: {
    port: 4321
  }
});