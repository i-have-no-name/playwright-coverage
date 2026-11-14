import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list'], ['./scripts/report.mjs']],
  use: { baseURL: 'http://localhost:5173' },
  webServer: [
    { command: 'node server.mjs', port: 8787, reuseExistingServer: true },
    {
      command: 'npx vite --port 5173 --strictPort',
      url: 'http://localhost:5173',
      env: { VITE_COVERAGE: 'true' },
      reuseExistingServer: false,
    },
  ],
});
