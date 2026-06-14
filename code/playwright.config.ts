import { defineConfig, devices } from "@playwright/test";

const apiPort = Number(process.env.PLAYWRIGHT_API_PORT ?? 4000);
const clientPort = Number(process.env.PLAYWRIGHT_CLIENT_PORT ?? 5173);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const clientOrigin = `http://127.0.0.1:${clientPort}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: clientOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    locale: "zh-CN"
  },
  webServer: [
    {
      command: `EMAIL_DELIVERY_DISABLED=1 API_PORT=${apiPort} npm run dev:server`,
      url: `${apiOrigin}/api/v1/health`,
      reuseExistingServer,
      timeout: 120_000
    },
    {
      command: `VITE_PORT=${clientPort} VITE_API_TARGET=${apiOrigin} npm run dev:client`,
      url: clientOrigin,
      reuseExistingServer,
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
