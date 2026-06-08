import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "zh-CN"
  },
  webServer: [
    {
      command: "npm run dev:server",
      url: "http://127.0.0.1:4000/api/v1/health",
      reuseExistingServer: true,
      timeout: 120_000
    },
    {
      command: "npm run dev:client",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: true,
      timeout: 120_000
    }
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
