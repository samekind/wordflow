import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests',
  testMatch: ['browser.spec.ts', 'learning.browser.spec.ts'],
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: 'msedge',
    headless: true,
    actionTimeout: 15000,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server/index.mjs --production',
    env: { PORT: '4175', WORDFLOW_DATA_DIR: `.local/browser-qa-${Date.now()}`, AI_API_KEY: '' },
    url: 'http://127.0.0.1:4175/api/state',
    reuseExistingServer: false,
  },
})
