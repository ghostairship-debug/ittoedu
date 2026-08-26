import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // Fails the run once with the reason when the environment cannot start
  // Electron as an app, instead of eight specs reporting "Process failed to
  // launch!" with the real error swallowed.
  globalSetup: './tests/e2e/globalSetup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
