import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// The project folder to test. The default is the template. CI sets LAPP_DIR to a project that the CLI made.
// A relative path starts at the repository root.
// The network of the project must run before the test starts: `npm run network` in that folder.
const appDir = resolve(import.meta.dirname, '..', process.env.LAPP_DIR ?? 'packages/create-ln-app/template');

// The default ports of the API server and Vite.
const API_URL = 'http://localhost:3001/api/health';
const APP_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: '.',
  // The traces of failed tests go here. CI uploads this folder.
  outputDir: 'test-results',
  // The test opens a channel, mines blocks, and pays an invoice on the regtest network.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  // The test changes the network state. Thus, only one test runs at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: APP_URL,
    // The page formats the amounts with toLocaleString. The test expects "1,000".
    locale: 'en-US',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Start the API server and Vite. If they already run on a local machine, the test uses them.
  webServer: [
    { command: 'npm run server', cwd: appDir, url: API_URL, reuseExistingServer: !process.env.CI },
    { command: 'npm --prefix frontend run dev', cwd: appDir, url: APP_URL, reuseExistingServer: !process.env.CI },
  ],
});
