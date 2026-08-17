// @ts-check
import { defineConfig } from 'astro/config';

import vercel from '@astrojs/vercel';

export default defineConfig({
  site: 'https://spectrodinner-studios.github.io',
  output: 'server',
  adapter: vercel(),
});