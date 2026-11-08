import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const port = process.env.SABLE_CALL_E2E_PORT ?? '4193';
const origin = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: '.',
  testMatch: 'call-termination.spec.ts',
  workers: 1,
  outputDir: join(tmpdir(), `sable-call-termination-${String(process.pid)}`),
  preserveOutput: 'always',
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: origin,
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: `pnpm exec vite --config tests/e2e/fixtures/call-termination.vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: root,
    url: `${origin}/tests/e2e/fixtures/call-termination.html`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
