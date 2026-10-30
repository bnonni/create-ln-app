import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The project folder to test. The default is the template. CI sets LAPP_DIR to a project that the CLI made.
// A relative path starts at the repository root.
// The network of the project must run before the test starts: `npm run network` in that folder.
const appDir = resolve(import.meta.dirname, '..', process.env.LAPP_DIR ?? 'packages/create-ln-app/template');

// Each template sets the URL of its app in the "config" field of package.json.
const pkg = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')) as { config: { appUrl: string } };
const APP_URL = pkg.config.appUrl;

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
  // Start the app without the network. If the app already runs on a local machine, the test uses it.
  // The app sends /api to the API. Thus, the health URL is ready only when the app and the API are ready.
  webServer: {
    command: 'npm run dev:app',
    cwd: appDir,
    url: `${APP_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
  },
});
