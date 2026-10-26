import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env.CI);
// CI tests the production build (no on-demand compiling, and it is what ships);
// locally the tests reuse the `make dev` server if it is running.
const webUrl = ci ? 'http://localhost:4173' : 'http://localhost:5173';

// End-to-end tests drive the real web app against the real API and database.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? 'github' : 'list',
  use: {
    baseURL: webUrl,
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
    { command: ci ? 'npm run build && npm run preview' : 'npm run dev', url: webUrl, reuseExistingServer: !ci },
  ],
});
