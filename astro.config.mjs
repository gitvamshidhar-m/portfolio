import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://vamshidharm.vercel.app',
  output: 'static',
  server: {
    port: 4321
  }
});