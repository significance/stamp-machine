import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/integration',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5176',
  },
  webServer: {
    command: 'npm run dev',
    port: 5176,
    reuseExistingServer: true,
  },
})
