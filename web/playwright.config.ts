import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env.CI);

// End-to-end tests drive the real web app against the real API and database.
// Locally they reuse `make dev` if it is running; in CI they start both servers.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    // Local runs use the installed Chrome; CI installs Playwright's Chromium.
    channel: ci ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/api/health/ready',
      reuseExistingServer: !ci,
    },
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !ci },
  ],
});
