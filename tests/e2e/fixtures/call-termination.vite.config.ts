import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixture = (name: string) => fileURLToPath(new URL(name, import.meta.url));

// Isolated call fixture: real CallSession and controls, fake core/transport, no homeserver.
export default defineConfig({
  root,
  publicDir: `${root}/static`,
  define: { __SABLE_STABLE__: 'false' },
  resolve: {
    alias: {
      '$app/stores': fixture('./call-kit-stores.ts'),
      '$app/state': fixture('./call-kit-state.ts'),
      '$app/navigation': fixture('./call-kit-navigation.ts'),
      '$app/paths': fixture('./call-kit-paths.ts'),
    },
  },
  plugins: [
    svelte({
      configFile: false,
      preprocess: vitePreprocess(),
      compilerOptions: {
        runes: ({ filename }) =>
          filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
        experimental: { async: true },
      },
    }),
  ],
});
