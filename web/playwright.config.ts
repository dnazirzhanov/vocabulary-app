import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env.CI);
// CI tests the production build (no on-demand compiling, and it is what ships);
// locally the tests reuse the `make dev` server if it is running.
const webUrl = ci ? 'http://localhost:4173' : 'http://localhost:5173';

// The sign-in screen only exists in a build made with Supabase auth, so it gets its own web server.
// Supabase itself is replaced by mocked network responses (e2e/auth.spec.ts); nothing listens on this URL.
const authUrl = ci ? 'http://localhost:4174' : 'http://localhost:5174';
const authEnv = {
  VITE_AUTH_MODE: 'supabase',
  VITE_SUPABASE_URL: 'http://localhost:54321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key',
};

// End-to-end tests drive the real web app against the real API and database.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: ci,
  reporter: ci ? 'github' : 'list',
  use: {
    // Local runs use the installed Chrome; CI installs Playwright's Chromium.
    channel: ci ? undefined : 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'app', testIgnore: 'auth.spec.ts', use: { baseURL: webUrl } },
    { name: 'auth', testMatch: 'auth.spec.ts', use: { baseURL: authUrl } },
  ],
  webServer: [
    {
      command: 'uv run uvicorn app.main:app --port 8000',
      cwd: '../backend',
      url: 'http://localhost:8000/api/health/ready',
      reuseExistingServer: !ci,
    },
    { command: ci ? 'npm run build && npm run preview' : 'npm run dev', url: webUrl, reuseExistingServer: !ci },
    {
      command: ci
        ? 'npx vite build --outDir dist-auth && npx vite preview --port 4174 --outDir dist-auth'
        : 'npx vite --port 5174',
      env: authEnv,
      url: authUrl,
      reuseExistingServer: !ci,
    },
  ],
});
