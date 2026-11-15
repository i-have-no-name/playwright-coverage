import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  reporter: [['list'], ['./scripts/report.mjs']],
  use: { baseURL: 'http://localhost:5273' },
  webServer: [
    { command: 'node server.mjs', port: 8787, reuseExistingServer: true },
    {
      command: 'npx rspack build && npx rspack preview dist-coverage --port 5273',
      url: 'http://localhost:5273',
      env: { COVERAGE: 'true' },
      reuseExistingServer: false,
    },
  ],
});
