import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SMOKE_BASE_URL || 'https://elifekh.com'

export default defineConfig({
  testDir: './tests',
  outputDir: 'test-results',
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: {
      'x-tenant-id': 'seed-tenant-001',
      'x-user-id': 'seed-user-boss',
      'x-store-id': 'seed-store-a',
      'x-role': 'OWNER',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
